const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

/** 创建可精确安排启动、退出和封装顺序的异步屏障。 */
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

/** 创建模拟 FFmpeg；killed 标志仅记录已发信号，与真实 Node 行为保持一致。 */
function child({ autoClose = true } = {}) {
  const proc = new EventEmitter();
  proc.pid = 100;
  proc.stderr = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.signals = [];
  proc.kill = signal => {
    proc.killed = true;
    proc.signals.push(signal);
    if (autoClose) queueMicrotask(() => {
      proc.emit('exit', 255, null);
      proc.emit('close', 255, null);
    });
    return true;
  };
  return proc;
}

/** 隔离加载真实管理器逻辑，避免初始化清理真实机器进程及读取生产配置。 */
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-lifecycle-'));
  const module = { exports: {} };
  const noop = () => {};
  const deps = {
    child_process: {
      ...childProcess,
      spawn: options.spawn || (() => child()),
      execSync: () => { throw new Error('No proxy in test'); }
    },
    util: require('node:util'), path, fs,
    crypto: require('node:crypto'),
    '../utils/logger': options.logger || { info: noop, debug: noop, warn: noop, error: noop },
    '../../config': { vpsBaseUrl: 'http://test.invalid', workersApiUrl: 'http://test.invalid', getOptionalValue: (v, fallback) => v || fallback },
    './recording/SegmentFinalizer': options.Finalizer || class { async finalize() {} },
    axios: { get: async () => ({ data: { status: 'success', data: { channelName: '教室', videoAspectRatio: '16:9' } } }) }
  };
  const filename = path.resolve(__dirname, '../src/services/SimpleStreamManager.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: name => { assert.ok(Object.hasOwn(deps, name), `Unexpected dependency ${name}`); return deps[name]; },
    process: { env: { HLS_OUTPUT_DIR: path.join(root, 'hls'), RECORDINGS_PATH: path.join(root, 'recordings'), FFMPEG_PATH: 'ffmpeg' } },
    setTimeout: options.setTimeout || setTimeout, clearTimeout: options.clearTimeout || clearTimeout,
    setInterval, clearInterval, setImmediate, queueMicrotask, AbortSignal, Date, console
  }, { filename });
  const Manager = module.exports;
  Manager.prototype.initialize = async function () {};
  const manager = new Manager();
  t.after(async () => {
    await manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const config = { channelName: '教室', rtmpUrl: 'rtmp://test.invalid/live', segmentEnabled: true, segmentDuration: 60, endTime: '17:20' };
  return { manager, root, config };
}

/** 登记带受控子进程的当前会话，复用真正的状态与退出回调。 */
function attach(manager, config, { recording = true, autoClose = true, state = 'recording' } = {}) {
  const recordConfig = { ...config, sessionStartTime: Date.now() };
  const info = manager._registerStream('stream_test', config.rtmpUrl, 'scale=ih*16/9:ih', recording ? {
    isRecording: true, recordConfig,
    recordingPath: manager.generateRecordingPath('stream_test', config.channelName, recordConfig)
  } : {});
  manager._attachProcessLifecycle(info, child({ autoClose }));
  info.state = state;
  if (recording) manager.recordingConfigs.set('stream_test', recordConfig);
  return info;
}

test('启动等待期间登记 starting；并发健康恢复拿锁后复核，不能提前收尾', async t => {
  const { manager, config } = fixture(t);
  const started = deferred();
  const ready = deferred();
  let spawns = 0;
  manager.spawnFFmpegWithRecording = async (id, url, file, cfg, filter, info) => {
    spawns++;
    manager._attachProcessLifecycle(info, child());
    started.resolve();
    await ready.promise;
  };
  manager.getRecordingOutputHealth = () => ({ healthy: true });
  const enabling = manager.enableRecording('stream_test', config);
  await started.promise;
  assert.equal(manager.getRecordingStatus().channels[0].state, 'starting');
  assert.equal(manager.isChannelTransitioning('stream_test'), true);
  const recovery = manager.recoverRecording('stream_test', config, { shouldRecover: async () => true });
  assert.equal(manager.activeStreams.get('stream_test').process.signals.length, 0);
  ready.resolve();
  await Promise.all([enabling, recovery]);
  assert.equal(spawns, 1);
  assert.equal(manager.getRecordingStatus().channels[0].state, 'recording');
});

test('配置未知的观看请求复用录制进程，不改变滤镜或录制意图', async t => {
  const { manager, config } = fixture(t);
  const info = attach(manager, config);
  const result = await manager.startWatching('stream_test', config.rtmpUrl, null);
  assert.equal(result, info.hlsUrl);
  assert.equal(manager.activeStreams.get('stream_test'), info);
  assert.equal(info.process.signals.length, 0);
});

for (const change of ['ratio', 'rtmp', 'manual']) {
  test(`${change} 触发重启时先关闭旧进程并保持录制模式`, async t => {
    const { manager, config } = fixture(t);
    const old = attach(manager, config);
    const calls = [];
    manager.startNewStream = async () => { throw new Error('Must not start viewing-only'); };
    manager.startStreamWithRecording = async (...args) => {
      assert.equal(old.closed, true);
      assert.equal(manager.activeStreams.has('stream_test'), false);
      calls.push(args);
      return 'recording-hls';
    };
    if (change === 'manual') await manager.restartChannel('stream_test', config.rtmpUrl);
    else await manager.startWatching('stream_test', change === 'rtmp' ? 'rtmp://changed.invalid/live' : config.rtmpUrl,
      change === 'ratio' ? { videoAspectRatio: 'original' } : null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][2].segmentEnabled, true);
    assert.equal(calls[0][3], change === 'ratio' ? null : old.videoFilter);
  });
}

test('旧进程迟到的 exit/close 不删除新会话状态、心跳或 HLS', async t => {
  const { manager, config } = fixture(t);
  const old = attach(manager, config, { autoClose: false });
  manager.activeStreams.delete('stream_test');
  const current = attach(manager, config);
  const dir = path.join(manager.hlsOutputDir, 'stream_test');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'playlist.m3u8'), 'new-session');
  manager.channelHeartbeats.set('stream_test', 123);
  old.process.emit('exit', 1, null);
  old.process.emit('close', 1, null);
  await manager.withChannelLock('stream_test', async () => {});
  assert.equal(manager.activeStreams.get('stream_test'), current);
  assert.equal(manager.channelHeartbeats.get('stream_test'), 123);
  assert.equal(fs.readFileSync(path.join(dir, 'playlist.m3u8'), 'utf8'), 'new-session');
});

test('先等 close 和已完成分段的封装，再收尾当前段', async t => {
  const { manager, config } = fixture(t);
  const info = attach(manager, config, { autoClose: false });
  const segment = deferred();
  info.segmentQueue = segment.promise;
  let finalizations = 0;
  manager.renameFinalSegment = async () => { assert.equal(info.closed, true); finalizations++; };
  const stopping = manager.disableRecording('stream_test');
  await new Promise(setImmediate);
  assert.deepEqual(info.process.signals, ['SIGTERM']);
  assert.equal(finalizations, 0);
  info.process.emit('exit', 255, null);
  await new Promise(setImmediate);
  assert.equal(finalizations, 0);
  info.process.emit('close', 255, null);
  await new Promise(setImmediate);
  assert.equal(finalizations, 0);
  segment.resolve();
  await stopping;
  assert.equal(finalizations, 1);
});

test('已发送 SIGTERM 但未关闭时仍升级 SIGKILL，不能假报停止完成', async t => {
  const timers = new Map();
  const { manager, config } = fixture(t, {
    setTimeout: (callback, ms) => { timers.set(ms, callback); return ms; },
    clearTimeout: ms => timers.delete(ms)
  });
  const info = attach(manager, config, { autoClose: false });
  const stopping = manager.disableRecording('stream_test');
  await new Promise(setImmediate);
  assert.equal(info.process.killed, true);
  timers.get(5000)();
  assert.deepEqual(info.process.signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(info.closed, false);
  info.process.emit('exit', null, 'SIGKILL');
  info.process.emit('close', null, 'SIGKILL');
  await stopping;
  assert.equal(timers.size, 0);
});

test('就绪超时后必须关闭刚创建的 FFmpeg，不留下未登记进程', async t => {
  const proc = child();
  const { manager } = fixture(t, { spawn: () => proc });
  manager.waitForStreamReady = async () => { throw new Error('test readiness timeout'); };
  await assert.rejects(manager.startWatching('stream_test', 'rtmp://test.invalid/live'), /test readiness timeout/);
  assert.deepEqual(proc.signals, ['SIGTERM']);
  assert.equal(manager.activeStreams.size, 0);
});

/** 写入用于就绪检查的真实 HLS 文件，可选择把它标记为旧会话产物。 */
function writeHls(manager, info, stale = false) {
  const dir = path.join(manager.hlsOutputDir, info.channelId);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of [['playlist.m3u8', '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:2,\nsegment001.ts\n'], ['segment001.ts', Buffer.alloc(2048)]]) {
    const file = path.join(dir, name);
    fs.writeFileSync(file, content);
    // 显式构造新旧时间，避免 Linux 文件时间精度使刚创建的样本早于模拟 spawn。
    const timestamp = new Date(stale ? 0 : info.spawnedAt + 1);
    fs.utimesSync(file, timestamp, timestamp);
  }
}

test('旧播放列表即使含有效头和分片，也不能作为本次启动就绪依据', async t => {
  const { manager, config } = fixture(t);
  const info = attach(manager, config, { recording: false, state: 'starting' });
  writeHls(manager, info, true);
  await assert.rejects(manager.waitForStreamReady('stream_test', 30, info), /not ready/);
});

test('新 HLS 正常但录像不增长时，不能报告录制启动成功', async t => {
  const { manager, config } = fixture(t);
  const info = attach(manager, config, { state: 'starting' });
  writeHls(manager, info);
  fs.mkdirSync(path.dirname(info.recordingPath), { recursive: true });
  fs.writeFileSync(info.recordingPath.replace('%03d', '000'), Buffer.alloc(4096));
  fs.utimesSync(info.recordingPath.replace('%03d', '000'), new Date(info.spawnedAt + 1), new Date(info.spawnedAt + 1));
  await assert.rejects(manager.waitForStreamReady('stream_test', 30, info), /not ready/);
  // 此测试只检查就绪条件，移除伪造媒体，避免触发正式封装。
  fs.unlinkSync(info.recordingPath.replace('%03d', '000'));
});

test('本会话 HLS 与录像增长同时满足后才报告就绪', async t => {
  const { manager, config } = fixture(t);
  const info = attach(manager, config, { state: 'starting' });
  writeHls(manager, info);
  fs.mkdirSync(path.dirname(info.recordingPath), { recursive: true });
  const file = info.recordingPath.replace('%03d', '000');
  fs.writeFileSync(file, Buffer.alloc(4096));
  fs.utimesSync(file, new Date(info.spawnedAt + 1), new Date(info.spawnedAt + 1));
  const ready = manager.waitForStreamReady('stream_test', 3000, info);
  await new Promise(resolve => setTimeout(resolve, 60));
  fs.appendFileSync(file, Buffer.alloc(4096));
  await ready;
  fs.unlinkSync(file);
});

test('恢复拿到锁后发现已过时，既不停止当前进程也不启动新录制', async t => {
  const { manager, config } = fixture(t);
  const info = attach(manager, config);
  const result = await manager.recoverRecording('stream_test', config, { shouldRecover: async () => false });
  assert.equal(result.skipped, true);
  assert.equal(info.process.signals.length, 0);
});

test('活跃临时文件拒绝转换；前一段在下一段打开后才允许转换', async t => {
  const { manager, config } = fixture(t);
  const info = attach(manager, config);
  info.lastOpenedSegment = 1;
  let finalized = 0;
  manager.segmentFinalizer.finalize = async () => { finalized++; };
  await assert.rejects(manager.convertSegmentToStandardMp4(info.recordingPath.replace('%03d', '001'), 'output.mp4'), /active recording/);
  await manager.convertSegmentToStandardMp4(info.recordingPath.replace('%03d', '000'), 'output.mp4');
  assert.equal(finalized, 1);
});

test('收尾只处理指定会话模板，包括跨午夜，其他会话 temp 保持原样', async t => {
  const { manager, config } = fixture(t);
  const session = { ...config, sessionStartTime: Date.parse('2026-10-18T23:59:58+08:00') };
  const template = manager.generateRecordingPath('stream_test', config.channelName, session);
  const ours = template.replace('%03d', '000');
  const other = ours.replace('_235958_', '_235959_');
  fs.mkdirSync(path.dirname(ours), { recursive: true });
  fs.writeFileSync(ours, 'ours');
  fs.writeFileSync(other, 'other');
  const converted = [];
  manager.segmentFinalizer.finalize = async (input, output) => { converted.push(input); fs.renameSync(input, output); };
  await manager.renameFinalSegment('stream_test', session, template, Date.parse('2026-10-19T00:00:05+08:00'));
  assert.deepEqual(converted, [ours]);
  assert.equal(fs.readFileSync(other, 'utf8'), 'other');
  assert.ok(fs.readdirSync(path.dirname(ours)).some(name => name.endsWith('_235958_to_000005.mp4')));
});

test('封装失败保留 temp 且不触发上传派发', async t => {
  const { manager, config } = fixture(t);
  const session = { ...config, sessionStartTime: Date.now() };
  const template = manager.generateRecordingPath('stream_test', config.channelName, session);
  const file = template.replace('%03d', '000');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'original');
  manager.segmentFinalizer.finalize = async () => { throw new Error('conversion failed'); };
  let dispatched = 0;
  manager._safeFinalizeDispatch = () => dispatched++;
  await manager.renameFinalSegment('stream_test', session, template);
  assert.equal(fs.readFileSync(file, 'utf8'), 'original');
  assert.equal(dispatched, 0);
});

test('停止超时后的迟到 close 仍能收尾，不永久卡在 stopping', async t => {
  const timers = new Map();
  const { manager, config } = fixture(t, {
    setTimeout: (callback, ms) => { timers.set(ms, callback); return ms; },
    clearTimeout: ms => timers.delete(ms)
  });
  const info = attach(manager, config, { autoClose: false });
  const stopping = manager.disableRecording('stream_test');
  const rejected = assert.rejects(stopping, /did not close/);
  await new Promise(setImmediate);
  timers.get(10000)();
  await rejected;
  assert.equal(info.state, 'failed');
  info.process.emit('exit', null, 'SIGKILL');
  info.process.emit('close', null, 'SIGKILL');
  await manager.withChannelLock('stream_test', async () => {});
  assert.equal(manager.activeStreams.has('stream_test'), false);
});

test('HLS 清理失败也释放已关闭会话，后续启动可重试清理', async t => {
  const { manager, config } = fixture(t);
  const info = attach(manager, config);
  manager.cleanupChannelHLS = async () => { throw new Error('filesystem temporarily unavailable'); };
  await assert.rejects(manager.disableRecording('stream_test'), /filesystem temporarily unavailable/);
  assert.equal(info.closed, true);
  assert.equal(manager.activeStreams.has('stream_test'), false);
});

for (const mode of ['短分段', '长分段低码率', '单文件']) {
test(`真实 FFmpeg：${mode}启动双输出、停止并完成校验封装`, { timeout: 45000 }, async t => {
  const SegmentFinalizer = require('../src/services/recording/SegmentFinalizer');
  for (const command of ['ffmpeg', 'ffprobe']) {
    const version = childProcess.spawnSync(command, ['-version'], { timeout: 5000, windowsHide: true });
    assert.equal(version.status, 0, `${command} must be installed for integration verification`);
  }
  const { manager, config } = fixture(t, {
    Finalizer: SegmentFinalizer,
    spawn: (command, args, spawnOptions) => {
      // 用本机合成实时视频替代远端输入，其余双输出参数和生命周期均走产品代码。
      const input = args.indexOf('-i');
      const localArgs = [...args.slice(0, input), '-re', '-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=25'];
      for (let i = input + 2; i < args.length; i++) {
        if (args[i] === '-f' && ['hls', 'segment'].includes(args[i + 1])) localArgs.push('-g', '25', '-sc_threshold', '0');
        localArgs.push(args[i]);
      }
      const proc = childProcess.spawn(command, localArgs, { ...spawnOptions, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      if (process.platform === 'win32') {
        // Windows 的 SIGTERM 是强制结束；用 FFmpeg 的正常退出指令模拟生产 Linux 的信号收尾。
        const kill = proc.kill.bind(proc);
        proc.kill = signal => {
          if (signal === 'SIGTERM') { proc.stdin.write('q\n'); return true; }
          return kill(signal);
        };
      }
      return proc;
    }
  });
  const finalized = [];
  manager.setFinalizeDispatcher({ onFinalize: file => finalized.push(file) });
  const waitReady = manager.waitForStreamReady.bind(manager);
  manager.waitForStreamReady = async (id, timeout, info) => {
    const snapshots = [];
    const timer = setInterval(() => {
      snapshots.push({ opened: info.lastOpenedSegment, record: manager.getRecordingFileFreshness(info.recordingPath, Date.now(), 30000), hls: manager.getFileFreshness(path.join(manager.hlsOutputDir, id, 'playlist.m3u8'), Date.now(), 30000, 'hls'), finalized: finalized.length });
      if (snapshots.length > 3) snapshots.shift();
    }, 1000);
    try { return await waitReady(id, 15000, info); }
    catch (error) { throw new Error(`${error.message}: ${JSON.stringify(snapshots)}`); }
    finally { clearInterval(timer); }
  };
  await manager.enableRecording('stream_test', {
    ...config, segmentEnabled: mode !== '单文件', segmentDuration: mode === '短分段' ? 0.05 : 60
  });
  assert.equal(manager.getRecordingStatus().channels[0].state, 'recording');
  const info = manager.activeStreams.get('stream_test');
  const sessionPath = info.recordingPath;
  assert.ok(sessionPath.includes('_temp_'), 'active files must never use final upload names');
  await new Promise(resolve => setTimeout(resolve, 3500));
  await manager.disableRecording('stream_test');
  assert.equal(info.closed, true);
  assert.equal(manager.activeStreams.size, 0);
  assert.ok(finalized.length >= (mode === '短分段' ? 2 : 1), 'completed recordings should be published after validation');
  const files = fs.readdirSync(path.dirname(sessionPath));
  assert.equal(files.filter(name => name.includes('_temp_') || name.includes('.part.')).length, 0);
  for (const file of finalized) {
    const probe = childProcess.spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    assert.equal(probe.status, 0);
    assert.ok(Number(JSON.parse(probe.stdout).format.duration) > 0);
  }
});
}
