# 测试代理启用API
Write-Host "🧪 测试VPS代理启用API..." -ForegroundColor Cyan

# 测试数据 - 模拟从KV获取的完整配置
$testProxyConfig = @{
    id = "proxy_test_enable_001"
    name = "测试代理JP"
    type = "vless"
    config = "vless://d727ce27-4996-4bcc-a599-3123824f0d20@104.224.158.96:443?encryption=none&security=tls&type=xhttp&host=x.262777.xyz&path=/d727ce27&mode=auto#RN-xhttp-cdn"
} | ConvertTo-Json -Depth 3

Write-Host "📤 发送代理配置:" -ForegroundColor Yellow
Write-Host $testProxyConfig

try {
    # 测试VPS的/api/proxy/enable端点
    $response = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/enable" -Method POST -Body @{
        proxyConfig = @{
            id = "proxy_test_enable_001"
            name = "测试代理JP"
            type = "vless"
            config = "vless://d727ce27-4996-4bcc-a599-3123824f0d20@104.224.158.96:443?encryption=none&security=tls&type=xhttp&host=x.262777.xyz&path=/d727ce27&mode=auto#RN-xhttp-cdn"
        }
    } | ConvertTo-Json -ContentType "application/json" -TimeoutSec 30
    
    Write-Host "✅ API调用成功:" -ForegroundColor Green
    Write-Host ($response | ConvertTo-Json -Depth 3)
    
    # 检查代理状态
    Start-Sleep -Seconds 3
    $status = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/api/proxy/status" -Method GET -TimeoutSec 10
    Write-Host "📊 代理状态:" -ForegroundColor Magenta
    Write-Host ($status | ConvertTo-Json -Depth 3)
    
} catch {
    Write-Host "❌ API调用失败:" -ForegroundColor Red
    Write-Host $_.Exception.Message
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "响应内容: $responseBody"
    }
}
