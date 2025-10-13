# 获取认证token的辅助脚本
Write-Host "获取认证token步骤:" -ForegroundColor Green
Write-Host "1. 打开浏览器访问: https://yoyo.5202021.xyz/admin" -ForegroundColor Yellow
Write-Host "2. 登录管理后台" -ForegroundColor Yellow
Write-Host "3. 按F12打开开发者工具" -ForegroundColor Yellow
Write-Host "4. 切换到Network标签页" -ForegroundColor Yellow
Write-Host "5. 点击任意代理的测试按钮" -ForegroundColor Yellow
Write-Host "6. 在Network中找到 'test' 请求" -ForegroundColor Yellow
Write-Host "7. 点击该请求，查看Request Headers" -ForegroundColor Yellow
Write-Host "8. 复制Authorization字段中Bearer后面的token" -ForegroundColor Yellow
Write-Host ""
Write-Host "示例: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." -ForegroundColor Gray
Write-Host "只需要复制Bearer后面的部分" -ForegroundColor Gray
