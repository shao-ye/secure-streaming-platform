const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/** 创建记录调用的轻量桩，测试期间不初始化真实服务。 */
function stub(implementation = () => undefined) {
  const fn = (...args) => { fn.calls.push(args); return fn.impl(...args); };
  fn.calls = [];
  fn.impl = implementation;
  return fn;
}

/** 捕获真实路由处理函数，其所有外部依赖均由本地测试桩提供。 */
function loadRoutes(manager, axios, logger) {
  const routes = new Map();
  const router = { use() {}, get() {}, post: (route, callback) => routes.set(route, callback) };
  const module = { exports: {} };
  const deps = {
    express: { Router: () => router },
    '../services/SimpleStreamManager': function Manager() { return manager; },
    '../services/PreloadScheduler': function Preload() {},
    '../services/PreloadHealthCheck': function Health() {},
    '../services/RecordScheduler': function Recording() {},
    '../utils/logger': logger,
    '../middleware/auth': () => undefined,
    axios,
    '../../config': { workersApiUrl: 'https://workers.example.test' }
  };
  const filename = path.resolve(__dirname, '../src/routes/simple-stream.js');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports,
    require: name => {
      assert.ok(Object.hasOwn(deps, name), `未隔离依赖: ${name}`);
      return deps[name];
    }
  }, { filename });
  return routes;
}

/** 直接调用已注册处理器并捕获响应，避免开放端口和访问真实网络。 */
async function invoke(handler, body) {
  const response = {
    statusCode: 200,
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; }
  };
  await handler({ body }, response);
  return response;
}

describe('开始观看路由的未知配置和保留录制模式重启', () => {
  const body = { channelId: 'stream_classroom', rtmpUrl: 'rtmp://source.test/live/private-token' };
  let manager;
  let axios;
  let logger;
  let routes;

  beforeEach(() => {
    manager = {
      startWatching: stub(async () => '/hls/stream_classroom/playlist.m3u8'),
      restartChannel: stub(async () => '/hls/stream_classroom/playlist.m3u8'),
      stopChannel: stub(async () => undefined)
    };
    axios = { get: stub() };
    logger = { info: stub(), warn: stub(), error: stub(), debug: stub() };
    routes = loadRoutes(manager, axios, logger);
  });

  for (const videoAspectRatio of ['16:9', 'original']) {
    it(`权威配置 ${videoAspectRatio} 原样传给管理器`, async () => {
      const config = { videoAspectRatio };
      axios.get.impl = async () => ({ status: 200, data: { status: 'success', data: config } });
      const response = await invoke(routes.get('/start-watching'), body);
      assert.equal(response.statusCode, 200);
      assert.equal(axios.get.calls[0][0], 'https://workers.example.test/api/channel/stream_classroom/config');
      assert.equal(axios.get.calls[0][1].timeout, 3000);
      assert.deepEqual(manager.startWatching.calls[0], [body.channelId, body.rtmpUrl, config]);
    });
  }

  it('请求失败保留未知配置，日志提供状态和错误码且不泄露请求内容', async () => {
    const error = Object.assign(new Error('sensitive-url?token=secret'), {
      code: 'ETIMEDOUT', response: { status: 504, data: { secret: 'response-secret' } },
      config: { headers: { Authorization: 'secret-auth' } }
    });
    axios.get.impl = async () => { throw error; };
    const response = await invoke(routes.get('/start-watching'), body);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(manager.startWatching.calls[0], [body.channelId, body.rtmpUrl, null]);
    const [message, metadata] = logger.warn.calls[0];
    assert.equal(message, 'Failed to fetch channel config, retaining current stream settings');
    assert.equal(metadata.errorCode, 'ETIMEDOUT');
    assert.equal(metadata.httpStatus, 504);
    assert.doesNotMatch(JSON.stringify([logger.warn.calls, logger.info.calls]), /private-token|secret|Authorization/);
  });

  for (const data of [
    { status: 'error', message: 'private business details' },
    { status: 'success', data: {} },
    { status: 'success', data: { videoAspectRatio: 'unexpected' } }
  ]) {
    it(`HTTP 成功但业务配置无效时不当成 original: ${JSON.stringify(data)}`, async () => {
      axios.get.impl = async () => ({ status: 200, data });
      const response = await invoke(routes.get('/start-watching'), body);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(manager.startWatching.calls[0], [body.channelId, body.rtmpUrl, null]);
      assert.equal(logger.warn.calls[0][0], 'Invalid channel config response, retaining current stream settings');
      assert.equal(logger.warn.calls[0][1].httpStatus, 200);
      assert.doesNotMatch(JSON.stringify(logger.warn.calls), /private business details/);
    });
  }

  it('重启频道走原子保留模式接口，不先停止频道再启动观看', async () => {
    const response = await invoke(routes.get('/restart-channel'), body);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(manager.restartChannel.calls[0], [body.channelId, body.rtmpUrl]);
    assert.equal(manager.stopChannel.calls.length, 0);
    assert.equal(manager.startWatching.calls.length, 0);
  });

  it('缺少必填参数时不获取配置或启动进程', async () => {
    const response = await invoke(routes.get('/start-watching'), { channelId: body.channelId });
    assert.equal(response.statusCode, 400);
    assert.equal(axios.get.calls.length, 0);
    assert.equal(manager.startWatching.calls.length, 0);
  });
});
