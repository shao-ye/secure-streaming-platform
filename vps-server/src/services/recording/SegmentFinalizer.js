const fs = require('fs').promises;
const path = require('path');
const { randomUUID } = require('crypto');
const { spawn } = require('child_process');

/**
 * 安全完成已关闭的录制分段：先封装、校验，再发布正式文件。
 * 调用方必须先确认录制进程退出或该段已关闭；文件大小稳定不能替代这个前提。
 */
class SegmentFinalizer {
  /** 初始化工具路径及有界处理时长，不读取或记录含凭据的源流地址。 */
  constructor({
    ffmpegPath,
    ffprobePath,
    timeoutMs = 60000,
    probeTimeoutMs = 10000,
    stableCheckMs = 300,
    terminateGraceMs = 2000,
    killGraceMs = 2000
  } = {}) {
    if (!ffmpegPath) throw this._error('INVALID_CONFIG', 'FFmpeg path is required');
    this.ffmpegPath = ffmpegPath;
    this.ffprobePath = ffprobePath || this._probePath(ffmpegPath);
    this.timeoutMs = timeoutMs;
    this.probeTimeoutMs = probeTimeoutMs;
    this.stableCheckMs = stableCheckMs;
    this.terminateGraceMs = terminateGraceMs;
    this.killGraceMs = killGraceMs;
    for (const value of [timeoutMs, probeTimeoutMs, terminateGraceMs, killGraceMs]) {
      if (!Number.isFinite(value) || value <= 0) {
        throw this._error('INVALID_CONFIG', 'Process timeouts must be positive');
      }
    }
    if (!Number.isFinite(stableCheckMs) || stableCheckMs < 0) {
      throw this._error('INVALID_CONFIG', 'Stability interval must be nonnegative');
    }
    this.inFlight = new Map();
  }

  /**
   * 将已关闭的输入安全封装为正式文件；失败始终拒绝，保留输入，不降级为直接改名。
   * 同一输入和目标的并发调用复用任务，不同目标争用同一输入时明确拒绝。
   */
  finalize(inputPath, outputPath) {
    const input = path.resolve(inputPath);
    const output = path.resolve(outputPath);
    if (input === output) {
      return Promise.reject(this._error('INVALID_PATH', 'Input and output must differ'));
    }
    const active = this.inFlight.get(input);
    if (active) {
      return active.output === output
        ? active.promise
        : Promise.reject(this._error('FINALIZE_CONFLICT', 'Input is already being finalized'));
    }
    const promise = this._finalize(input, output).finally(() => this.inFlight.delete(input));
    this.inFlight.set(input, { output, promise });
    return promise;
  }

  /** 执行完整事务，正式目标只通过同目录硬链接的排他创建发布，绝不覆盖既有文件。 */
  async _finalize(input, output) {
    let part = null;
    let partOwned = false;
    let published = false;
    let publishedStat = null;
    try {
      if (await this._exists(output)) {
        throw this._error('FINAL_EXISTS', 'Final recording already exists');
      }
      const sourceStat = await this._sourceStat(input);
      await new Promise(resolve => setTimeout(resolve, this.stableCheckMs));
      await this._assertUnchanged(input, sourceStat);
      const source = await this._probe(input);
      await this._assertUnchanged(input, sourceStat);

      // part 位于目标目录，与正式文件在同一文件系统；独占创建保证只清理本次产物。
      part = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.part.mp4`);
      const handle = await fs.open(part, 'wx');
      partOwned = true;
      await handle.close();
      await this._run(this.ffmpegPath, [
        '-nostdin', '-v', 'error', '-i', input,
        '-map', '0', '-c', 'copy', '-movflags', 'faststart', '-y', part
      ], this.timeoutMs);
      await this._assertUnchanged(input, sourceStat);
      const result = await this._probe(part);
      const tolerance = Math.max(1, Math.min(5, source.durationSeconds * 0.001));
      if (Math.abs(result.durationSeconds - source.durationSeconds) > tolerance) {
        throw this._error('DURATION_MISMATCH', 'Remuxed duration differs from source');
      }
      const partStat = await this._sourceStat(part);
      await this._assertUnchanged(input, sourceStat);

      // link 在目标已存在时返回 EEXIST，避免检查后 rename 覆盖其他任务发布的正式文件。
      try {
        await fs.link(part, output);
      } catch (error) {
        if (error.code === 'EEXIST') {
          throw this._error('FINAL_EXISTS', 'Final recording already exists');
        }
        throw this._error('PUBLISH_FAILED', 'Could not publish verified recording');
      }
      published = true;
      publishedStat = partStat;
      await this._assertUnchanged(input, sourceStat);

      // 发布后再删原件；删除失败仅保留原件，不让已验证的正式文件丢失。
      let sourceRetained = false;
      try {
        await fs.unlink(input);
      } catch {
        sourceRetained = true;
      }
      return {
        outputPath: output,
        durationSeconds: result.durationSeconds,
        size: partStat.size,
        sourceRetained
      };
    } catch (error) {
      if (published) await this._removeIfSameFile(output, publishedStat);
      throw error;
    } finally {
      if (partOwned) await fs.unlink(part).catch(() => {});
    }
  }

  /** 验证视频流和有限正时长；探测输出设上限，避免损坏媒体产生大对象。 */
  async _probe(filePath) {
    const output = await this._run(this.ffprobePath, [
      '-v', 'error', '-show_entries',
      'format=duration:stream=codec_type,codec_name,width,height',
      '-of', 'json', filePath
    ], this.probeTimeoutMs);
    let data;
    try {
      data = JSON.parse(output);
    } catch {
      throw this._error('INVALID_MEDIA', 'Media probe did not return valid metadata');
    }
    const streams = Array.isArray(data?.streams) ? data.streams : [];
    const video = streams.find(stream => stream?.codec_type === 'video'
      && stream.codec_name && stream.codec_name !== 'unknown'
      && Number(stream.width) > 0 && Number(stream.height) > 0);
    const durationSeconds = Number(data?.format?.duration);
    if (!video || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw this._error('INVALID_MEDIA', 'Recording has no valid video stream or duration');
    }
    return { durationSeconds };
  }

  /** 有界启动子进程；超时先终止再强杀，每个结束分支都取消定时器。 */
  _run(command, args, timeoutMs) {
    return new Promise((resolve, reject) => {
      let child;
      let settled = false;
      let failure = null;
      let stdout = '';
      const timers = new Set();
      const finish = (error) => {
        if (settled) return;
        settled = true;
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        if (error) reject(error);
        else resolve(stdout);
      };
      const schedule = (callback, delay) => {
        const timer = setTimeout(callback, delay);
        timers.add(timer);
      };
      const kill = (signal) => {
        try { child.kill(signal); } catch { /* 保留最初失败原因，由有界等待兜底。 */ }
      };
      const terminate = (error) => {
        if (settled || failure) return;
        failure = error;
        kill('SIGTERM');
        if (settled) return;
        schedule(() => {
          kill('SIGKILL');
          if (settled) return;
          schedule(() => {
            failure.processMayStillBeRunning = true;
            finish(failure);
          }, this.killGraceMs);
        }, this.terminateGraceMs);
      };
      try {
        child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch {
        finish(this._error('PROCESS_START_FAILED', 'Media process could not start'));
        return;
      }
      child.stdout.on('data', chunk => {
        if (settled || failure) return;
        if (Buffer.byteLength(stdout) + chunk.length > 1024 * 1024) {
          terminate(this._error('PROBE_OUTPUT_LIMIT', 'Media metadata exceeded size limit'));
          return;
        }
        stdout += chunk.toString();
      });
      // stderr 只消费不积累、不进入异常文本，避免路径或媒体元数据泄露与日志内存膨胀。
      child.stderr.resume();
      child.once('error', () => {
        const error = this._error('PROCESS_START_FAILED', 'Media process failed');
        if (!child.pid) finish(error);
        else terminate(error);
      });
      child.once('close', (code) => finish(failure
        || (code === 0 ? null : this._error('PROCESS_FAILED', 'Media process exited unsuccessfully'))));
      schedule(() => terminate(this._error('PROCESS_TIMEOUT', 'Media process timed out')), timeoutMs);
    });
  }

  /** 读取普通非空源文件身份，拒绝符号链接和空文件。 */
  async _sourceStat(filePath) {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.size <= 0) {
      throw this._error('INVALID_SOURCE', 'Recording must be a nonempty regular file');
    }
    return stat;
  }

  /** 发现身份、大小或时间戳变化即保留原件，防止处理仍在写入的分段。 */
  async _assertUnchanged(filePath, original) {
    const current = await this._sourceStat(filePath);
    if (['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some(key => current[key] !== original[key])) {
      throw this._error('SOURCE_CHANGED', 'Recording changed during finalization');
    }
  }

  /** 回滚仅移除本次发布的同一文件，避免删除外部替换后的目标。 */
  async _removeIfSameFile(filePath, expected) {
    try {
      const current = await fs.lstat(filePath);
      if (current.dev === expected.dev && current.ino === expected.ino) await fs.unlink(filePath);
    } catch { /* 回滚失败仍保留原始录制，不能因此删除其他文件。 */ }
  }

  /** 判断目标是否已存在，包括不能被覆盖的符号链接。 */
  async _exists(filePath) {
    try {
      await fs.lstat(filePath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }

  /** 配置带目录的 FFmpeg 时，默认使用同目录 ffprobe；否则通过 PATH 查找。 */
  _probePath(ffmpegPath) {
    const directory = path.dirname(ffmpegPath);
    const filename = /\.exe$/i.test(ffmpegPath) ? 'ffprobe.exe' : 'ffprobe';
    return directory === '.' ? filename : path.join(directory, filename);
  }

  /** 仅生成稳定错误码和不含路径、命令行、凭据的说明。 */
  _error(code, message) {
    return Object.assign(new Error(message), { code });
  }
}

module.exports = SegmentFinalizer;
