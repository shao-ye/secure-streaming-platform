# 测试R2存储写入功能
Write-Host "🔍 测试R2存储写入功能" -ForegroundColor Green

# 获取认证token
$token = Read-Host "`n请输入有效的管理员认证token"

if (-not $token) {
    Write-Host "❌ 需要有效的token才能继续测试" -ForegroundColor Red
    exit 1
}

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

Write-Host "`n📊 步骤1: 测试R2写入功能" -ForegroundColor Yellow
$testData = @{
    proxyId = "test_proxy_123"
    testUrlId = "baidu"
    success = $true
    latency = 999
    method = "test"
    error = $null
} | ConvertTo-Json

try {
    Write-Host "   🚀 发送R2写入测试请求..." -ForegroundColor Cyan
    $writeResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/debug/test-r2-write" -Method POST -Headers $headers -Body $testData -TimeoutSec 10
    
    Write-Host "✅ R2写入测试完成" -ForegroundColor Green
    Write-Host "   结果: $($writeResult.message)" -ForegroundColor Gray
    
} catch {
    Write-Host "❌ R2写入测试失败: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "`n📊 步骤2: 验证R2读取功能" -ForegroundColor Yellow
try {
    Write-Host "   🔍 读取刚才写入的测试数据..." -ForegroundColor Cyan
    $readResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/test_proxy_123" -Method GET -Headers $headers -TimeoutSec 10
    
    if ($readResult.data -and $readResult.data.Count -gt 0) {
        $testRecord = $readResult.data[0]
        Write-Host "✅ R2读取成功" -ForegroundColor Green
        Write-Host "   延迟: $($testRecord.latency)ms" -ForegroundColor Gray
        Write-Host "   时间: $($testRecord.timestamp)" -ForegroundColor Gray
        Write-Host "   方法: $($testRecord.method)" -ForegroundColor Gray
        
        if ($testRecord.latency -eq 999) {
            Write-Host "   ✅ 数据完全一致!" -ForegroundColor Green
        } else {
            Write-Host "   ⚠️ 数据不一致" -ForegroundColor Yellow
        }
    } else {
        Write-Host "❌ R2读取失败 - 没有找到测试数据" -ForegroundColor Red
    }
    
} catch {
    Write-Host "❌ R2读取失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n📊 步骤3: 测试真实代理的R2存储" -ForegroundColor Yellow
try {
    Write-Host "   🔍 检查真实代理的历史记录..." -ForegroundColor Cyan
    $realResult = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/proxy/test-history/proxy_1760329814328_lyeyuemkh" -Method GET -Headers $headers -TimeoutSec 10
    
    if ($realResult.data -and $realResult.data.Count -gt 0) {
        $realRecord = $realResult.data[0]
        Write-Host "✅ 找到真实代理历史记录" -ForegroundColor Green
        Write-Host "   延迟: $($realRecord.latency)ms" -ForegroundColor Gray
        Write-Host "   时间: $($realRecord.timestamp)" -ForegroundColor Gray
        Write-Host "   方法: $($realRecord.method)" -ForegroundColor Gray
        Write-Host "   成功: $($realRecord.success)" -ForegroundColor Gray
    } else {
        Write-Host "❌ 真实代理没有历史记录" -ForegroundColor Red
        Write-Host "   这说明R2存储写入在实际测试中失败了" -ForegroundColor Yellow
    }
    
} catch {
    Write-Host "❌ 检查真实代理历史记录失败: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n📋 测试结果总结" -ForegroundColor Cyan
Write-Host "=" * 60
Write-Host "🎯 R2存储功能测试分析:" -ForegroundColor Green
Write-Host ""
Write-Host "如果测试写入成功但真实代理没有记录:" -ForegroundColor Yellow
Write-Host "   → R2存储桶配置正常" -ForegroundColor Gray
Write-Host "   → 问题在于代理测试时的R2写入条件或逻辑" -ForegroundColor Gray
Write-Host ""
Write-Host "如果测试写入失败:" -ForegroundColor Yellow
Write-Host "   → R2存储桶权限或配置有问题" -ForegroundColor Gray
Write-Host "   → 需要检查Cloudflare Workers的R2绑定" -ForegroundColor Gray
Write-Host "=" * 60
