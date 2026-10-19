const { describe, test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const spawn = mock.fn();
const modulePath = path.resolve(__dirname, '../../src/services/recording/SegmentFinalizer.js');
const loaded = { exports: {} };
// 只替换子进程边界；文件发布和回滚使用真实临时目录，不依赖损坏的本地 Jest 安装。
vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), {
  module: loaded,
  require: name => {
    if (name === 'child_process') return { spawn };
    if (name === 'crypto') return { randomUUID: () => 'test-unique-id' };
    return require(name);
  },
  setTimeout, clearTimeout, Buffer
}, { filename: modulePath });
const SegmentFinalizer = loaded.exports;

/** 构造可控的子进程，验证关闭、失败和信号升级，不执行真实录制。 */
function makeChild() {
  const child = new EventEmitter();
  child.pid = 12345;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = mock.fn(signal => {
    process.nextTick(() => child.emit('close', null, signal));
    return true;
  });
  return child;
}

/** 提供有效视频探测数据，时长差异由单项测试覆盖。 */
function metadata(duration = 3600) {
  return {
    format: { duration: String(duration) },
    streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 }]
  };
}

describe('SegmentFinalizer', () => {
  let directory;
  let input;
  let output;
  let children;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-finalizer-'));
    input = path.join(directory, 'camera_stream_20261019_074001_temp_000.mp4');
    output = path.join(directory, 'camera_stream_20261019_074001_to_084001.mp4');
    fs.writeFileSync(input, 'original-recording');
    children = [];
    spawn.mock.resetCalls();
    spawn.mock.mockImplementation(() => {});
  });

  afterEach(() => {
    // 仅删除本测试创建且确认位于系统临时目录的独立目录。
    const resolved = path.resolve(directory);
    const root = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('recording-finalizer-')) {
      throw new Error('Unexpected test cleanup directory');
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  /** 配置探测与封装的可控成功路径，允许在关键阶段模拟并发写入。 */
  function installProcesses({ sourceData, outputData, onConvert, onOutputProbe } = {}) {
    spawn.mock.mockImplementation((command, args) => {
      const child = makeChild();
      children.push(child);
      process.nextTick(() => {
        if (command.includes('ffprobe')) {
          const isSource = args[args.length - 1] === input;
          if (!isSource && onOutputProbe) onOutputProbe();
          child.stdout.end(JSON.stringify(isSource
            ? (sourceData || metadata()) : (outputData || metadata())));
          child.emit('close', 0);
        } else {
          const part = args[args.length - 1];
          fs.writeFileSync(part, 'verified-remux');
          if (onConvert) onConvert(child, part);
          else child.emit('close', 0);
        }
      });
      return child;
    });
  }

  /** 缩短稳定观察时间；进程超时仍由专门测试验证。 */
  function finalizer(options = {}) {
    return new SegmentFinalizer({ ffmpegPath: 'ffmpeg', stableCheckMs: 0, ...options });
  }

  test('验证完成前不出现正式文件，成功发布后才删除原件', async () => {
    installProcesses({ onOutputProbe: () => {
      assert.equal(fs.existsSync(output), false);
      assert.equal(fs.readFileSync(input, 'utf8'), 'original-recording');
    } });
    const result = await finalizer().finalize(input, output);
    assert.equal(result.outputPath, output);
    assert.equal(result.durationSeconds, 3600);
    assert.equal(result.sourceRetained, false);
    assert.equal(fs.readFileSync(output, 'utf8'), 'verified-remux');
    assert.equal(fs.existsSync(input), false);
    assert.deepEqual(fs.readdirSync(directory), [path.basename(output)]);
  });

  test('封装进程失败时保留原件，清理本次part，不生成伪成功文件', async () => {
    installProcesses({ onConvert: child => child.emit('close', 1) });
    await assert.rejects(finalizer().finalize(input, output), { code: 'PROCESS_FAILED' });
    assert.equal(fs.readFileSync(input, 'utf8'), 'original-recording');
    assert.deepEqual(fs.readdirSync(directory), [path.basename(input)]);
  });

  test('输出时长明显变短时拒绝发布并保留完整原件', async () => {
    installProcesses({ outputData: metadata(2) });
    await assert.rejects(finalizer().finalize(input, output), { code: 'DURATION_MISMATCH' });
    assert.deepEqual(fs.readdirSync(directory), [path.basename(input)]);
  });

  test('输出没有可解析视频流时拒绝发布', async () => {
    installProcesses({ outputData: { format: { duration: '3600' }, streams: [] } });
    await assert.rejects(finalizer().finalize(input, output), { code: 'INVALID_MEDIA' });
    assert.equal(fs.existsSync(input), true);
    assert.equal(fs.existsSync(output), false);
  });

  test('输入仍在写入时拒绝封装结果且不删除更新后的输入', async () => {
    installProcesses({ onConvert: child => {
      fs.appendFileSync(input, '-still-writing');
      child.emit('close', 0);
    } });
    await assert.rejects(finalizer().finalize(input, output), { code: 'SOURCE_CHANGED' });
    assert.equal(fs.readFileSync(input, 'utf8'), 'original-recording-still-writing');
    assert.equal(fs.existsSync(output), false);
  });

  test('既有正式文件不被覆盖，也不启动封装进程', async () => {
    fs.writeFileSync(output, 'existing-final');
    await assert.rejects(finalizer().finalize(input, output), { code: 'FINAL_EXISTS' });
    assert.equal(spawn.mock.callCount(), 0);
    assert.equal(fs.readFileSync(output, 'utf8'), 'existing-final');
    assert.equal(fs.existsSync(input), true);
  });

  test('part独占创建失败时不清理其他任务的同名文件', async () => {
    installProcesses();
    const foreignPart = path.join(directory, `.${path.basename(output)}.test-unique-id.part.mp4`);
    fs.writeFileSync(foreignPart, 'foreign-part');
    await assert.rejects(finalizer().finalize(input, output), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(foreignPart, 'utf8'), 'foreign-part');
    assert.equal(fs.existsSync(input), true);
    assert.equal(fs.existsSync(output), false);
  });

  test('发布瞬间其他任务抢先创建正式文件时，仍不覆盖或删除任何原件', async () => {
    installProcesses({ onOutputProbe: () => fs.writeFileSync(output, 'competing-final') });
    await assert.rejects(finalizer().finalize(input, output), { code: 'FINAL_EXISTS' });
    assert.equal(fs.readFileSync(output, 'utf8'), 'competing-final');
    assert.equal(fs.readFileSync(input, 'utf8'), 'original-recording');
    assert.equal(fs.readdirSync(directory).some(name => name.endsWith('.part.mp4')), false);
  });

  test('重复收尾共用同一任务，不同输出争用同一原件时拒绝', async () => {
    installProcesses();
    const service = finalizer();
    const first = service.finalize(input, output);
    assert.equal(service.finalize(input, output), first);
    await assert.rejects(service.finalize(input, output + '.other.mp4'), { code: 'FINALIZE_CONFLICT' });
    await first;
    assert.equal(spawn.mock.callCount(), 3);
  });

  test('成功后取消超时，不出现迟到的终止信号或误报', async () => {
    installProcesses();
    await finalizer({ timeoutMs: 40, probeTimeoutMs: 40 }).finalize(input, output);
    await new Promise(resolve => setTimeout(resolve, 60));
    for (const child of children) assert.equal(child.kill.mock.callCount(), 0);
  });

  test('封装超时先SIGTERM再SIGKILL，关闭后拒绝并保留原件', async () => {
    installProcesses({ onConvert: child => {
      child.kill.mock.mockImplementation(signal => {
        if (signal === 'SIGKILL') process.nextTick(() => child.emit('close', null, signal));
        return true;
      });
    } });
    await assert.rejects(finalizer({ timeoutMs: 15, terminateGraceMs: 10, killGraceMs: 10 })
      .finalize(input, output), { code: 'PROCESS_TIMEOUT' });
    assert.deepEqual(children[1].kill.mock.calls.map(call => call.arguments[0]), ['SIGTERM', 'SIGKILL']);
    assert.deepEqual(fs.readdirSync(directory), [path.basename(input)]);
  });

  test('子进程不发close事件也有界返回，不悬挂收尾任务', async () => {
    installProcesses({ onConvert: child => child.kill.mock.mockImplementation(() => true) });
    await assert.rejects(finalizer({ timeoutMs: 15, terminateGraceMs: 10, killGraceMs: 10 })
      .finalize(input, output), {
      code: 'PROCESS_TIMEOUT', processMayStillBeRunning: true
    });
    assert.deepEqual(fs.readdirSync(directory), [path.basename(input)]);
  });

  test('工具缺失错误拒绝且不把路径或原始进程错误写入异常消息', async () => {
    spawn.mock.mockImplementation(() => {
      const child = makeChild();
      child.pid = undefined;
      process.nextTick(() => child.emit('error', new Error('secret command details')));
      return child;
    });
    await assert.rejects(finalizer().finalize(input, output), {
      code: 'PROCESS_START_FAILED', message: 'Media process failed'
    });
    assert.equal(fs.existsSync(input), true);
  });

  test('显式FFmpeg目录推导同目录ffprobe，允许显式覆盖', () => {
    const configured = path.join(directory, 'ffmpeg.exe');
    assert.equal(new SegmentFinalizer({ ffmpegPath: configured }).ffprobePath,
      path.join(directory, 'ffprobe.exe'));
    assert.equal(new SegmentFinalizer({ ffmpegPath: configured, ffprobePath: 'custom-probe' }).ffprobePath,
      'custom-probe');
  });
});
