param([switch]$RestartBackend)

$ErrorActionPreference = 'Stop'
$deployment = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $deployment
$frontend = Join-Path $workspace 'miniapp'
$runtime = Join-Path $deployment '.runtime'

function Test-FrontendReady([int]$Port) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$Port/" -TimeoutSec 3
        return $response.StatusCode -eq 200 -and $response.Content -match '<div id="app">'
    } catch {
        return $false
    }
}

function Get-ReadyFrontendPort([uint32[]]$ProcessIds) {
    if (-not $ProcessIds) { return }

    $ports = Get-NetTCPConnection -State Listen -OwningProcess $ProcessIds -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -in '127.0.0.1', '0.0.0.0', '::1', '::' } |
        Select-Object -ExpandProperty LocalPort -Unique
    foreach ($port in $ports) {
        if (Test-FrontendReady $port) { return $port }
    }
}

function Get-RunningFrontend {
    $processIds = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.IndexOf("$frontend\", [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
            $_.CommandLine -match '\btaro"? build --type h5 --watch\b'
    } | ForEach-Object { $_.ProcessId })
    Get-ReadyFrontendPort $processIds
}

function Get-FrontendPort {
    foreach ($candidate in 10086, 9209, 0) {
        $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $candidate)
        try {
            $listener.Start()
            return $listener.LocalEndpoint.Port
        } catch [Net.Sockets.SocketException] {
            continue
        } finally {
            $listener.Stop()
        }
    }
    throw '未能分配预览端口。'
}

function Start-Frontend {
    $existing = Get-RunningFrontend
    if ($existing) {
        Write-Host "复用已运行的网页（端口 $existing）。"
        return $existing
    }

    $cli = Join-Path $frontend 'node_modules/@tarojs/cli/bin/taro'
    if (-not (Test-Path -LiteralPath $cli)) {
        Write-Host '正在安装网页依赖。首次运行需要等待下载完成。'
        Push-Location -LiteralPath $frontend
        try {
            & npm.cmd ci --legacy-peer-deps --no-audit --no-fund | Out-Host
            if ($LASTEXITCODE -ne 0) { throw '网页依赖安装失败。' }
        } finally {
            Pop-Location
        }
    }

    $port = Get-FrontendPort
    $outLog = Join-Path $runtime 'h5.out.log'
    $errLog = Join-Path $runtime 'h5.err.log'
    $launch = @{
        FilePath = (Get-Command node.exe -ErrorAction Stop).Source
        ArgumentList = @(('"{0}"' -f $cli), 'build', '--type', 'h5', '--watch', '--port', "$port")
        WorkingDirectory = $frontend
        WindowStyle = 'Hidden'
        PassThru = $true
        RedirectStandardOutput = $outLog
        RedirectStandardError = $errLog
    }
    $process = Start-Process @launch

    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline -and -not $process.HasExited) {
        $readyPort = Get-ReadyFrontendPort $process.Id
        if ($readyPort) { return $readyPort }
        Start-Sleep -Seconds 1
    }

    throw "网页未就绪。请查看 $outLog 和 $errLog。"
}

$mutex = [Threading.Mutex]::new($false, 'Local\WHUAdmissionAssistantLauncher')
$ownsMutex = $false
try {
    try {
        $ownsMutex = $mutex.WaitOne(0)
    } catch [Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }
    if (-not $ownsMutex) {
        Write-Host '项目正在启动，请稍候。'
        exit 0
    }

    foreach ($name in 'qwen.env', 'db-mcp.env') {
        if (-not (Test-Path -LiteralPath (Join-Path $runtime $name))) {
            throw "缺少后端配置 $name。初始化说明见 backend-deployment\README.md。"
        }
    }
    Write-Host '正在检查数据库、GraphRAG 和问答服务…'
    & (Join-Path $PSScriptRoot 'start_local.ps1') -DebugConsole -Restart:$RestartBackend
    if ($RestartBackend) {
        Write-Host '后端重启完成。可在原网页继续提问。'
        return
    }

    Write-Host '正在启动咨询网页…'
    $port = Start-Frontend
    $origin = "http://localhost:$port"
    $headers = @{
        Origin = $origin
        'Access-Control-Request-Method' = 'POST'
        'Access-Control-Request-Headers' = 'content-type'
    }
    try {
        $probe = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:15670/api/v1/chat/admission-react' -Method Options -Headers $headers -TimeoutSec 5
        if ($probe.Headers['Access-Control-Allow-Origin'] -ne $origin) { throw 'Origin not allowed' }
    } catch {
        throw "当前后端不允许从 $origin 发起问答。请关闭此前启动的 DB-GPT，再双击启动文件。"
    }

    $url = "$origin/#/pages/chat/index"
    Write-Host "启动完成。$url"
    Start-Process $url
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    if ($ownsMutex) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
