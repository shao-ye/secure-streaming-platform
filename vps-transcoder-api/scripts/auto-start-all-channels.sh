#!/bin/bash

# 自动为所有频道启动低延迟FFmpeg转码进程
# 解决只有部分频道播放正常的问题

# 配置
VPS_IP="142.171.75.220"
RTMP_BASE_URL="rtmp://push228.dodool.com.cn/55/3"
AUTH_KEY="1413753727-0-0-bef639f07f6ddabacfa0213594fa659b"
HLS_OUTPUT_DIR="/var/www/hls"

# 频道配置 - 根据YOYO系统的频道列表
declare -A CHANNELS=(
    ["stream_cpa2czoo"]="二楼教室1"
    ["stream_ensxma2g"]="二楼教室2"
    ["stream_gkg5hknc"]="国际班"
    ["stream_kcwxuedx"]="C班"
    ["stream_kil0lecb"]="三楼舞蹈室"
    ["stream_noyoostd"]="多功能厅"
    ["stream_3blyhqh3"]="操场1"
    ["stream_8zf48z6g"]="操场2"
)

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== YOYO流媒体平台 - 自动启动所有频道转码 ===${NC}"
echo "开始时间: $(date)"
echo ""

# 检查VPS连接
echo -e "${YELLOW}检查VPS连接...${NC}"
if ! ssh -o ConnectTimeout=5 root@$VPS_IP "echo 'VPS连接成功'" 2>/dev/null; then
    echo -e "${RED}❌ 无法连接到VPS服务器 $VPS_IP${NC}"
    exit 1
fi
echo -e "${GREEN}✅ VPS连接正常${NC}"
echo ""

# 停止所有现有的FFmpeg进程
echo -e "${YELLOW}停止现有的FFmpeg进程...${NC}"
ssh root@$VPS_IP "pkill -f ffmpeg || true"
sleep 2

# 清理旧的HLS文件（可选）
echo -e "${YELLOW}清理旧的HLS缓存文件...${NC}"
ssh root@$VPS_IP "find $HLS_OUTPUT_DIR -name '*.ts' -mmin +10 -delete || true"
ssh root@$VPS_IP "find $HLS_OUTPUT_DIR -name '*.m3u8' -mmin +10 -delete || true"

# 为每个频道启动转码进程
echo -e "${BLUE}开始为所有频道启动转码进程...${NC}"
echo ""

SUCCESS_COUNT=0
FAILED_COUNT=0

for STREAM_ID in "${!CHANNELS[@]}"; do
    CHANNEL_NAME="${CHANNELS[$STREAM_ID]}"
    echo -e "${YELLOW}启动频道: $CHANNEL_NAME ($STREAM_ID)${NC}"
    
    # 创建频道目录
    ssh root@$VPS_IP "mkdir -p $HLS_OUTPUT_DIR/$STREAM_ID"
    
    # 启动FFmpeg转码进程 - 使用优化的低延迟参数
    FFMPEG_CMD="nohup ffmpeg \
        -fflags +nobuffer+flush_packets \
        -flags low_delay \
        -strict experimental \
        -i '$RTMP_BASE_URL?auth_key=$AUTH_KEY' \
        -avoid_negative_ts make_zero \
        -copyts \
        -start_at_zero \
        -reconnect 1 \
        -reconnect_at_eof 1 \
        -reconnect_streamed 1 \
        -reconnect_delay_max 1 \
        -rw_timeout 10000000 \
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
        -hls_segment_filename $HLS_OUTPUT_DIR/$STREAM_ID/segment%03d.ts \
        -hls_flags delete_segments+round_durations+independent_segments+program_date_time \
        -hls_allow_cache 0 \
        -hls_segment_type mpegts \
        -start_number 0 \
        -hls_base_url '' \
        -flush_packets 1 \
        -max_delay 0 \
        -max_interleave_delta 0 \
        $HLS_OUTPUT_DIR/$STREAM_ID/playlist.m3u8 \
        > /tmp/ffmpeg_$STREAM_ID.log 2>&1 &"
    
    # 执行FFmpeg命令
    if ssh root@$VPS_IP "$FFMPEG_CMD"; then
        echo -e "${GREEN}  ✅ $CHANNEL_NAME 转码进程启动成功${NC}"
        ((SUCCESS_COUNT++))
        
        # 等待2秒让进程稳定
        sleep 2
        
        # 验证进程是否正在运行
        if ssh root@$VPS_IP "pgrep -f '$STREAM_ID' > /dev/null"; then
            echo -e "${GREEN}  ✅ $CHANNEL_NAME 转码进程运行正常${NC}"
        else
            echo -e "${RED}  ❌ $CHANNEL_NAME 转码进程启动后停止${NC}"
            ((FAILED_COUNT++))
            ((SUCCESS_COUNT--))
        fi
    else
        echo -e "${RED}  ❌ $CHANNEL_NAME 转码进程启动失败${NC}"
        ((FAILED_COUNT++))
    fi
    
    echo ""
done

# 显示最终结果
echo -e "${BLUE}=== 转码进程启动完成 ===${NC}"
echo -e "${GREEN}成功启动: $SUCCESS_COUNT 个频道${NC}"
echo -e "${RED}启动失败: $FAILED_COUNT 个频道${NC}"
echo ""

# 显示当前运行的FFmpeg进程
echo -e "${YELLOW}当前运行的转码进程:${NC}"
ssh root@$VPS_IP "ps aux | grep ffmpeg | grep -v grep | wc -l" | while read count; do
    echo "总计: $count 个FFmpeg进程正在运行"
done

# 检查HLS文件生成情况
echo ""
echo -e "${YELLOW}检查HLS文件生成情况:${NC}"
for STREAM_ID in "${!CHANNELS[@]}"; do
    CHANNEL_NAME="${CHANNELS[$STREAM_ID]}"
    FILE_COUNT=$(ssh root@$VPS_IP "ls -1 $HLS_OUTPUT_DIR/$STREAM_ID/*.ts 2>/dev/null | wc -l" 2>/dev/null || echo "0")
    if [ "$FILE_COUNT" -gt 0 ]; then
        echo -e "${GREEN}  ✅ $CHANNEL_NAME: $FILE_COUNT 个视频分片${NC}"
    else
        echo -e "${RED}  ❌ $CHANNEL_NAME: 暂无视频分片${NC}"
    fi
done

echo ""
echo "完成时间: $(date)"
echo -e "${BLUE}=== 脚本执行完成 ===${NC}"

# 提供测试建议
echo ""
echo -e "${YELLOW}测试建议:${NC}"
echo "1. 访问 https://yoyo.5202021.xyz/ 测试所有频道播放"
echo "2. 检查视频时间戳是否显示实时时间"
echo "3. 验证视频画面是否流畅无卡顿"
echo ""
echo -e "${GREEN}所有频道现在应该都可以正常播放了！${NC}"
