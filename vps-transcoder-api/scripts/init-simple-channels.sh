#!/bin/bash

# YOYO流媒体平台 - 简化流管理器频道初始化脚本
# 使用用户提供的有效RTMP源配置所有频道

set -e

# 配置
VPS_API_URL="http://localhost:3000"
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

# 用户提供的有效RTMP源
RTMP_SOURCE_1="rtmp://push228.dodool.com.cn/55/3?auth_key=1413753727-0-0-bef639f07f6ddabacfa0213594fa659b"
RTMP_SOURCE_2="rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c"

echo "🚀 初始化YOYO流媒体平台简化流管理器..."

# 检查API服务状态
echo "📡 检查API服务状态..."
if ! curl -s -f "$VPS_API_URL/health" > /dev/null; then
    echo "❌ API服务未运行，请先启动VPS转码服务"
    exit 1
fi

echo "✅ API服务运行正常"

# 批量配置所有频道
echo "🔧 批量配置频道..."

curl -X POST "$VPS_API_URL/api/simple-stream/batch-configure" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "channels": [
      {
        "channelId": "stream_ensxma2g",
        "name": "二楼教室1",
        "rtmpUrl": "'$RTMP_SOURCE_2'"
      },
      {
        "channelId": "stream_gkg5hknc", 
        "name": "二楼教室2",
        "rtmpUrl": "'$RTMP_SOURCE_1'"
      },
      {
        "channelId": "stream_kcwxuedx",
        "name": "国际班", 
        "rtmpUrl": "'$RTMP_SOURCE_2'"
      },
      {
        "channelId": "stream_kil0lecb",
        "name": "C班",
        "rtmpUrl": "'$RTMP_SOURCE_1'"
      },
      {
        "channelId": "stream_noyoostd",
        "name": "三楼舞蹈室",
        "rtmpUrl": "'$RTMP_SOURCE_2'"
      },
      {
        "channelId": "stream_3blyhqh3",
        "name": "多功能厅",
        "rtmpUrl": "'$RTMP_SOURCE_1'"
      },
      {
        "channelId": "stream_8zf48z6g",
        "name": "操场1",
        "rtmpUrl": "'$RTMP_SOURCE_2'"
      },
      {
        "channelId": "stream_cpa2czoo",
        "name": "操场2",
        "rtmpUrl": "'$RTMP_SOURCE_1'"
      }
    ]
  }' | jq .

echo "✅ 频道配置完成"

# 检查系统状态
echo "📊 检查系统状态..."
curl -s "$VPS_API_URL/api/simple-stream/system/status" \
  -H "X-API-Key: $API_KEY" | jq .

echo ""
echo "🎉 简化流管理器初始化完成！"
echo ""
echo "📋 使用说明："
echo "1. 实时播放：系统现在使用0.5秒HLS分片，延迟极低"
echo "2. 按需启动：只有当用户点击频道时才启动转码"
echo "3. 共享处理：多用户观看同一频道时共享转码进程"
echo "4. 智能清理：用户离开时自动停止无用的转码进程"
echo "5. 无缝切换：用户切换频道时自动清理旧会话"
echo ""
echo "🔗 API端点："
echo "- 开始观看: POST /api/simple-stream/start-watching"
echo "- 停止观看: POST /api/simple-stream/stop-watching"  
echo "- 心跳更新: POST /api/simple-stream/heartbeat"
echo "- 系统状态: GET /api/simple-stream/system/status"
echo ""
