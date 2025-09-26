@echo off
echo 正在上传KV数据到预览环境...

echo 上传管理员用户数据...
wrangler kv key put "user:admin" "{\"username\":\"admin\",\"hashedPassword\":\"a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3\",\"salt\":\"randomsalt123\",\"role\":\"admin\",\"createdAt\":\"2025-01-26T03:25:22.000Z\"}" --namespace-id f36b78f5fd4d493aa567f9e8abf68348

echo 上传流配置数据...
wrangler kv key put "streams_config" "[{\"id\":\"stream1\",\"name\":\"测试频道1\",\"rtmpUrl\":\"rtmp://example.com/live/stream1\",\"createdAt\":\"2025-01-26T03:25:22.000Z\",\"updatedAt\":\"2025-01-26T03:25:22.000Z\"},{\"id\":\"stream2\",\"name\":\"测试频道2\",\"rtmpUrl\":\"rtmp://example.com/live/stream2\",\"createdAt\":\"2025-01-26T03:25:22.000Z\",\"updatedAt\":\"2025-01-26T03:25:22.000Z\"}]" --namespace-id f36b78f5fd4d493aa567f9e8abf68348

echo 验证数据上传...
wrangler kv key get "user:admin" --namespace-id f36b78f5fd4d493aa567f9e8abf68348
wrangler kv key get "streams_config" --namespace-id f36b78f5fd4d493aa567f9e8abf68348

echo KV数据上传到预览环境完成！
