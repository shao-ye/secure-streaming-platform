#!/bin/bash

# YOYO流媒体平台HLS文件清理脚本
# 建议每天运行一次，清理超过24小时的HLS文件

echo "=== HLS文件清理开始 ==="
echo "清理时间: $(date)"

# 清理超过24小时的.ts文件
echo "正在清理超过24小时的.ts文件..."
DELETED_TS=$(find /var/www/hls -name "*.ts" -mtime +1 -delete -print | wc -l)
echo "已删除 $DELETED_TS 个.ts文件"

# 清理超过1小时的.m3u8文件（保留最新的播放列表）
echo "正在清理过期的.m3u8文件..."
find /var/www/hls -name "*.m3u8" -mtime +0.04 -delete
echo "已清理过期的.m3u8文件"

# 清理空目录
echo "正在清理空目录..."
find /var/www/hls -type d -empty -delete
echo "已清理空目录"

# 显示当前磁盘使用情况
echo "当前HLS目录磁盘使用情况:"
du -sh /var/www/hls

echo "=== HLS文件清理完成 ==="
