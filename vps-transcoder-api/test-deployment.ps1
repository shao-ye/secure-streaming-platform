# Test deployment after cleanup

Write-Host "=== Production Deployment Test ===" -ForegroundColor Cyan
Write-Host ""

# 1. Test Workers API
Write-Host "1. Testing Workers API..." -ForegroundColor Yellow
try {
    $workers = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/health" -TimeoutSec 10
    Write-Host "   Status: $($workers.status)" -ForegroundColor Green
    Write-Host "   Service: $($workers.service)" -ForegroundColor Green
    Write-Host "   Version: $($workers.version)" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: Workers API failed" -ForegroundColor Red
    Write-Host "   $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# 2. Test Frontend
Write-Host "2. Testing Frontend..." -ForegroundColor Yellow
try {
    $frontend = Invoke-WebRequest -Uri "https://yoyo.5202021.xyz" -TimeoutSec 10 -UseBasicParsing
    Write-Host "   Status Code: $($frontend.StatusCode)" -ForegroundColor Green
    Write-Host "   Content Length: $($frontend.Content.Length) bytes" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: Frontend failed" -ForegroundColor Red
    Write-Host "   $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# 3. Test VPS API
Write-Host "3. Testing VPS API..." -ForegroundColor Yellow
try {
    $vps = Invoke-RestMethod -Uri "https://yoyo-vps.5202021.xyz/health" -TimeoutSec 10
    Write-Host "   Status: $($vps.status)" -ForegroundColor Green
} catch {
    Write-Host "   ERROR: VPS API failed" -ForegroundColor Red
    Write-Host "   $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# 4. Test Login Flow
Write-Host "4. Testing Login Flow..." -ForegroundColor Yellow
try {
    $body = '{"username":"admin","password":"admin123"}'
    $login = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/login" -Method Post -Body $body -ContentType "application/json"
    
    if ($login.success) {
        Write-Host "   Login: SUCCESS" -ForegroundColor Green
        Write-Host "   User: $($login.data.user.username)" -ForegroundColor Green
        Write-Host "   Token: $($login.data.token.Substring(0,20))..." -ForegroundColor Green
        
        # Test authenticated request
        $headers = @{Authorization="Bearer $($login.data.token)"}
        $streams = Invoke-RestMethod -Uri "https://yoyoapi.5202021.xyz/api/admin/streams" -Headers $headers
        Write-Host "   Streams API: SUCCESS ($($streams.data.streams.Count) channels)" -ForegroundColor Green
    } else {
        Write-Host "   Login: FAILED" -ForegroundColor Red
    }
} catch {
    Write-Host "   ERROR: Login failed" -ForegroundColor Red
    Write-Host "   $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Test Complete ===" -ForegroundColor Cyan
