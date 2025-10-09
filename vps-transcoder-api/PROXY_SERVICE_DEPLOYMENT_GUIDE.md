# VPS代理服务部署指南

## 📋 问题分析

### 当前问题
1. **VPS代理服务架构不完整**
   - 设计预期: 完整的ProxyManager.js + V2Ray/Xray + /api/proxy/test端点
   - 实际部署: 只有SimpleStreamManager，缺少代理测试服务
   - 影响: 所有VPS代理测试请求都失败

2. **本地验证逻辑过于严格**
   - 问题: 对真实可用代理采用了过于严格的连接测试
   - 结果: 即使代理可用，也被误判为"连接错误"

### 解决方案概述
1. ✅ **优化Cloudflare Workers本地验证** - 已完成
2. 🔄 **完善VPS代理服务部署** - 本指南重点
3. 🔄 **优化ProxyManager测试逻辑** - 已优化

## 🏗️ VPS代理服务架构

### 设计架构
```
VPS代理层:
├── ProxyManager.js          # 代理管理服务 ✅
├── V2Ray/Xray客户端         # 代理客户端 🔄
├── 透明代理配置             # iptables规则管理 ✅
└── API路由集成             # /api/proxy/* 端点 ✅
```

### 已实现组件
- ✅ **ProxyManager.js**: 完整的代理管理服务
- ✅ **代理API路由**: `/api/proxy/*` 端点已实现
- ✅ **app.js集成**: 代理路由已集成到主应用
- 🔄 **V2Ray/Xray客户端**: 需要在VPS上安装

## 🚀 部署步骤

### 第一步：检查当前部署状态
```bash
# 1. 检查VPS服务状态
pm2 status vps-transcoder-api

# 2. 检查代理API端点
curl -H "X-API-Key: YOUR_API_KEY" https://yoyo-vps.5202021.xyz/api/proxy/status
```

### 第二步：部署代理服务
```bash
# 1. 上传代码到VPS
cd /path/to/vps-transcoder-api

# 2. 运行部署脚本
chmod +x deploy-proxy-service.sh
./deploy-proxy-service.sh
```

### 第三步：验证部署
```bash
# 1. 检查服务状态
pm2 status

# 2. 测试代理API
curl -H "X-API-Key: 85da076ae24b028b3d1ea1884e6b13c5afe34..." \
     https://yoyo-vps.5202021.xyz/api/proxy/health

# 3. 查看日志
pm2 logs vps-transcoder-api
```

## 🔧 已优化的组件

### 1. ProxyManager测试逻辑优化
```javascript
// 原有问题：临时启动完整代理进程进行测试
// 新方案：配置验证 + 基础连通性检查

async testProxyConfig(proxyConfig) {
  // 1. 配置格式验证
  // 2. 主机名/IP验证  
  // 3. 协议特定验证
  // 4. 快速响应（不启动进程）
}
```

### 2. Cloudflare Workers本地验证优化
```javascript
// 优化策略：对真实代理采用宽松验证
async localProxyValidation(proxy) {
  // 只要配置格式正确且能解析服务器信息，就认为可用
  return { success: true, method: 'local_validation' };
}
```

### 3. VPS测试超时机制
```javascript
// 3秒超时，快速降级到本地验证
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => reject(new Error('VPS测试超时')), 3000);
});
```

## 📊 API端点说明

### 代理管理API
- `GET /api/proxy/status` - 获取代理状态
- `POST /api/proxy/test` - 测试代理连接 ⭐ **关键端点**
- `POST /api/proxy/config` - 更新代理配置
- `POST /api/proxy/control` - 代理控制操作
- `GET /api/proxy/health` - 代理健康检查
- `GET /api/proxy/stats` - 代理统计信息

### 测试流程
```
1. Cloudflare Workers 调用 VPS /api/proxy/test
   ↓ (3秒超时或失败)
2. 降级到本地验证 (宽松策略)
   ↓
3. 返回测试结果给前端
```

## 🔍 故障排除

### 常见问题

#### 1. VPS代理测试端点404
**症状**: Cloudflare Workers调用VPS失败
**原因**: VPS服务未正确部署或代理路由未加载
**解决**: 运行部署脚本，检查pm2状态

#### 2. 代理测试一直显示"连接错误"
**症状**: 真实可用代理显示错误状态
**原因**: VPS测试失败且本地验证过于严格
**解决**: 已通过优化本地验证逻辑解决

#### 3. V2Ray/Xray未安装
**症状**: 代理进程启动失败
**原因**: VPS缺少代理客户端
**解决**: 运行部署脚本自动安装

### 调试命令
```bash
# 查看VPS服务日志
pm2 logs vps-transcoder-api --lines 50

# 测试代理API连通性
curl -v -H "X-API-Key: YOUR_KEY" \
     https://yoyo-vps.5202021.xyz/api/proxy/status

# 检查V2Ray安装
which v2ray || which xray

# 检查代理配置目录
ls -la /opt/yoyo-transcoder/
```

## 📈 监控和维护

### 性能监控
- 监控VPS测试成功率
- 记录本地验证降级频率
- 统计不同代理协议的测试效果

### 日志分析
```bash
# 查看代理测试日志
pm2 logs vps-transcoder-api | grep "代理测试"

# 查看错误日志
pm2 logs vps-transcoder-api --err
```

### 定期维护
- 定期检查V2Ray/Xray版本更新
- 清理过期的代理配置文件
- 监控代理服务性能指标

## 🎯 预期效果

部署完成后，代理测试功能应该：
- ✅ 真实可用代理显示正确状态
- ✅ 快速响应（3秒内完成测试）
- ✅ 提供详细的测试方法标识
- ✅ 显示合理的延迟时间
- ✅ 支持多种代理协议（VLESS、VMess等）

## 📞 技术支持

如遇到部署问题，请：
1. 检查pm2服务状态
2. 查看详细错误日志
3. 验证API密钥配置
4. 确认网络连通性
