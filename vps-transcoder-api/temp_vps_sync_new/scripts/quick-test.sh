#!/bin/bash

# 快速API测试脚本
# 使用方法: ./scripts/quick-test.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置
API_URL=${TEST_API_URL:-"http://localhost:3000"}
API_KEY=${TEST_API_KEY:-"test-api-key-change-in-production"}

echo -e "${BLUE}🚀 快速API接口测试${NC}"
echo -e "测试地址: $API_URL"
echo -e "API密钥: ${API_KEY:0:8}..."
echo

# 检查curl是否可用
if ! command -v curl &> /dev/null; then
    echo -e "${RED}❌ curl命令未找到，请安装curl${NC}"
    exit 1
fi

# 测试计数器
PASS=0
TOTAL=0

# 测试函数
test_endpoint() {
    local name="$1"
    local method="$2"
    local url="$3"
    local headers="$4"
    local data="$5"
    local expected_status="$6"

    echo -n "测试: $name ... "
    TOTAL=$((TOTAL + 1))

    if [ "$method" = "GET" ]; then
        response=$(curl -s -w "%{http_code}" -H "$headers" "$url" -o /tmp/curl_response 2>/dev/null || echo "000")
    else
        response=$(curl -s -w "%{http_code}" -X "$method" -H "$headers" -d "$data" "$url" -o /tmp/curl_response 2>/dev/null || echo "000")
    fi

    if [ "$response" = "$expected_status" ]; then
        echo -e "${GREEN}✅ 通过${NC}"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}❌ 失败 (状态码: $response, 期望: $expected_status)${NC}"
        if [ -f /tmp/curl_response ]; then
            echo -e "${YELLOW}响应内容:${NC}"
            cat /tmp/curl_response
            echo
        fi
    fi
}

# 开始测试
echo -e "${BLUE}开始接口测试...${NC}"
echo

# 测试1: 健康检查
test_endpoint "健康检查" "GET" "$API_URL/health" "" "" "200"

# 测试2: 无API Key访问（应该被拒绝）
test_endpoint "无API Key访问" "GET" "$API_URL/api/status" "" "" "401"

# 测试3: 错误API Key（应该被拒绝）
test_endpoint "错误API Key" "GET" "$API_URL/api/status" "X-API-Key: invalid-key" "" "403"

# 测试4: 正确API Key访问
test_endpoint "正确API Key访问" "GET" "$API_URL/api/status" "X-API-Key: $API_KEY" "" "200"

# 测试5: 获取流列表
test_endpoint "获取流列表" "GET" "$API_URL/api/streams" "X-API-Key: $API_KEY" "" "200"

# 测试6: 无效参数（应该被拒绝）
test_endpoint "无效参数验证" "POST" "$API_URL/api/start-stream" "Content-Type: application/json|X-API-Key: $API_KEY" "{}" "400"

# 清理临时文件
rm -f /tmp/curl_response

# 输出结果
echo
echo -e "${BLUE}===================${NC}"
echo -e "${BLUE}测试结果总结${NC}"
echo -e "${BLUE}===================${NC}"
echo -e "总测试数: $TOTAL"
echo -e "${GREEN}通过: $PASS${NC}"
echo -e "${RED}失败: $((TOTAL - PASS))${NC}"

PASS_RATE=$((PASS * 100 / TOTAL))
echo -e "通过率: $PASS_RATE%"

if [ $PASS -eq $TOTAL ]; then
    echo -e "\n${GREEN}🎉 所有测试通过！API工作正常${NC}"
    exit 0
elif [ $PASS_RATE -ge 80 ]; then
    echo -e "\n${YELLOW}⚠️ 大部分测试通过，请检查失败项${NC}"
    exit 0
else
    echo -e "\n${RED}❌ 多个测试失败，请检查服务状态${NC}"
    exit 1
fi
