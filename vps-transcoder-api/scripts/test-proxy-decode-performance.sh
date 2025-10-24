#!/bin/bash

# RTMP源和代理配置测试脚本
# 对比直接解码和代理解码的性能差异

set -e

RTMP_URL="rtmp://push228.dodool.com.cn/55/19?auth_key=1413753727-0-0-12f6098bc64f30e11339cd4799325c5f"
PROXY_CONFIG="vless://3129f1b0-95f2-4602-a6b4-23fb3c7df4e1@104.194.86.189:443?encryption=none&security=tls&type=xhttp&host=rn.262777.xyz&path=%2F3129f1b0&mode=auto#RN-proxy-xhttp-cdn"
TEST_DURATION=30  # 测试时长（秒）
OUTPUT_DIR="/tmp/proxy_test_$(date +%s)"

echo "========================================"
echo "代理解码性能测试"
echo "========================================"
echo "RTMP源: $RTMP_URL"
echo "代理: RN-proxy-xhttp-cdn"
echo "测试时长: ${TEST_DURATION}秒"
echo "========================================"

mkdir -p "$OUTPUT_DIR"

# 测试1: 直接解码RTMP源
echo ""
echo "[测试1] 直接解码RTMP源..."
echo "----------------------------------------"

DIRECT_LOG="$OUTPUT_DIR/direct_decode.log"
DIRECT_STATS="$OUTPUT_DIR/direct_stats.txt"

timeout ${TEST_DURATION} ffmpeg \
  -i "$RTMP_URL" \
  -t ${TEST_DURATION} \
  -c copy \
  -f null - \
  2>&1 | tee "$DIRECT_LOG" || true

# 提取关键性能指标
echo "分析直接解码性能..." > "$DIRECT_STATS"
grep -E "frame=|fps=|speed=|bitrate=" "$DIRECT_LOG" | tail -10 >> "$DIRECT_STATS" || echo "未找到性能数据" >> "$DIRECT_STATS"

# 测试2: 通过代理解码RTMP源
echo ""
echo "[测试2] 通过VLESS代理解码RTMP源..."
echo "----------------------------------------"

# 首先配置代理
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

echo "配置VLESS代理..."
PROXY_ENABLE_RESULT=$(curl -s -X POST https://yoyo-vps.5202021.xyz/api/proxy/connect \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d "{\"proxyUrl\":\"$PROXY_CONFIG\"}")

echo "代理配置结果: $PROXY_ENABLE_RESULT"

# 等待代理连接建立
echo "等待代理连接建立..."
sleep 5

# 检查代理状态
PROXY_STATUS=$(curl -s https://yoyo-vps.5202021.xyz/api/proxy/status \
  -H "X-API-Key: $API_KEY")
echo "代理状态: $PROXY_STATUS"

PROXY_LOG="$OUTPUT_DIR/proxy_decode.log"
PROXY_STATS="$OUTPUT_DIR/proxy_stats.txt"

# 通过代理解码
# 设置代理环境变量
export http_proxy="socks5://127.0.0.1:1080"
export https_proxy="socks5://127.0.0.1:1080"

timeout ${TEST_DURATION} ffmpeg \
  -i "$RTMP_URL" \
  -t ${TEST_DURATION} \
  -c copy \
  -f null - \
  2>&1 | tee "$PROXY_LOG" || true

# 提取代理模式下的性能指标
echo "分析代理解码性能..." > "$PROXY_STATS"
grep -E "frame=|fps=|speed=|bitrate=" "$PROXY_LOG" | tail -10 >> "$PROXY_STATS" || echo "未找到性能数据" >> "$PROXY_STATS"

# 断开代理
echo ""
echo "断开代理..."
curl -s -X POST https://yoyo-vps.5202021.xyz/api/proxy/disconnect \
  -H "X-API-Key: $API_KEY" > /dev/null

# 生成对比报告
echo ""
echo "========================================"
echo "性能对比报告"
echo "========================================"
echo ""

echo "【直接解码】"
echo "----------------------------------------"
cat "$DIRECT_STATS"
echo ""

echo "【代理解码】"
echo "----------------------------------------"
cat "$PROXY_STATS"
echo ""

echo "========================================"
echo "详细日志保存在: $OUTPUT_DIR"
echo "- 直接解码日志: $DIRECT_LOG"
echo "- 代理解码日志: $PROXY_LOG"
echo "========================================"

# 提取关键指标对比
echo ""
echo "【关键指标对比】"
echo "----------------------------------------"

# 提取FPS
DIRECT_FPS=$(grep -oP 'fps=\s*\K[\d\.]+' "$DIRECT_LOG" | tail -1 || echo "N/A")
PROXY_FPS=$(grep -oP 'fps=\s*\K[\d\.]+' "$PROXY_LOG" | tail -1 || echo "N/A")

# 提取速度
DIRECT_SPEED=$(grep -oP 'speed=\s*\K[\d\.]+' "$DIRECT_LOG" | tail -1 || echo "N/A")
PROXY_SPEED=$(grep -oP 'speed=\s*\K[\d\.]+' "$PROXY_LOG" | tail -1 || echo "N/A")

# 提取比特率
DIRECT_BITRATE=$(grep -oP 'bitrate=\s*\K[\d\.]+' "$DIRECT_LOG" | tail -1 || echo "N/A")
PROXY_BITRATE=$(grep -oP 'bitrate=\s*\K[\d\.]+' "$PROXY_LOG" | tail -1 || echo "N/A")

echo "帧率 (FPS):"
echo "  直接解码: ${DIRECT_FPS}"
echo "  代理解码: ${PROXY_FPS}"
echo ""

echo "速度倍率 (Speed):"
echo "  直接解码: ${DIRECT_SPEED}x"
echo "  代理解码: ${PROXY_SPEED}x"
echo ""

echo "比特率 (kbits/s):"
echo "  直接解码: ${DIRECT_BITRATE}"
echo "  代理解码: ${PROXY_BITRATE}"
echo ""

echo "========================================"
echo "测试完成"
echo "========================================"
