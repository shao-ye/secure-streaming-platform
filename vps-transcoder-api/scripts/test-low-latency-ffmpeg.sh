#!/bin/bash

# 测试低延迟FFmpeg转码配置脚本
# 用于验证优化后的RTMP到HLS转码延迟

echo "=== 低延迟FFmpeg转码测试 ==="
echo "测试时间: $(date)"
echo ""

# 配置参数
RTMP_URL="rtmp://push28.docdool.com:55/18"
TEST_STREAM_ID="latency-test-$(date +%s)"
HLS_OUTPUT_DIR="/var/www/hls"
OUTPUT_DIR="$HLS_OUTPUT_DIR/$TEST_STREAM_ID"

# 创建输出目录
mkdir -p "$OUTPUT_DIR"

echo "RTMP输入流: $RTMP_URL"
echo "HLS输出目录: $OUTPUT_DIR"
echo "测试流ID: $TEST_STREAM_ID"
echo ""

# 构建低延迟FFmpeg命令
FFMPEG_CMD="ffmpeg \
  -fflags +nobuffer+flush_packets \
  -flags low_delay \
  -strict experimental \
  -i $RTMP_URL \
  -avoid_negative_ts make_zero \
  -copyts \
  -start_at_zero \
  -reconnect 1 \
  -reconnect_at_eof 1 \
  -reconnect_streamed 1 \
  -reconnect_delay_max 1 \
  -timeout 5000000 \
  -rw_timeout 5000000 \
  -c:v libx264 \
  -preset ultrafast \
  -tune zerolatency \
  -profile:v baseline \
  -level 3.0 \
  -g 30 \
  -keyint_min 15 \
  -sc_threshold 0 \
  -threads 2 \
  -crf 23 \
  -maxrate 2000k \
  -bufsize 1000k \
  -x264opts no-scenecut:force-cfr:no-mbtree:sliced-threads:sync-lookahead=0:bframes=0:rc-lookahead=0 \
  -c:a aac \
  -b:a 128k \
  -ac 2 \
  -ar 44100 \
  -aac_coder fast \
  -f hls \
  -hls_time 1 \
  -hls_list_size 3 \
  -hls_segment_filename $OUTPUT_DIR/segment%03d.ts \
  -hls_flags delete_segments+round_durations+independent_segments+program_date_time \
  -hls_allow_cache 0 \
  -hls_segment_type mpegts \
  -start_number 0 \
  -hls_base_url '' \
  -flush_packets 1 \
  -max_delay 0 \
  -max_interleave_delta 0 \
  $OUTPUT_DIR/playlist.m3u8"

echo "执行FFmpeg命令:"
echo "$FFMPEG_CMD"
echo ""

# 启动FFmpeg进程（后台运行）
echo "启动低延迟转码进程..."
eval "$FFMPEG_CMD" &
FFMPEG_PID=$!

echo "FFmpeg进程ID: $FFMPEG_PID"
echo "HLS播放地址: http://$(hostname -I | awk '{print $1}')/hls/$TEST_STREAM_ID/playlist.m3u8"
echo ""

# 等待HLS文件生成
echo "等待HLS文件生成..."
WAIT_COUNT=0
MAX_WAIT=30

while [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    if [ -f "$OUTPUT_DIR/playlist.m3u8" ] && [ -f "$OUTPUT_DIR/segment000.ts" ]; then
        echo "✅ HLS文件生成成功！"
        echo "播放列表内容:"
        cat "$OUTPUT_DIR/playlist.m3u8"
        echo ""
        break
    fi
    
    echo "等待中... ($((WAIT_COUNT + 1))/$MAX_WAIT)"
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
done

if [ $WAIT_COUNT -eq $MAX_WAIT ]; then
    echo "❌ 等待超时，HLS文件未生成"
    kill $FFMPEG_PID 2>/dev/null
    exit 1
fi

# 监控延迟性能
echo "=== 延迟性能监控 ==="
echo "监控30秒，检查分片生成频率和时间戳..."

for i in {1..30}; do
    if [ -f "$OUTPUT_DIR/playlist.m3u8" ]; then
        SEGMENT_COUNT=$(grep -c "\.ts" "$OUTPUT_DIR/playlist.m3u8" 2>/dev/null || echo "0")
        LATEST_SEGMENT=$(ls -t "$OUTPUT_DIR"/*.ts 2>/dev/null | head -1)
        
        if [ -n "$LATEST_SEGMENT" ]; then
            SEGMENT_TIME=$(stat -c %Y "$LATEST_SEGMENT" 2>/dev/null || echo "0")
            CURRENT_TIME=$(date +%s)
            DELAY=$((CURRENT_TIME - SEGMENT_TIME))
            
            echo "[$i/30] 分片数: $SEGMENT_COUNT, 最新分片延迟: ${DELAY}秒"
        else
            echo "[$i/30] 分片数: $SEGMENT_COUNT, 无分片文件"
        fi
    else
        echo "[$i/30] 播放列表不存在"
    fi
    
    sleep 1
done

echo ""
echo "=== 测试完成 ==="
echo "停止FFmpeg进程..."
kill $FFMPEG_PID 2>/dev/null

echo "清理测试文件..."
rm -rf "$OUTPUT_DIR"

echo "测试结果:"
echo "- HLS分片时间: 1秒"
echo "- 播放列表大小: 3个分片"
echo "- 理论最小延迟: 3-4秒"
echo "- 请使用VLC等播放器测试实际延迟效果"
echo ""
echo "建议测试命令:"
echo "vlc http://$(hostname -I | awk '{print $1}')/hls/$TEST_STREAM_ID/playlist.m3u8"
