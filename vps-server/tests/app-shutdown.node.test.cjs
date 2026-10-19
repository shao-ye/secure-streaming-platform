const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** 执行 app 中真实关停函数，隔离服务器启动、生产配置、网络和 process.exit。 */
function loadShutdown(overrides = {}) {
  const events = [];
  const errors = [];
  const stop = name => ({ stop: async () => events.push(name) });
  const context = {
    logger: { info() {}, error: (...args) => errors.push(args) },
    process: { exit: code => events.push(`exit:${code}`) },
    recordScheduler: stop('recordScheduler'),
    preloadScheduler: stop('preloadScheduler'),
    preloadHealthCheck: stop('preloadHealthCheck'),
    uploadScanner: stop('uploadScanner'),
    videoCleanupScheduler: stop('videoCleanupScheduler'),
    recoveryService: stop('recoveryService'),
    streamManager: {
      beginShutdown: () => events.push('beginShutdown'),
      destroy: async () => events.push('streamManager')
    },
    processManager: { stopAllStreams: async () => events.push('processManager') },
    uploadWorker: stop('uploadWorker'),
    ...overrides
  };
  const file = path.join(__dirname, '../src/app.js');
  const source = fs.readFileSync(file, 'utf8');
  const begin = source.indexOf('let shutdownPromise = null;');
  const end = source.indexOf("process.on('SIGTERM'", begin);
  assert.ok(begin >= 0 && end > begin, '能定位真实关停函数');
  vm.runInNewContext(`${source.slice(begin, end)}\nglobalThis.shutdown = gracefulShutdown;`, context, { filename: file });
  return { shutdown: context.shutdown, events, errors };
}

test('先阻止新会话并停止调度/扫描，再等待真实 manager 和其他实例，最后退出', async () => {
  const { shutdown, events } = loadShutdown();
  await shutdown('SIGTERM');
  assert.deepEqual(events, [
    'beginShutdown', 'recordScheduler', 'preloadScheduler', 'preloadHealthCheck', 'uploadScanner',
    'videoCleanupScheduler', 'recoveryService', 'streamManager', 'processManager', 'uploadWorker', 'exit:0'
  ]);
});

test('第一个调度器停止仍在等待时，已经同步禁止新会话且重复信号不重入', async () => {
  let release;
  let beginCalls = 0;
  const order = [];
  const gate = new Promise(resolve => { release = resolve; });
  const { shutdown, events } = loadShutdown({
    streamManager: {
      beginShutdown: () => { beginCalls++; order.push('beginShutdown'); },
      destroy: async () => order.push('destroy')
    },
    recordScheduler: { stop: async () => { order.push('record:stop'); await gate; } }
  });
  const pending = shutdown('SIGTERM');
  assert.deepEqual(order, ['beginShutdown', 'record:stop']);
  assert.equal(shutdown('SIGINT'), pending);
  assert.equal(beginCalls, 1);
  assert.equal(events.some(event => event.startsWith('exit:')), false);
  release();
  await pending;
  assert.equal(order.at(-1), 'destroy');
});

test('重复信号共用同一关停 Promise，真实 manager 完成前不退出', async () => {
  let release;
  let destroyCalls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const { shutdown, events } = loadShutdown({ streamManager: { destroy: async () => { destroyCalls++; await gate; } } });
  const first = shutdown('SIGTERM');
  const second = shutdown('SIGINT');
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(destroyCalls, 1);
  assert.equal(events.some(event => event.startsWith('exit:')), false);
  release();
  await first;
  assert.equal(events.filter(event => event === 'exit:0').length, 1);
});

test('真实 manager 关闭失败仍停止其他实例，并以非零状态退出', async () => {
  const { shutdown, events, errors } = loadShutdown({
    streamManager: { destroy: async () => { throw new Error('process close timeout'); } }
  });
  await shutdown('SIGTERM');
  assert.ok(events.includes('processManager'));
  assert.ok(events.includes('uploadWorker'));
  assert.equal(events.at(-1), 'exit:1');
  assert.ok(errors.some(args => String(args[0]).includes('temp files are retained')));
  assert.equal(events.includes('exit:0'), false);
});

test('调度器停止失败不跳过真实录制 manager 的关闭', async () => {
  const { shutdown, events } = loadShutdown({
    recordScheduler: { stop: async () => { throw new Error('timer cleanup failed'); } }
  });
  await shutdown('SIGTERM');
  assert.ok(events.includes('streamManager'));
  assert.equal(events.at(-1), 'exit:1');
});

/** 只执行真实 listen 回调，验证异步启动与退出信号交叠，不创建监听端口。 */
function loadStartup(overrides = {}) {
  const events = [];
  let callback;
  const context = {
    module: {}, require: {}, PORT: 3000, NODE_ENV: 'test', hlsDir: '/unused',
    process: { env: {} }, shutdownPromise: null,
    logger: { info() {}, error() {}, warn() {} },
    app: { listen: (_port, _host, run) => { callback = run; } },
    streamManager: { ready: Promise.resolve() },
    preloadScheduler: { start: async () => events.push('preload:start'), stop: () => events.push('preload:stop') },
    preloadHealthCheck: { start: () => events.push('preloadHealth:start') },
    recordScheduler: { start: async () => events.push('record:start'), stop: async () => events.push('record:stop') },
    uploadWorker: { start: () => events.push('worker:start') },
    uploadScanner: { start: () => events.push('scanner:start') },
    RecordingRecoveryService: null,
    ...overrides
  };
  context.require.main = context.module;
  const file = path.join(__dirname, '../src/app.js');
  const source = fs.readFileSync(file, 'utf8');
  const begin = source.indexOf('if (require.main === module)');
  assert.ok(begin >= 0);
  vm.runInNewContext(source.slice(begin), context, { filename: file });
  return { context, start: callback, events };
}

test('初始化 ready 等待期间关停，恢复后不再启动调度器', async () => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const { context, start, events } = loadStartup({ streamManager: { ready } });
  const running = start();
  context.shutdownPromise = Promise.resolve();
  release();
  await running;
  assert.deepEqual(events, []);
});

test('预加载启动期间关停，返回后再停止且不启动录制定时器', async () => {
  let release;
  let entered;
  let stopped = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { context, start, events } = loadStartup({
    preloadScheduler: { start: async () => { entered(); await gate; }, stop: () => { stopped++; } }
  });
  const running = start();
  await started;
  context.shutdownPromise = Promise.resolve();
  release();
  await running;
  assert.equal(stopped, 1);
  assert.deepEqual(events, []);
});
