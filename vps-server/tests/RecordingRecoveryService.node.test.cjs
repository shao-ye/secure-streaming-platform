const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

/** 装载真实恢复类并隔离日志、计时器，不加载生产配置或发起外部请求。 */
function loadRecovery(onObservation) {
  const logs = [];
  const logger = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level,
    (message, data) => logs.push({ level, message, data })]));
  const context = {
    module: { exports: {} }, process, setImmediate, clearTimeout,
    setTimeout(callback, delay) {
      if (delay === 300) {
        if (onObservation) onObservation();
        return setTimeout(callback, 0);
      }
      return setTimeout(callback, delay);
    },
    require(name) { return name === '../utils/logger' ? logger : require(name); }
  };
  const file = path.join(__dirname, '../src/services/RecordingRecoveryService.js');
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
  return { Recovery: context.module.exports, logs };
}

/** 每个用例只在自己创建的临时目录内放置样本，并核对路径后清理。 */
function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoyo-recovery-test-'));
  t.after(() => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.match(path.basename(resolved), /^yoyo-recovery-test-/);
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const input = path.join(root, '教室_stream_test_20261019_090000_temp_000.mp4');
  fs.writeFileSync(input, 'original-recording-bytes');
  const time = new Date(Date.now() - 60000);
  fs.utimesSync(input, time, time);
  const file = { path: input, type: 'temp', channel: { id: 'stream_test' } };
  let locked = false;
  const conversions = [];
  const dispatches = [];
  const manager = {
    activeStreams: new Map(),
    async withChannelLock(channelId, run) {
      assert.equal(channelId, file.channel.id);
      assert.equal(locked, false, '禁止同锁重入');
      locked = true;
      try { return await run(); } finally { locked = false; }
    },
    isRecordingFileActive() { assert.equal(locked, true); return false; },
    async convertSegmentToStandardMp4(source, target) {
      assert.equal(locked, true, '检查与转换必须在同一频道锁内');
      conversions.push({ source, target });
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    }
  };
  return { file, input, manager, conversions, dispatches };
}

/** 固定媒体时长，保留被测类真实命名、筛选和转换调用流程。 */
function createService(Recovery, fixture) {
  const service = new Recovery(fixture.manager);
  service.findTempFiles = async () => [fixture.file];
  service.findFilesNeedingRecovery = async () => [fixture.file];
  service.getVideoDuration = async () => 60;
  service.setFinalizeDispatcher({ onFinalize: (...args) => fixture.dispatches.push(args) });
  return service;
}

test('自动恢复跳过仍在 starting 的会话，即使临时文件大小不变', async t => {
  const fixture = createFixture(t);
  const { Recovery, logs } = loadRecovery();
  fixture.manager.activeStreams.set('stream_test', { state: 'starting', isRecording: true });
  const service = createService(Recovery, fixture);
  service._waitForSizeObservation = async () => true;
  await service.runRecoveryWithSizeCheck();
  assert.equal(fixture.conversions.length, 0);
  assert.equal(fixture.dispatches.length, 0);
  assert.equal(fs.readFileSync(fixture.input, 'utf8'), 'original-recording-bytes');
  assert.equal(logs.find(entry => entry.message === 'Recovery completed').data.skipped, 1);
});

test('自动恢复跳过当前活跃文件，允许同频道不被占用的历史文件', async t => {
  const fixture = createFixture(t);
  const { Recovery } = loadRecovery();
  fixture.manager.activeStreams.set('stream_test', { state: 'running', isRecording: true });
  let active = true;
  fixture.manager.isRecordingFileActive = () => active;
  const service = createService(Recovery, fixture);
  service._waitForSizeObservation = async () => true;
  await service.runRecoveryWithSizeCheck();
  assert.equal(fixture.conversions.length, 0);
  active = false;
  await service.runRecoveryWithSizeCheck();
  assert.equal(fixture.conversions.length, 1);
  assert.equal(fixture.dispatches.length, 1);
});

test('候选在等待频道锁期间发生变化时不再处理', async t => {
  const fixture = createFixture(t);
  const { Recovery } = loadRecovery();
  const originalLock = fixture.manager.withChannelLock;
  fixture.manager.withChannelLock = (channelId, run) => {
    fs.appendFileSync(fixture.input, '-new-data');
    return originalLock(channelId, run);
  };
  const service = createService(Recovery, fixture);
  service._waitForSizeObservation = async () => true;
  await service.runRecoveryWithSizeCheck();
  assert.equal(fixture.conversions.length, 0);
});

test('频道锁内稳定性观察发现继续写入时跳过', async t => {
  const fixture = createFixture(t);
  const { Recovery } = loadRecovery(() => fs.appendFileSync(fixture.input, '-more-data'));
  const service = createService(Recovery, fixture);
  service._waitForSizeObservation = async () => true;
  await service.runRecoveryWithSizeCheck();
  assert.equal(fixture.conversions.length, 0);
  assert.equal(fixture.dispatches.length, 0);
});

test('重封装失败保留源文件且不派发上传，汇总记录 failed', async t => {
  const fixture = createFixture(t);
  const { Recovery, logs } = loadRecovery();
  fixture.manager.convertSegmentToStandardMp4 = async () => { throw new Error('invalid media'); };
  const service = createService(Recovery, fixture);
  service._waitForSizeObservation = async () => true;
  await service.runRecoveryWithSizeCheck();
  assert.equal(fs.readFileSync(fixture.input, 'utf8'), 'original-recording-bytes');
  assert.equal(fixture.dispatches.length, 0);
  const summary = logs.find(entry => entry.message === 'Recovery completed').data;
  assert.equal(summary.failed, 1);
  assert.equal(summary.renamed, 0);
});

test('手动恢复在锁内重新核对 30 秒保护期及频道录制状态', async t => {
  const fixture = createFixture(t);
  const { Recovery } = loadRecovery();
  const service = createService(Recovery, fixture);
  fs.utimesSync(fixture.input, new Date(), new Date());
  await service.runRecovery();
  assert.equal(fixture.conversions.length, 0);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(fixture.input, old, old);
  fixture.manager.activeStreams.set('stream_test', { state: 'running', isRecording: true });
  await service.runRecovery();
  assert.equal(fixture.conversions.length, 0);
  fixture.manager.activeStreams.clear();
  await service.runRecovery();
  assert.equal(fixture.conversions.length, 1);
});

test('自动扫描期间手动请求不重入，stop 可取消 30 秒观察', async t => {
  const fixture = createFixture(t);
  const { Recovery } = loadRecovery();
  const service = createService(Recovery, fixture);
  const automatic = service.runRecoveryWithSizeCheck();
  while (!service.sizeCheckTimer) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await service.runRecovery()).status, 'skipped');
  await service.stop();
  await automatic;
  assert.equal(service.sizeCheckTimer, null);
  assert.equal(service.recoveryPromise, null);
  assert.equal(fixture.conversions.length, 0);
  assert.equal((await service.runRecovery()).status, 'skipped');
});

test('重复 startup 只调度一次，stop 取消尚未开始的扫描', async t => {
  const fixture = createFixture(t);
  const { Recovery } = loadRecovery();
  const service = createService(Recovery, fixture);
  service.config.delayStart = 20;
  let scans = 0;
  service.findTempFiles = async () => { scans++; return []; };
  await service.startup();
  const firstTimer = service.startupTimer;
  await service.startup();
  assert.equal(service.startupTimer, firstTimer);
  await service.stop();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(scans, 0);
});

test('stop 等待已经开始的转换完成，不会中断并误报文件最终化', async t => {
  const fixture = createFixture(t);
  const { Recovery } = loadRecovery();
  const service = createService(Recovery, fixture);
  let release;
  let started;
  const conversionStarted = new Promise(resolve => { started = resolve; });
  const conversionGate = new Promise(resolve => { release = resolve; });
  fixture.manager.convertSegmentToStandardMp4 = async (source, target) => {
    started();
    await conversionGate;
    fs.copyFileSync(source, target);
  };
  const running = service.runRecovery();
  await conversionStarted;
  let stopped = false;
  const stopping = service.stop().then(() => { stopped = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(stopped, false);
  assert.equal(fixture.dispatches.length, 0);
  release();
  await Promise.all([running, stopping]);
  assert.equal(stopped, true);
  assert.equal(fixture.dispatches.length, 1);
});
