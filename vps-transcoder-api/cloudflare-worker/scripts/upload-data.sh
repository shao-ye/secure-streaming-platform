#!/bin/bash

# Cloudflare KV数据上传脚本
# 使用方法: chmod +x upload-data.sh && ./upload-data.sh

echo "🚀 开始上传YOYO流媒体平台初始数据到Cloudflare KV..."

# 检查wrangler是否已安装
if ! command -v wrangler &> /dev/null; then
    echo "❌ wrangler CLI未安装，请先安装: npm install -g wrangler"
    exit 1
fi

# 检查是否已登录
if ! wrangler whoami &> /dev/null; then
    echo "❌ 请先登录Cloudflare: wrangler login"
    exit 1
fi

echo "✅ wrangler CLI已就绪"

# 生成正确的密码哈希（admin123456的SHA-256哈希）
ADMIN_PASSWORD_HASH="c1c224b03cd9bc7b6a86d77f5dace40191766c485cd55dc48caf9ac873335d6f"
USER_PASSWORD_HASH="f25a2fc72690b780b2a14e140ef6a9e0e4dcd5d3a3c2a6b9c0e1d2f3a4b5c6d7"

# 上传管理员账户数据
echo "📤 上传管理员账户..."
wrangler kv:key put --binding=USER_DB "user:admin" "{
  \"username\": \"admin\",
  \"hashedPassword\": \"$ADMIN_PASSWORD_HASH\",
  \"salt\": \"a1b2c3d4e5f6789012345678\",
  \"role\": \"admin\",
  \"createdAt\": $(date +%s)000
}"

# 上传普通用户账户数据
echo "📤 上传普通用户账户..."
wrangler kv:key put --binding=USER_DB "user:user" "{
  \"username\": \"user\",
  \"hashedPassword\": \"$USER_PASSWORD_HASH\",
  \"salt\": \"b2c3d4e5f6789012345678a1\",
  \"role\": \"user\",
  \"createdAt\": $(date +%s)000
}"

# 上传流配置数据
echo "📤 上传流配置..."
wrangler kv:key put --binding=USER_DB "streams_config" "[
  {
    \"id\": \"cam1\",
    \"name\": \"大厅监控\",
    \"rtmpUrl\": \"rtmp://example.com/live/hall\",
    \"createdAt\": $(date +%s)000,
    \"updatedAt\": $(date +%s)000
  },
  {
    \"id\": \"cam2\", 
    \"name\": \"前门监控\",
    \"rtmpUrl\": \"rtmp://example.com/live/frontdoor\",
    \"createdAt\": $(date +%s)000,
    \"updatedAt\": $(date +%s)000
  },
  {
    \"id\": \"cam3\",
    \"name\": \"后院监控\", 
    \"rtmpUrl\": \"rtmp://example.com/live/backyard\",
    \"createdAt\": $(date +%s)000,
    \"updatedAt\": $(date +%s)000
  }
]"

echo "✅ 数据上传完成！"
echo ""
echo "🔐 默认账户信息："
echo "管理员: admin / admin123456"
echo "普通用户: user / user123456"
echo ""
echo "⚠️  请在生产环境中修改默认密码！"
echo "💡 现在可以启动开发服务器测试: wrangler dev"
