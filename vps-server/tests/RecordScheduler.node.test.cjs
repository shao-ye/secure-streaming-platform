const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** 创建只在当前用例中记录调用的依赖桩。 */
function stub(implementation = () => undefined) {
  const fn = (...args) => { fn.calls.push(args); return fn.impl(...args); };
  fn.calls = [];
  fn.impl = implementation;
  return fn;
}

/** 创建可由测试控制完成时刻的 Promise，模拟配置请求和频道锁等待。 */
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

/** 等待异步巡检进入指定阶段，不依赖真实网络、定时器或墙钟。 */
async function waitUntil(predicate) {
  for (let index = 0; index < 30; index++) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('测试未进入预期异步阶段');
}

/** 隔离加载调度器，外部依赖全部替换为本地桩，避免启动服务或读取真实配置。 */
function loadScheduler(clock, logger, runtime = {}) {
  const module = { exports: {} };
  clock.cronTasks = [];
  const deps = {
    'node-cron': { schedule: stub((pattern, callback) => {
      const task = { pattern, callback, stop: stub() };
      clock.cronTasks.push(task);
      return task;
    }) },
    'moment-timezone': () => ({ tz: () => ({ format: () => clock.time }) }),
    '../utils/logger': logger,
    './WorkdayChecker': class {
      constructor() {
        this.initialize = stub(async () => undefined);
        this.isWorkday = stub(async () => true);
      }
    },
    '../../config': { workersApiUrl: 'https://workers.example.test' }
  };
  const filename = path.resolve(__dirname, '../src/services/RecordScheduler.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: name => {
      assert.ok(Object.hasOwn(deps, name), `未隔离依赖: ${name}`);
      return deps[name];
    },
    process: { env: {} },
    fetch: runtime.fetch || (() => { throw new Error('测试禁止访问真实网络'); }),
    AbortSignal: runtime.AbortSignal || AbortSignal,
    setInterval: () => ({ unref() {} }), clearInterval: () => undefined
  }, { filename });
  return module.exports;
}

describe('RecordScheduler 健康恢复的录制模式和过期任务保护', () => {
  let scheduler;
  let manager;
  let channelConfig;
  let logger;
  let clock;

  beforeEach(() => {
    clock = { time: '09:12' };
    logger = { info: stub(), warn: stub(), error: stub(), debug: stub() };
    manager = {
      getRecordingStatus: stub(() => ({ channels: [] })),
      getRecordingOutputHealth: stub(() => ({ healthy: true, reason: 'output_fresh' })),
      isChannelTransitioning: stub(() => false),
      recoverRecording: stub(async () => ({ recovered: true })),
      disableRecording: stub(async () => undefined),
      enableRecording: stub(async () => undefined),
      recordingChannels: new Set()
    };
    const RecordScheduler = loadScheduler(clock, logger);
    scheduler = new RecordScheduler(manager);
    scheduler.isRunning = true;
    channelConfig = {
      channelId: 'stream_classroom', channelName: '教室', enabled: true,
      startTime: '07:40', endTime: '17:20', workdaysOnly: false,
      segmentEnabled: false, segmentDuration: 30
    };
    scheduler.channelConfigs.set(channelConfig.channelId, channelConfig);
    scheduler.fetchSystemSettings = stub(async () => ({ segmentEnabled: true, segmentDuration: 60 }));
  });

  it('状态缺失时直接请求锁内录制恢复，不经过禁用和纯观看启动', async () => {
    await scheduler.recoverInterruptedRecordings();
    assert.equal(manager.recoverRecording.calls.length, 1);
    const [channelId, config, options] = manager.recoverRecording.calls[0];
    assert.equal(channelId, channelConfig.channelId);
    assert.deepEqual(JSON.parse(JSON.stringify(config)), {
      ...channelConfig, segmentEnabled: true, segmentDuration: 60
    });
    assert.equal(options.maxStaleMs, scheduler.recordingOutputStaleMs);
    assert.equal(await options.shouldRecover(), true);
    assert.equal(manager.disableRecording.calls.length, 0);
    assert.equal(manager.enableRecording.calls.length, 0);
  });

  for (const state of ['starting', 'stopping']) {
    it(`${state} 状态不会被当作中断录制`, async () => {
      manager.getRecordingStatus.impl = () => ({ channels: [{
        channelId: channelConfig.channelId, state, isActive: false, isRecording: false
      }] });
      await scheduler.recoverInterruptedRecordings();
      assert.equal(scheduler.fetchSystemSettings.calls.length, 0);
      assert.equal(manager.recoverRecording.calls.length, 0);
    });
  }

  it('频道正在锁内切换时跳过巡检', async () => {
    manager.isChannelTransitioning.impl = () => true;
    await scheduler.recoverInterruptedRecordings();
    assert.equal(manager.recoverRecording.calls.length, 0);
    assert.equal(scheduler.fetchSystemSettings.calls.length, 0);
  });

  it('健康录制不恢复，输出陈旧时由锁内接口再次确认', async () => {
    manager.getRecordingStatus.impl = () => ({ channels: [{
      channelId: channelConfig.channelId, state: 'recording', isActive: true, isRecording: true
    }] });
    await scheduler.recoverInterruptedRecordings();
    assert.equal(manager.recoverRecording.calls.length, 0);
    manager.getRecordingOutputHealth.impl = () => ({ healthy: false, reason: 'recording_output_stale' });
    await scheduler.recoverInterruptedRecordings();
    assert.equal(manager.recoverRecording.calls.length, 1);
  });

  it('重叠巡检只允许一轮进入同一频道恢复', async () => {
    const settings = deferred();
    scheduler.fetchSystemSettings.impl = () => settings.promise;
    const first = scheduler.recoverInterruptedRecordings();
    const second = scheduler.recoverInterruptedRecordings();
    await waitUntil(() => scheduler.fetchSystemSettings.calls.length > 0);
    settings.resolve({ segmentEnabled: true, segmentDuration: 60 });
    await Promise.all([first, second]);
    assert.equal(scheduler.fetchSystemSettings.calls.length, 1);
    assert.equal(manager.recoverRecording.calls.length, 1);
  });

  for (const action of ['stop', 'replace', 'end_time']) {
    it(`读取配置期间 ${action} 会取消本轮恢复`, async () => {
      const settings = deferred();
      scheduler.fetchSystemSettings.impl = () => settings.promise;
      const recovery = scheduler.recoverInterruptedRecordings();
      await waitUntil(() => scheduler.fetchSystemSettings.calls.length > 0);
      if (action === 'stop') await scheduler.stop();
      if (action === 'replace') scheduler.channelConfigs.set(channelConfig.channelId, { ...channelConfig });
      if (action === 'end_time') clock.time = '17:20';
      settings.resolve({ segmentEnabled: true, segmentDuration: 60 });
      await recovery;
      assert.equal(manager.recoverRecording.calls.length, 0);
      assert.equal(scheduler.recoveryLocks.size, 0);
    });
  }

  it('等待管理器频道锁期间取消调度，锁内复核拒绝恢复', async () => {
    const lock = deferred();
    const restart = stub();
    manager.recoverRecording.impl = async (id, config, options) => {
      await lock.promise;
      if (await options.shouldRecover()) restart();
    };
    const recovery = scheduler.recoverInterruptedRecordings();
    await waitUntil(() => manager.recoverRecording.calls.length > 0);
    scheduler.unscheduleChannel(channelConfig.channelId);
    lock.resolve();
    await recovery;
    assert.equal(restart.calls.length, 0);
  });

  it('工作日检查跨过停止时刻后拒绝恢复', async () => {
    const workday = deferred();
    channelConfig.workdaysOnly = true;
    scheduler.workdayChecker.isWorkday.impl = () => workday.promise;
    const allowed = scheduler.canRecoverRecording(channelConfig.channelId, channelConfig);
    clock.time = '17:20';
    workday.resolve(true);
    assert.equal(await allowed, false);
  });

  it('恢复失败被记录且释放恢复标记，后续巡检仍可重试', async () => {
    manager.recoverRecording.impl = async () => { throw new Error('启动失败'); };
    await scheduler.recoverInterruptedRecordings();
    assert.equal(logger.error.calls[0][0], 'Failed to recover interrupted recording');
    assert.equal(logger.error.calls[0][1].error, '启动失败');
    assert.equal(scheduler.recoveryLocks.size, 0);
    await scheduler.recoverInterruptedRecordings();
    assert.equal(manager.recoverRecording.calls.length, 2);
  });

  it('普通启动携带锁内复核回调，配置仍有效时允许启动', async () => {
    await scheduler.startRecording(channelConfig);
    assert.equal(manager.enableRecording.calls.length, 1);
    const [channelId, config, options] = manager.enableRecording.calls[0];
    assert.equal(channelId, channelConfig.channelId);
    assert.equal(config.segmentDuration, 60);
    assert.equal(await options.shouldStart(), true);
  });

  for (const action of ['stop_channel', 'shutdown', 'reload_channel', 'reload_all', 'end_time']) {
    it(`普通启动读取配置期间 ${action} 会使旧启动失效`, async () => {
      const settings = deferred();
      scheduler.fetchSystemSettings.impl = () => settings.promise;
      const starting = scheduler.startRecording(channelConfig);
      await waitUntil(() => scheduler.fetchSystemSettings.calls.length > 0);
      if (action === 'stop_channel') await scheduler.stopRecording(channelConfig.channelId);
      if (action === 'shutdown') await scheduler.stop();
      if (action === 'reload_channel') {
        await scheduler.reloadScheduleWithConfig(channelConfig.channelId, { ...channelConfig, enabled: false });
      }
      if (action === 'reload_all') {
        scheduler.fetchRecordConfigs = stub(async () => []);
        await scheduler.reloadSchedule();
      }
      if (action === 'end_time') clock.time = '17:20';
      settings.resolve({ segmentEnabled: true, segmentDuration: 60 });
      assert.equal((await starting).skipped, true);
      assert.equal(manager.enableRecording.calls.length, 0);
    });
  }

  it('普通启动排队等待管理器锁期间停录，锁内回调不允许再次 spawn', async () => {
    const lock = deferred();
    const spawn = stub();
    manager.enableRecording.impl = async (id, config, options) => {
      await lock.promise;
      if (!(await options.shouldStart())) return { skipped: true };
      spawn();
      return { status: 'success' };
    };
    const starting = scheduler.startRecording(channelConfig);
    await waitUntil(() => manager.enableRecording.calls.length > 0);
    await scheduler.stopRecording(channelConfig.channelId);
    lock.resolve();
    assert.equal((await starting).skipped, true);
    assert.equal(spawn.calls.length, 0);
    assert.equal(logger.info.calls.some(call => call[0] === 'Recording started successfully'), false);
  });

  it('旧 cron 在工作日异步判断期间关停，不会继续获取配置或启动进程', async () => {
    const workday = deferred();
    scheduler.workdayChecker.isWorkday.impl = () => workday.promise;
    scheduler.scheduleChannel({ ...channelConfig, workdaysOnly: true });
    const startTask = clock.cronTasks.find(task => task.pattern === '40 07 * * *');
    const starting = startTask.callback();
    await waitUntil(() => scheduler.workdayChecker.isWorkday.calls.length > 0);
    await scheduler.stop();
    workday.resolve(true);
    await starting;
    assert.equal(scheduler.fetchSystemSettings.calls.length, 0);
    assert.equal(manager.enableRecording.calls.length, 0);
  });

  it('初始化尚未 isRunning 时允许本代立即录制并完成调度启动', async () => {
    scheduler.isRunning = false;
    scheduler.channelConfigs.clear();
    scheduler.fetchRecordConfigs = stub(async () => [channelConfig]);
    manager.enableRecording.impl = async (id, config, options) => {
      assert.equal(scheduler.isRunning, false);
      assert.equal(scheduler.isStarting, true);
      assert.equal(await options.shouldStart(), true);
      return { status: 'success' };
    };
    await scheduler.start();
    assert.equal(manager.enableRecording.calls.length, 1);
    assert.equal(scheduler.isRunning, true);
    assert.equal(scheduler.isStarting, false);
    assert.equal(scheduler.cronTasks.size, 1);
  });

  it('初始化读取配置期间关停，不会在请求返回后重新登记 cron 或启动健康检查', async () => {
    const configs = deferred();
    scheduler.isRunning = false;
    scheduler.channelConfigs.clear();
    scheduler.fetchRecordConfigs = stub(() => configs.promise);
    const starting = scheduler.start();
    await waitUntil(() => scheduler.fetchRecordConfigs.calls.length > 0);
    await scheduler.stop();
    configs.resolve([channelConfig]);
    await starting;
    assert.equal(manager.enableRecording.calls.length, 0);
    assert.equal(scheduler.cronTasks.size, 0);
    assert.equal(scheduler.healthCheckTimer, null);
    assert.equal(scheduler.isRunning, false);
    assert.equal(scheduler.isStarting, false);
  });

  it('整体重载请求返回晚于关停时不恢复调度', async () => {
    const configs = deferred();
    scheduler.fetchRecordConfigs = stub(() => configs.promise);
    const reloading = scheduler.reloadSchedule();
    await scheduler.stop();
    configs.resolve([channelConfig]);
    assert.equal((await reloading).skipped, true);
    assert.equal(scheduler.cronTasks.size, 0);
    assert.equal(manager.enableRecording.calls.length, 0);
  });

  it('初始化配置请求期间禁用频道，旧整批响应不能重新启用该频道', async () => {
    const configs = deferred();
    scheduler.isRunning = false;
    scheduler.channelConfigs.clear();
    scheduler.fetchRecordConfigs = stub(() => configs.promise);
    const starting = scheduler.start();
    await waitUntil(() => scheduler.fetchRecordConfigs.calls.length > 0);
    await scheduler.reloadScheduleWithConfig(channelConfig.channelId, { ...channelConfig, enabled: false });
    configs.resolve([channelConfig]);
    await starting;
    assert.equal(scheduler.isRunning, true);
    assert.equal(scheduler.channelConfigs.has(channelConfig.channelId), false);
    assert.equal(manager.enableRecording.calls.length, 0);
  });

  it('整批重载等待期间的新单频道配置优先，不被旧响应覆盖或误停录', async () => {
    const configs = deferred();
    manager.getRecordingStatus.impl = () => ({ channels: [{
      channelId: channelConfig.channelId, state: 'recording', isActive: true, isRecording: true
    }] });
    scheduler.fetchRecordConfigs = stub(() => configs.promise);
    const reloading = scheduler.reloadSchedule();
    await scheduler.reloadScheduleWithConfig(channelConfig.channelId, { ...channelConfig, endTime: '18:00' });
    configs.resolve([]);
    await reloading;
    assert.equal(scheduler.channelConfigs.get(channelConfig.channelId).endTime, '18:00');
    assert.equal(scheduler.cronTasks.size, 1);
    assert.equal(manager.disableRecording.calls.length, 0);
  });

  it('整批重载等待跨过结束时刻后补执行停录，避免漏掉已取消的 stop cron', async () => {
    const configs = deferred();
    manager.getRecordingStatus.impl = () => ({ channels: [{
      channelId: channelConfig.channelId, state: 'recording', isActive: true, isRecording: true
    }] });
    scheduler.scheduleChannel(channelConfig);
    scheduler.fetchRecordConfigs = stub(() => configs.promise);
    const reloading = scheduler.reloadSchedule();
    clock.time = '17:20';
    configs.resolve([channelConfig]);
    await reloading;
    assert.equal(manager.disableRecording.calls.length, 1);
    assert.equal(manager.enableRecording.calls.length, 0);
    assert.equal(scheduler.cronTasks.size, 1);
  });

  it('整批重载中单个无效配置不妨碍其他频道恢复调度', async () => {
    scheduler.fetchRecordConfigs = stub(async () => [
      { ...channelConfig, channelId: 'invalid_channel', startTime: undefined }, channelConfig
    ]);
    await scheduler.reloadSchedule();
    assert.equal(scheduler.cronTasks.has(channelConfig.channelId), true);
    assert.equal(scheduler.channelConfigs.has('invalid_channel'), false);
    assert.equal(manager.enableRecording.calls.length, 1);
    assert.equal(logger.error.calls.some(call => call[0] === 'Failed to reload config'), true);
  });

  it('两个配置请求均绑定 10 秒 AbortSignal，超时沿用原有失败回退', async () => {
    const signal = { testOnlySignal: true };
    const timeout = stub(() => signal);
    const fetch = stub(async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); });
    const RecordScheduler = loadScheduler(clock, logger, { fetch, AbortSignal: { timeout } });
    const isolated = new RecordScheduler(manager);
    const settings = await isolated.fetchSystemSettings();
    const configs = await isolated.fetchRecordConfigs();
    assert.deepEqual(JSON.parse(JSON.stringify(settings)), { segmentEnabled: false, segmentDuration: 60 });
    assert.equal(configs.length, 0);
    assert.deepEqual(timeout.calls, [[10000], [10000]]);
    assert.equal(fetch.calls.length, 2);
    assert.equal(fetch.calls.every(call => call[1].signal === signal), true);
  });
});
