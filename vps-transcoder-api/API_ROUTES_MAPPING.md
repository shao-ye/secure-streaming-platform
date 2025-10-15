# 🗺️ API路由映射表

## 代理管理API路由完整映射

### 前端调用 → Workers路由 → VPS端点

| 功能 | 前端方法 | Workers路由 | VPS端点 | 状态 |
|------|----------|-------------|---------|------|
| 获取配置 | `proxyApi.getConfig()` | `GET /api/admin/proxy/config` | `GET /api/proxy/config` | ✅ |
| 创建代理 | `proxyApi.createProxy()` | `POST /api/admin/proxy/config` | `POST /api/proxy/config` | ✅ |
| 更新代理 | `proxyApi.updateProxy()` | `PUT /api/admin/proxy/config/:id` | `PUT /api/proxy/config/:id` | ✅ |
| 删除代理 | `proxyApi.deleteProxy()` | `DELETE /api/admin/proxy/config/:id` | `DELETE /api/proxy/config/:id` | ✅ |
| 获取状态 | `proxyApi.getStatus()` | `GET /api/admin/proxy/status` | `GET /api/proxy/status` | ✅ |
| 测试代理 | `proxyApi.testProxy()` | `POST /api/admin/proxy/test` | `POST /api/proxy/test` | ✅ |
| **连接代理** | `proxyApi.connectProxy()` | `POST /api/admin/proxy/connect` | `POST /api/proxy/connect` | ✅ |
| **断开代理** | `proxyApi.disconnectProxy()` | `POST /api/admin/proxy/disconnect` | `POST /api/proxy/disconnect` | ✅ |
| 代理控制 | `proxyApi.controlProxy()` | `POST /api/admin/proxy/control` | `POST /api/proxy/control` | ✅ |

## 问题分析

### 为什么经常遗漏Workers路由？

1. **三层架构复杂性**
   ```
   前端 (Vue.js) 
     ↓ HTTP请求
   Workers (Cloudflare) 
     ↓ 转发请求  
   VPS (Node.js)
   ```

2. **路由定义分散**
   - 前端: `frontend/src/services/proxyApi.js`
   - Workers: `cloudflare-worker/src/handlers/proxyHandler.js`
   - VPS: `vps-transcoder-api/src/routes/proxy.js`

3. **测试不完整**
   - 经常只测试VPS端点
   - 忽略完整的前端→Workers→VPS流程

### 预防措施

1. **API开发检查清单**
   - [ ] 前端方法已定义
   - [ ] Workers路由已添加
   - [ ] VPS端点已实现
   - [ ] 端到端测试通过

2. **部署前验证**
   ```bash
   # 检查所有API端点
   curl -X POST https://yoyoapi.5202021.xyz/api/admin/proxy/connect
   curl -X POST https://yoyo-vps.5202021.xyz/api/proxy/connect
   ```

3. **自动化测试**
   - 建立API端点健康检查
   - 前端→Workers→VPS完整链路测试

## 常见错误模式

### ❌ 错误做法
1. 只修改VPS端点，忘记Workers路由
2. 只测试VPS直接调用
3. 假设Workers会自动转发所有请求

### ✅ 正确做法  
1. 同时修改三层的对应文件
2. 进行端到端测试
3. 验证完整的调用链路

## 维护建议

1. **每次API修改时**
   - 更新此映射表
   - 检查三层一致性
   - 进行完整测试

2. **定期检查**
   - 验证所有路由可用性
   - 检查API文档一致性
   - 更新测试用例

3. **文档同步**
   - 保持此表格最新
   - 记录API变更历史
   - 维护测试脚本
