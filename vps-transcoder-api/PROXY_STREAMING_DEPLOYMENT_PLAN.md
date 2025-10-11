# 🚀 代理流媒体转发功能部署计划

## 📋 当前状态

### ✅ 已完成的工作

#### 1. VPS端代理管理服务
- ✅ **ProxyManager_v2.js**: 完整的代理连接和断开功能
- ✅ **proxy.js路由**: 添加了 `/api/proxy/connect` 和 `/api/proxy/disconnect` 端点
- ✅ **V2Ray/Xray支持**: 完整的VLESS/VMess协议解析和配置生成
- ✅ **透明代理**: iptables规则管理，支持FFmpeg流量转发

#### 2. Cloudflare Workers API层
- ✅ **proxyManager.js**: 新的代理管理处理器
- ✅ **路由注册**: 添加了完整的代理管理API端点
- ✅ **权限验证**: 管理员权限检查
- ✅ **VPS通信**: 完整的API转发逻辑

#### 3. 核心功能实现
- ✅ **代理连接**: `POST /api/admin/proxy/connect`
- ✅ **代理断开**: `POST /api/admin/proxy/disconnect`
- ✅ **状态监控**: `GET /api/admin/proxy/status`
- ✅ **配置管理**: `GET/POST /api/admin/proxy/config`
- ✅ **代理测试**: `POST /api/admin/proxy/test`

## ❌ 当前问题

### 1. VPS服务状态
- **问题**: VPS服务当前返回502错误，可能在重启中
- **原因**: deploy-proxy-service.sh脚本执行可能导致服务重启
- **影响**: 无法测试新的代理连接功能

### 2. Cloudflare Workers部署
- **问题**: 路由冲突，无法直接部署
- **原因**: yoyo-streaming-worker-production已占用路由
- **影响**: 新的代理管理API无法生效

## 🔧 解决方案

### 第一步：等待VPS服务恢复
```powershell
# 持续检查VPS状态
while ($true) {
    try {
        $health = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/health" -Method GET -TimeoutSec 5
        Write-Host "✅ VPS服务已恢复: $($health.message)"
        break
    } catch {
        Write-Host "⏳ VPS服务恢复中... 等待30秒"
        Start-Sleep -Seconds 30
    }
}
```

### 第二步：解决Cloudflare Workers路由冲突
```bash
# 方法1: 使用环境变量部署
wrangler deploy --env production

# 方法2: 临时移除路由冲突
# 在Cloudflare Dashboard中暂时取消yoyo-streaming-worker-production的路由分配
```

### 第三步：验证代理连接功能
```powershell
# 1. 测试代理连接API
$proxyConfig = @{
    id = "proxy_jp_001"
    name = "jp代理"
    type = "vless"
    config = "vless://f57c1ece-0062-4c18-8e5e-7a5dbfbf33aa@136.0.11.251:52142?type=xhttp&security=reality&pbk=Z84J2IelR9ch3k8VtlVhhs5ycBUlXZrtNav-1FD3xAo&fp=chrome&sni=www.tesla.com&sid=6ba85179e30d4fc2&path=%2F&host=www.tesla.com"
}

$body = @{ proxyConfig = $proxyConfig } | ConvertTo-Json -Depth 3
$result = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/connect" -Method POST -Body $body -ContentType "application/json" -Headers @{Authorization="Bearer YOUR_TOKEN"}

# 2. 检查连接状态
$status = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/status" -Method GET -Headers @{Authorization="Bearer YOUR_TOKEN"}

# 3. 测试代理断开
$disconnect = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/disconnect" -Method POST -Headers @{Authorization="Bearer YOUR_TOKEN"}
```

## 🎯 预期效果

### 代理连接成功后
1. **VPS状态**: connectionStatus 从 "disconnected" 变为 "connected"
2. **代理进程**: V2Ray/Xray进程启动，监听1080端口
3. **透明代理**: iptables规则生效，FFmpeg流量通过代理转发
4. **前端显示**: 操作列按钮从"连接"变为"断开"

### 流媒体转发效果
1. **RTMP源**: 通过代理访问，减少延迟和提高稳定性
2. **HLS输出**: 保持正常，但网络质量改善
3. **用户体验**: 视频加载更快，播放更稳定

## 📊 测试验证计划

### 1. 基础功能测试
- [ ] 代理连接API响应正常
- [ ] 代理断开API响应正常
- [ ] 状态监控API返回正确状态
- [ ] V2Ray/Xray进程正确启动和停止

### 2. 流媒体转发测试
- [ ] 配置真实RTMP源
- [ ] 启动代理连接
- [ ] 验证FFmpeg通过代理访问RTMP
- [ ] 检查HLS输出质量和延迟

### 3. 前端集成测试
- [ ] 前端"连接"按钮功能正常
- [ ] 状态显示正确更新
- [ ] "断开"按钮功能正常
- [ ] 错误处理和用户反馈

## 🚨 风险评估

### 高风险项
1. **VPS服务稳定性**: 代理进程可能影响系统稳定性
2. **网络配置**: iptables规则可能影响其他服务
3. **权限问题**: V2Ray/Xray可能需要特殊权限

### 缓解措施
1. **进程监控**: 实现进程健康检查和自动重启
2. **规则备份**: 保存原始iptables规则，支持快速恢复
3. **权限检查**: 确保V2Ray/Xray有足够权限运行

## 📝 部署检查清单

### VPS端检查
- [ ] V2Ray/Xray客户端已安装
- [ ] ProxyManager_v2.js已部署
- [ ] proxy.js路由已更新
- [ ] app.js已集成代理路由
- [ ] PM2服务已重启

### Cloudflare Workers检查
- [ ] proxyManager.js已创建
- [ ] index.js路由已添加
- [ ] 环境变量已配置
- [ ] Workers已成功部署

### 前端检查
- [ ] 代理配置界面已更新
- [ ] API调用逻辑已修改
- [ ] 状态管理已完善
- [ ] 错误处理已优化

---

**创建时间**: 2025年10月11日 14:33  
**状态**: 等待VPS服务恢复和Workers部署  
**下一步**: 监控VPS状态恢复，解决Workers路由冲突
