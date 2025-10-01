#!/bin/bash

# VPS上执行的部署脚本 - 从zip包部署vps-transcoder-api
# 使用方法: ./vps-deploy-from-zip.sh [zip文件路径]

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
APP_DIR="/opt/yoyo-transcoder"
BACKUP_DIR="/opt/yoyo-transcoder-backup-$(date +%Y%m%d_%H%M%S)"
HLS_DIR="/var/www/hls"
LOG_DIR="/var/log/transcoder"
PM2_APP_NAME="vps-transcoder-api"

echo -e "${GREEN}🚀 开始部署YOYO转码API服务...${NC}"

# 检查参数
ZIP_FILE=${1:-"vps-transcoder-api.zip"}

if [ ! -f "$ZIP_FILE" ]; then
    echo -e "${RED}❌ 错误: ZIP文件不存在: $ZIP_FILE${NC}"
    echo -e "${YELLOW}请确保zip文件已上传到当前目录${NC}"
    exit 1
fi

echo -e "${BLUE}📦 使用ZIP文件: $ZIP_FILE${NC}"

# 检查是否为root用户
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}❌ 请使用root用户执行此脚本${NC}"
    exit 1
fi

# 停止现有服务
echo -e "${YELLOW}🛑 停止现有服务...${NC}"
pm2 stop $PM2_APP_NAME 2>/dev/null || echo "服务未运行"

# 备份现有应用（如果存在）
if [ -d "$APP_DIR" ]; then
    echo -e "${YELLOW}💾 备份现有应用到: $BACKUP_DIR${NC}"
    cp -r "$APP_DIR" "$BACKUP_DIR"
fi

# 创建应用目录
echo -e "${YELLOW}📁 准备应用目录...${NC}"
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"

# 解压新代码
echo -e "${YELLOW}📂 解压应用代码...${NC}"
cd "$APP_DIR"
unzip -q "$ZIP_FILE"

# 查找实际的应用目录（处理嵌套目录结构）
if [ -d "vps-transcoder-api" ]; then
    echo -e "${BLUE}📋 发现嵌套目录，调整结构...${NC}"
    mv vps-transcoder-api/* .
    rmdir vps-transcoder-api
fi

# 检查关键文件
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ 错误: 未找到package.json文件${NC}"
    exit 1
fi

if [ ! -f "src/app.js" ]; then
    echo -e "${RED}❌ 错误: 未找到src/app.js文件${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 应用代码解压完成${NC}"

# 安装依赖
echo -e "${YELLOW}📦 安装Node.js依赖...${NC}"
npm install --production

# 创建必要的目录
echo -e "${YELLOW}📁 创建必要目录...${NC}"
mkdir -p "$HLS_DIR"
mkdir -p "$LOG_DIR"
chown -R root:root "$HLS_DIR"
chown -R root:root "$LOG_DIR"
chmod 755 "$HLS_DIR"
chmod 755 "$LOG_DIR"

# 设置环境变量文件
echo -e "${YELLOW}⚙️  配置环境变量...${NC}"
if [ ! -f ".env" ]; then
    cat > .env << EOF
# VPS转码API环境配置
NODE_ENV=production
PORT=3000
API_KEY=85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938

# FFmpeg配置
FFMPEG_PATH=/usr/bin/ffmpeg
HLS_OUTPUT_DIR=/var/www/hls
HLS_SEGMENT_TIME=6
HLS_LIST_SIZE=10

# 日志配置
LOG_LEVEL=info
LOG_DIR=/var/log/transcoder
EOF
    echo -e "${GREEN}✅ 创建环境配置文件${NC}"
else
    echo -e "${BLUE}📋 使用现有环境配置文件${NC}"
fi

# 验证FFmpeg
echo -e "${YELLOW}🔍 验证FFmpeg安装...${NC}"
if command -v ffmpeg >/dev/null 2>&1; then
    FFMPEG_VERSION=$(ffmpeg -version | head -n1)
    echo -e "${GREEN}✅ FFmpeg已安装: $FFMPEG_VERSION${NC}"
else
    echo -e "${RED}❌ 错误: FFmpeg未安装${NC}"
    echo -e "${YELLOW}正在安装FFmpeg...${NC}"
    yum install -y epel-release
    yum install -y ffmpeg
fi

# 设置文件权限
echo -e "${YELLOW}🔐 设置文件权限...${NC}"
chown -R root:root "$APP_DIR"
chmod +x "$APP_DIR/src/app.js"

# 启动服务
echo -e "${YELLOW}🚀 启动服务...${NC}"
cd "$APP_DIR"

# 删除旧的PM2进程
pm2 delete $PM2_APP_NAME 2>/dev/null || echo "清理旧进程"

# 启动新服务
pm2 start src/app.js --name $PM2_APP_NAME --log "$LOG_DIR/app.log" --error "$LOG_DIR/error.log"

# 保存PM2配置
pm2 save

# 等待服务启动
echo -e "${YELLOW}⏳ 等待服务启动...${NC}"
sleep 5

# 健康检查
echo -e "${YELLOW}🏥 执行健康检查...${NC}"
for i in {1..10}; do
    if curl -s -f http://localhost:3000/health >/dev/null; then
        echo -e "${GREEN}✅ 服务健康检查通过!${NC}"
        break
    else
        echo -e "${YELLOW}⏳ 等待服务启动... ($i/10)${NC}"
        sleep 2
    fi
    
    if [ $i -eq 10 ]; then
        echo -e "${RED}❌ 服务启动失败，检查日志:${NC}"
        pm2 logs $PM2_APP_NAME --lines 20
        exit 1
    fi
done

# 显示服务状态
echo -e "${YELLOW}📊 服务状态:${NC}"
pm2 status $PM2_APP_NAME

# 测试API端点
echo -e "${YELLOW}🧪 测试API端点...${NC}"
API_KEY="85da076ae24b028b3d1ea1884e6b13c5afe34488be0f8d39a05fbbf26d23e938"

# 测试状态端点
if curl -s -H "X-API-Key: $API_KEY" http://localhost:3000/api/status | grep -q "running"; then
    echo -e "${GREEN}✅ API状态端点正常${NC}"
else
    echo -e "${RED}❌ API状态端点异常${NC}"
fi

# 显示部署信息
echo -e "${GREEN}🎉 部署完成!${NC}"
echo -e "${BLUE}==================== 部署信息 ====================${NC}"
echo -e "${YELLOW}应用目录:${NC} $APP_DIR"
echo -e "${YELLOW}HLS输出目录:${NC} $HLS_DIR"
echo -e "${YELLOW}日志目录:${NC} $LOG_DIR"
echo -e "${YELLOW}PM2应用名:${NC} $PM2_APP_NAME"
echo -e "${YELLOW}API密钥:${NC} $API_KEY"
echo -e "${BLUE}=================================================${NC}"

echo -e "${GREEN}常用命令:${NC}"
echo -e "${YELLOW}查看日志:${NC} pm2 logs $PM2_APP_NAME"
echo -e "${YELLOW}重启服务:${NC} pm2 restart $PM2_APP_NAME"
echo -e "${YELLOW}停止服务:${NC} pm2 stop $PM2_APP_NAME"
echo -e "${YELLOW}服务状态:${NC} pm2 status"

# 清理zip文件
if [ -f "$ZIP_FILE" ]; then
    echo -e "${YELLOW}🗑️  清理安装文件...${NC}"
    rm "$ZIP_FILE"
fi

echo -e "${GREEN}✅ 部署脚本执行完成!${NC}"
