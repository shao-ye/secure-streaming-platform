#!/bin/bash

# YOYO流媒体平台 - 重启所有频道转码脚本
# 使用低延迟FFmpeg参数

echo "=== YOYO流媒体平台 - 重启所有频道转码 ==="
echo "开始时间: $(date)"
echo ""

# VPS配置
VPS_HOST="localhost"
VPS_PORT="3000"
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

# 频道配置数组
declare -a CHANNELS=(
    "stream_ensxma2g:频道1"
    "stream_gkg5hknc:频道2" 
    "stream_kcwxuedx:频道3"
    "stream_kil0lecb:频道4"
    "stream_noyoostd:频道5"
    "stream_3blyhqh3:频道6"
    "stream_8zf48z6g:频道7"
    "stream_cpa2czoo:频道8"
)

# RTMP源地址 - 使用正确的推流源
RTMP_URL="rtmp://push229.dodool.com.cn/55/4?auth_key=1413753727-0-0-34e3b8e12b7c0a93631741ff32b7d15c"

echo "🔧 停止所有现有FFmpeg进程..."
pkill -f ffmpeg
sleep 2

echo ""
echo "🚀 开始重新启动所有频道..."
echo ""

# 遍历所有频道
for channel_info in "${CHANNELS[@]}"; do
    IFS=':' read -r channel_id channel_name <<< "$channel_info"
    
    echo "📺 处理频道: $channel_name ($channel_id)"
    
    # 1. 配置频道
    echo "  ⚙️  配置频道..."
    # 使用英文名称避免JSON编码问题
    english_name="Channel_${channel_id##*_}"
    curl -s -X POST "http://$VPS_HOST:$VPS_PORT/api/ondemand/configure-channel" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "{\"channelId\":\"$channel_id\",\"name\":\"$english_name\",\"rtmpUrl\":\"$RTMP_URL\"}" \
        > /tmp/config_response.json
    
    if grep -q "success" /tmp/config_response.json; then
        echo "  ✅ 频道配置成功"
    else
        echo "  ⚠️  频道配置响应: $(cat /tmp/config_response.json)"
    fi
    
    # 2. 开始观看（启动转码）
    echo "  🎬 启动转码..."
    curl -s -X POST "http://$VPS_HOST:$VPS_PORT/api/ondemand/start-watching" \
        -H "Content-Type: application/json" \
        -H "X-API-Key: $API_KEY" \
        -d "{\"channelId\":\"$channel_id\",\"userId\":\"system\"}" \
        > /tmp/start_response.json
    
    if grep -q "success" /tmp/start_response.json; then
        echo "  ✅ 转码启动成功"
    else
        echo "  ⚠️  转码启动响应: $(cat /tmp/start_response.json)"
    fi
    
    echo ""
    sleep 1
done

echo "⏱️  等待5秒让所有转码进程稳定..."
sleep 5

echo ""
echo "📊 检查转码进程状态..."
ffmpeg_count=$(ps aux | grep ffmpeg | grep -v grep | wc -l)
echo "当前运行的FFmpeg进程数: $ffmpeg_count"

if [ $ffmpeg_count -gt 0 ]; then
    echo ""
    echo "🔍 FFmpeg进程详情:"
    ps aux | grep ffmpeg | grep -v grep | while read line; do
        echo "  $line"
    done
fi

echo ""
echo "📁 检查HLS文件生成..."
for channel_info in "${CHANNELS[@]}"; do
    IFS=':' read -r channel_id channel_name <<< "$channel_info"
    
    hls_dir="/var/www/hls/$channel_id"
    if [ -d "$hls_dir" ]; then
        file_count=$(ls -1 "$hls_dir"/*.ts 2>/dev/null | wc -l)
        if [ $file_count -gt 0 ]; then
            echo "  ✅ $channel_name: $file_count 个HLS分片文件"
        else
            echo "  ⚠️  $channel_name: 暂无HLS文件"
        fi
    else
        echo "  ❌ $channel_name: HLS目录不存在"
    fi
done

echo ""
echo "🎯 所有频道重启完成!"
echo "结束时间: $(date)"

# 清理临时文件
rm -f /tmp/config_response.json /tmp/start_response.json
