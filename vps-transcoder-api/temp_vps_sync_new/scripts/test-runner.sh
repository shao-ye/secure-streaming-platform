#!/bin/bash

# VPS转码API测试运行脚本
# 使用方法: ./scripts/test-runner.sh [环境]

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    echo -e "${BLUE}[DEBUG]${NC} $1"
}

# 获取环境参数
ENVIRONMENT=${1:-"development"}

log_info "开始VPS转码API测试 - 环境: $ENVIRONMENT"

# 设置环境变量
case $ENVIRONMENT in
    "development" | "dev")
        export TEST_API_URL="http://localhost:3000"
        export TEST_API_KEY="test-api-key-change-in-production"
        log_debug "使用开发环境配置"
        ;;
    "staging")
        if [ -z "$STAGING_API_URL" ] || [ -z "$STAGING_API_KEY" ]; then
            log_error "缺少staging环境配置: STAGING_API_URL, STAGING_API_KEY"
            exit 1
        fi
        export TEST_API_URL="$STAGING_API_URL"
        export TEST_API_KEY="$STAGING_API_KEY"
        log_debug "使用staging环境配置"
        ;;
    "production" | "prod")
        if [ -z "$PROD_API_URL" ] || [ -z "$PROD_API_KEY" ]; then
            log_error "缺少production环境配置: PROD_API_URL, PROD_API_KEY"
            exit 1
        fi
        export TEST_API_URL="$PROD_API_URL"
        export TEST_API_KEY="$PROD_API_KEY"
        log_warn "⚠️ 正在对生产环境进行测试，请确认这是安全的操作"
        read -p "继续? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "测试已取消"
            exit 0
        fi
        log_debug "使用production环境配置"
        ;;
    *)
        log_error "未知环境: $ENVIRONMENT"
        log_info "支持的环境: development, staging, production"
        exit 1
        ;;
esac

# 检查Node.js和npm
if ! command -v node &> /dev/null; then
    log_error "Node.js未安装"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    log_error "npm未安装"
    exit 1
fi

# 进入测试目录
cd "$(dirname "$0")/../tests"

# 安装测试依赖（如果需要）
if [ ! -d "node_modules" ]; then
    log_info "安装测试依赖..."
    npm install
fi

# 显示测试配置
log_info "测试配置:"
echo "  - API URL: $TEST_API_URL"
echo "  - API Key: ${TEST_API_KEY:0:8}..."
echo "  - 环境: $ENVIRONMENT"
echo

# 预检查 - ping API服务器
log_info "预检查: 检查API服务器连通性..."
API_HOST=$(echo "$TEST_API_URL" | sed -n 's|.*://\([^:/]*\).*|\1|p')
API_PORT=$(echo "$TEST_API_URL" | sed -n 's|.*:\([0-9]*\).*|\1|p')

if [ -z "$API_PORT" ]; then
    if [[ "$TEST_API_URL" == https* ]]; then
        API_PORT=443
    else
        API_PORT=80
    fi
fi

if ! timeout 5 bash -c "cat < /dev/null > /dev/tcp/$API_HOST/$API_PORT" 2>/dev/null; then
    log_error "无法连接到API服务器 $API_HOST:$API_PORT"
    log_error "请确保:"
    log_error "1. VPS转码API服务正在运行"
    log_error "2. 防火墙允许连接"
    log_error "3. 网络连通性正常"
    exit 1
fi

log_info "✅ API服务器连通性正常"

# 运行API测试
log_info "开始运行API接口测试..."
echo "=" * 60

if node api-test.js; then
    log_info "✅ API测试完成"

    # 检查测试报告
    if [ -f "test-report.json" ]; then
        log_info "📊 测试报告生成成功"

        # 提取关键信息
        PASS_RATE=$(node -e "
            const report = require('./test-report.json');
            console.log(report.summary.passRate);
        ")

        log_info "测试通过率: $PASS_RATE"

        # 根据通过率判断结果
        PASS_NUM=$(echo "$PASS_RATE" | sed 's/%//')
        if (( $(echo "$PASS_NUM >= 90" | bc -l) )); then
            log_info "🎉 测试结果优秀!"
        elif (( $(echo "$PASS_NUM >= 70" | bc -l) )); then
            log_warn "⚠️ 测试结果一般，建议检查失败项"
        else
            log_error "❌ 测试结果不佳，需要修复问题"
            exit 1
        fi

        # 显示报告路径
        REPORT_PATH="$(pwd)/test-report.json"
        log_info "详细报告: $REPORT_PATH"

    else
        log_warn "未找到测试报告文件"
    fi

else
    log_error "❌ API测试失败"
    exit 1
fi

# 清理（可选）
if [ "$ENVIRONMENT" = "development" ]; then
    log_debug "保留测试文件用于调试"
else
    log_debug "清理临时文件..."
    # rm -f test-report.json
fi

log_info "测试完成! 🎯"

echo
log_info "下一步建议:"
echo "1. 查看详细测试报告了解具体结果"
echo "2. 如有失败项，检查VPS服务和配置"
echo "3. 确认所有依赖服务（Nginx、FFmpeg、PM2）正常运行"
echo "4. 进行负载测试验证性能表现"
