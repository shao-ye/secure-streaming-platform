@echo off
echo 修复管理员密码哈希值...

echo 使用正确的secret密码哈希值更新管理员数据...
wrangler kv key put "user:admin" "{\"username\":\"admin\",\"hashedPassword\":\"2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b\",\"salt\":\"randomsalt123\",\"role\":\"admin\",\"createdAt\":\"2025-01-26T03:25:22.000Z\"}" --namespace-id f36b78f5fd4d493aa567f9e8abf68348

echo 验证更新后的数据...
wrangler kv key get "user:admin" --namespace-id f36b78f5fd4d493aa567f9e8abf68348

echo 管理员密码修复完成！现在可以使用 admin/secret 登录了。
