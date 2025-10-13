# VPS代码同步和测试脚本
Write-Host "🔄 VPS代理测试API修复 - 同步和验证" -ForegroundColor Green

Write-Host "`n📋 需要在VPS上执行的命令:" -ForegroundColor Yellow
Write-Host "1. SSH登录VPS: ssh root@yoyo-vps.5202021.xyz" -ForegroundColor Gray
Write-Host "2. 进入Git目录: cd /temp/github/secure-streaming-platform" -ForegroundColor Gray
Write-Host "3. 拉取最新代码: git pull origin master" -ForegroundColor Gray
Write-Host "4. 同步到运行目录: cp -r vps-transcoder-api/src/* /opt/yoyo-transcoder/src/" -ForegroundColor Gray
Write-Host "5. 重启服务: pm2 reload vps-transcoder-api" -ForegroundColor Gray

Write-Host "`n🧪 验证VPS API修复效果:" -ForegroundColor Yellow

# 测试数据 - 使用一个简单的测试代理配置
$testData = @{
    proxyId = "test-proxy-fix"
    proxyConfig = @{
        id = "test-proxy-fix"
        name = "测试代理修复"
        type = "vless"
        config = "vless://test@example.com:443"
    }
    testUrlId = "baidu"
} | ConvertTo-Json -Depth 10

Write-Host "📝 测试数据:" -ForegroundColor Cyan
Write-Host $testData -ForegroundColor Gray

Write-Host "`n🚀 发送测试请求到VPS..." -ForegroundColor Cyan

try {
    $response = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/test" -Method POST -Body $testData -ContentType "application/json" -TimeoutSec 20
    
    Write-Host "✅ VPS API调用成功!" -ForegroundColor Green
    Write-Host "📊 响应数据:" -ForegroundColor Yellow
    Write-Host ($response | ConvertTo-Json -Depth 3) -ForegroundColor Gray
    
    # 检查响应格式
    if ($response.data) {
        Write-Host "`n🔍 数据格式验证:" -ForegroundColor Yellow
        Write-Host "   status: $($response.status)" -ForegroundColor Gray
        Write-Host "   message: $($response.message)" -ForegroundColor Gray
        Write-Host "   data.success: $($response.data.success)" -ForegroundColor Gray
        Write-Host "   data.latency: $($response.data.latency)" -ForegroundColor Gray
        Write-Host "   data.method: $($response.data.method)" -ForegroundColor Gray
        Write-Host "   data.error: $($response.data.error)" -ForegroundColor Gray
        
        if ($response.data.method -eq "real_test") {
            Write-Host "✅ VPS返回正确的测试方法: real_test" -ForegroundColor Green
        } else {
            Write-Host "❌ VPS返回错误的测试方法: $($response.data.method)" -ForegroundColor Red
        }
        
        if ($response.data.PSObject.Properties.Name -contains "success" -and 
            $response.data.PSObject.Properties.Name -contains "latency" -and 
            $response.data.PSObject.Properties.Name -contains "method") {
            Write-Host "✅ VPS返回数据格式正确" -ForegroundColor Green
        } else {
            Write-Host "❌ VPS返回数据格式不完整" -ForegroundColor Red
        }
    } else {
        Write-Host "❌ VPS响应中缺少data字段" -ForegroundColor Red
    }
    
} catch {
    Write-Host "❌ VPS API调用失败: $($_.Exception.Message)" -ForegroundColor Red
    
    if ($_.Exception.Message -like "*404*") {
        Write-Host "   可能原因: VPS代码未同步或路由配置错误" -ForegroundColor Yellow
    } elseif ($_.Exception.Message -like "*500*") {
        Write-Host "   可能原因: VPS代码有语法错误或依赖缺失" -ForegroundColor Yellow
    } elseif ($_.Exception.Message -like "*timeout*") {
        Write-Host "   可能原因: VPS服务未运行或网络问题" -ForegroundColor Yellow
    }
}

Write-Host "`n📋 修复总结:" -ForegroundColor Cyan
Write-Host "=" * 50
Write-Host "🎯 修复的问题:" -ForegroundColor Green
Write-Host "   1. Workers发送给VPS的请求格式错误" -ForegroundColor Gray
Write-Host "   2. VPS不支持testUrlId参数" -ForegroundColor Gray
Write-Host "   3. R2存储条件检查逻辑问题" -ForegroundColor Gray
Write-Host ""
Write-Host "🔧 修复的内容:" -ForegroundColor Green
Write-Host "   1. 修正Workers请求体格式 (添加proxyId和testUrlId)" -ForegroundColor Gray
Write-Host "   2. VPS支持testUrlId参数选择测试网站" -ForegroundColor Gray
Write-Host "   3. 增强R2存储调试日志" -ForegroundColor Gray
Write-Host ""
Write-Host "📝 下一步:" -ForegroundColor Yellow
Write-Host "   1. 在VPS上同步代码并重启服务" -ForegroundColor Gray
Write-Host "   2. 重新部署Cloudflare Workers" -ForegroundColor Gray
Write-Host "   3. 测试完整的代理测试和R2存储流程" -ForegroundColor Gray
Write-Host "=" * 50
