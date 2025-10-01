#!/bin/bash

# 前端播放问题诊断脚本
# 检查从前端点击播放到HLS文件生成的完整链路

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${GREEN}🔍 诊断前端播放问题...${NC}"

API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"
TEST_RTMP="rtmp://push228.dodool.com.cn/55/18?auth_key=1413753727-0-0-c4de0c6f5bfb2bd281809ff218b74fa4"

echo -e "${YELLOW}1. 检查API服务状态...${NC}"

# 检查健康状态
HEALTH_RESPONSE=$(curl -s https://yoyo-vps.5202021.xyz/health 2>/dev/null || echo "error")
if echo "$HEALTH_RESPONSE" | grep -q "healthy"; then
    echo -e "${GREEN}✅ API健康检查正常${NC}"
else
    echo -e "${RED}❌ API健康检查失败: $HEALTH_RESPONSE${NC}"
    exit 1
fi

# 检查API状态
API_STATUS=$(curl -s -H "X-API-Key: $API_KEY" https://yoyo-vps.5202021.xyz/api/status 2>/dev/null || echo "error")
if echo "$API_STATUS" | grep -q "running"; then
    echo -e "${GREEN}✅ API状态正常${NC}"
else
    echo -e "${RED}❌ API状态异常: $API_STATUS${NC}"
    exit 1
fi

echo -e "${YELLOW}2. 测试转码API端点...${NC}"

# 使用前端可能使用的流ID格式
FRONTEND_STREAM_ID="stream_$(date +%Y%m%d_%H%M%S)"

echo -e "${BLUE}启动转码流: $FRONTEND_STREAM_ID${NC}"
START_RESPONSE=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d "{\"streamId\":\"$FRONTEND_STREAM_ID\",\"rtmpUrl\":\"$TEST_RTMP\"}" \
  https://yoyo-vps.5202021.xyz/api/start-stream 2>/dev/null || echo "connection_error")

echo -e "${CYAN}转码启动响应:${NC}"
echo "$START_RESPONSE" | jq . 2>/dev/null || echo "$START_RESPONSE"

if echo "$START_RESPONSE" | grep -q "success.*true"; then
    echo -e "${GREEN}✅ 转码API调用成功${NC}"
    
    # 提取HLS URL
    HLS_URL=$(echo "$START_RESPONSE" | jq -r '.data.hlsUrl' 2>/dev/null || echo "/hls/$FRONTEND_STREAM_ID/playlist.m3u8")
    echo -e "${CYAN}HLS URL: $HLS_URL${NC}"
    
elif echo "$START_RESPONSE" | grep -q "already"; then
    echo -e "${YELLOW}⚠️ 流已在运行，继续检查HLS文件${NC}"
    HLS_URL="/hls/$FRONTEND_STREAM_ID/playlist.m3u8"
else
    echo -e "${RED}❌ 转码API调用失败${NC}"
    echo -e "${YELLOW}可能的原因：超时、连接失败或FFmpeg启动问题${NC}"
fi

echo -e "${YELLOW}3. 检查HLS文件生成...${NC}"

# 等待HLS文件生成
echo -e "${BLUE}等待HLS文件生成...${NC}"
for i in {1..60}; do
    # 检查外部HLS访问
    HLS_CHECK=$(curl -s -I "https://yoyo-vps.5202021.xyz$HLS_URL" 2>/dev/null | head -1 || echo "error")
    
    if echo "$HLS_CHECK" | grep -q "200 OK"; then
        echo -e "${GREEN}✅ HLS文件可通过外部URL访问!${NC}"
        echo -e "${CYAN}HLS访问地址: https://yoyo-vps.5202021.xyz$HLS_URL${NC}"
        
        # 获取HLS内容
        HLS_CONTENT=$(curl -s "https://yoyo-vps.5202021.xyz$HLS_URL" 2>/dev/null || echo "error")
        if echo "$HLS_CONTENT" | grep -q "#EXTM3U"; then
            echo -e "${GREEN}✅ HLS播放列表格式正确${NC}"
            echo -e "${BLUE}HLS内容预览:${NC}"
            echo "$HLS_CONTENT" | head -10
            
            # 检查TS文件
            TS_FILES=$(echo "$HLS_CONTENT" | grep "\.ts$" | wc -l)
            echo -e "${CYAN}TS文件数量: $TS_FILES${NC}"
            
            if [ "$TS_FILES" -gt 0 ]; then
                echo -e "${GREEN}✅ HLS流正在正常生成!${NC}"
                break
            else
                echo -e "${YELLOW}⚠️ HLS文件存在但没有TS片段，继续等待...${NC}"
            fi
        else
            echo -e "${RED}❌ HLS文件格式错误${NC}"
            echo -e "${YELLOW}内容: $HLS_CONTENT${NC}"
        fi
        
    elif echo "$HLS_CHECK" | grep -q "404"; then
        echo -e "${YELLOW}⏳ HLS文件尚未生成... ($i/60)${NC}"
        sleep 2
    else
        echo -e "${YELLOW}⏳ 等待HLS文件... ($i/60) - $HLS_CHECK${NC}"
        sleep 2
    fi
    
    if [ $i -eq 60 ]; then
        echo -e "${RED}❌ HLS文件生成超时（2分钟）${NC}"
        echo -e "${YELLOW}可能的问题：${NC}"
        echo -e "${YELLOW}  1. FFmpeg进程启动失败${NC}"
        echo -e "${YELLOW}  2. RTMP源连接问题${NC}"
        echo -e "${YELLOW}  3. HLS输出路径配置错误${NC}"
        echo -e "${YELLOW}  4. Nginx HLS文件服务配置问题${NC}"
    fi
done

echo -e "${YELLOW}4. 检查活动流状态...${NC}"

STREAMS_RESPONSE=$(curl -s -H "X-API-Key: $API_KEY" https://yoyo-vps.5202021.xyz/api/streams 2>/dev/null || echo "error")
echo -e "${CYAN}活动流状态:${NC}"
echo "$STREAMS_RESPONSE" | jq . 2>/dev/null || echo "$STREAMS_RESPONSE"

echo -e "${YELLOW}5. 前端播放建议...${NC}"

echo -e "${BLUE}如果HLS文件正常生成，前端播放问题可能是：${NC}"
echo -e "${YELLOW}  1. 前端HLS.js配置问题${NC}"
echo -e "${YELLOW}  2. CORS配置问题${NC}"
echo -e "${YELLOW}  3. 前端API调用逻辑问题${NC}"
echo -e "${YELLOW}  4. 视频播放器初始化问题${NC}"

echo -e "${GREEN}🎯 建议的前端测试步骤：${NC}"
echo -e "${CYAN}1. 在浏览器开发者工具中检查网络请求${NC}"
echo -e "${CYAN}2. 确认前端是否正确调用了转码API${NC}"
echo -e "${CYAN}3. 检查HLS.js是否能加载播放列表${NC}"
echo -e "${CYAN}4. 验证视频元素是否正确初始化${NC}"

echo -e "${BLUE}==================== 诊断完成 ====================${NC}"
echo -e "${YELLOW}测试流ID:${NC} $FRONTEND_STREAM_ID"
echo -e "${YELLOW}HLS播放地址:${NC} https://yoyo-vps.5202021.xyz$HLS_URL"
echo -e "${YELLOW}可以在浏览器中直接访问上述HLS地址测试播放${NC}"
echo -e "${BLUE}=================================================${NC}"
