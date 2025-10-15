# 测试ProxyManager初始化
Write-Host "测试ProxyManager初始化..." -ForegroundColor Cyan

# 简化测试 - 检查文件和依赖
try {
    $result = ssh root@142.171.75.220 "cd /opt/yoyo-transcoder && echo 'Testing ProxyManager...' && ls -la src/services/ProxyManager.js && echo 'Testing require...' && node -e 'console.log(require(\"./src/services/ProxyManager\"))'"
    Write-Host "ProxyManager文件测试结果:" -ForegroundColor Green
    Write-Host $result
} catch {
    Write-Host "测试执行失败: $($_.Exception.Message)" -ForegroundColor Red
}
