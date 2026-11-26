param([switch]$DebugConsole, [switch]$Restart)

$ErrorActionPreference = 'Stop'
$packageRoot = Split-Path -Parent $PSScriptRoot
$workspace = Split-Path -Parent $packageRoot
$dbgptRoot = Join-Path $workspace 'vendor/DB-GPT'
$runtime = Join-Path $packageRoot '.runtime'
$pgData = Join-Path $runtime 'postgres'
$python = Join-Path $dbgptRoot '.venv/Scripts/python.exe'

function Import-LocalEnvironment([string]$Path) {
    foreach ($line in [IO.File]::ReadLines($Path)) {
        if ($line -match '^([A-Z_]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
}

function Test-LocalPort([int]$Port) {
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $client.Connect('127.0.0.1', $Port)
        return $true
    } catch [Net.Sockets.SocketException] {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Start-LocalServer(
    [string]$Name,
    [string]$Executable,
    [string[]]$ServerArgs,
    [string]$Directory,
    [int]$Port
) {
    if (Test-LocalPort $Port) { return }
    $errorLog = Join-Path $runtime "$Name.err.log"
    $process = Start-Process -FilePath $Executable -ArgumentList $ServerArgs `
        -WorkingDirectory $Directory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtime "$Name.out.log") `
        -RedirectStandardError $errorLog
    $deadline = (Get-Date).AddMinutes(3)
    while ((Get-Date) -lt $deadline) {
        if ($process.HasExited) { throw "$Name 启动失败。日志 $errorLog" }
        if (Test-LocalPort $Port) { return }
        Start-Sleep -Seconds 1
    }
    throw "$Name 启动超时。日志 $errorLog"
}

function Stop-ProjectDbGpt {
    $dbgptExe = Join-Path $dbgptRoot '.venv\Scripts\dbgpt.exe'
    $commandPattern = '(?:^|\s)"?' + [regex]::Escape($dbgptExe) +
        '"?\s+start\s+webserver\s+--config\s+"?configs[/\\]whu-qwen\.toml"?(?:\s|$)'
    $projectProcesses = @(Get-CimInstance Win32_Process -Filter "Name='dbgpt.exe' OR Name='python.exe'" |
        Where-Object { $_.CommandLine -match $commandPattern })
    $projectIds = @($projectProcesses | ForEach-Object { $_.ProcessId })
    $listeners = @(Get-NetTCPConnection -LocalPort 15670 -State Listen -ErrorAction SilentlyContinue)
    if (($listeners | Where-Object { $_.OwningProcess -notin $projectIds }) -or
        ($listeners.Count -eq 0 -and (Test-LocalPort 15670))) {
        throw '15670 端口被其他进程占用，无法重启本项目的 DB-GPT。'
    }

    foreach ($root in ($projectProcesses | Where-Object { $_.ParentProcessId -notin $projectIds })) {
        $current = Get-CimInstance Win32_Process -Filter "ProcessId=$($root.ProcessId)"
        if (-not $current -or $current.CreationDate -ne $root.CreationDate -or
            $current.CommandLine -notmatch $commandPattern) { continue }

        # The DB-GPT launcher owns its Python server and model worker processes.
        & taskkill.exe /PID $root.ProcessId /T /F | Out-Host
        if ($LASTEXITCODE -ne 0 -and (Get-Process -Id $root.ProcessId -ErrorAction SilentlyContinue)) {
            throw '关闭本项目的 DB-GPT 进程失败。'
        }
    }

    $deadline = (Get-Date).AddSeconds(15)
    while (Test-LocalPort 15670) {
        if ((Get-Date) -ge $deadline) { throw 'DB-GPT 未及时释放 15670 端口。' }
        Start-Sleep -Milliseconds 300
    }
}

if (Test-Path (Join-Path $pgData 'PG_VERSION')) {
    $pgCtl = (Get-Command pg_ctl.exe -ErrorAction Stop).Source
    & $pgCtl status -D $pgData | Out-Null
    if ($LASTEXITCODE -ne 0) {
        & $pgCtl start -D $pgData -l (Join-Path $runtime 'postgres.log') -w
        if ($LASTEXITCODE -ne 0) { throw '招生数据库启动失败。' }
    }
}

$env:PYTHONUTF8 = '1'
Import-LocalEnvironment (Join-Path $runtime 'db-mcp.env')
Start-LocalServer -Name 'mcp' -Executable $python `
    -ServerArgs @('mcp/db_mcp_server.py') -Directory $packageRoot -Port 8765

Import-LocalEnvironment (Join-Path $runtime 'qwen.env')
$env:ENCRYPT_KEY = $env:WHU_DBGPT_ENCRYPT_KEY
$env:DBGPT_HOME = Join-Path $runtime 'dbgpt-home'
$graphRoot = Join-Path $workspace 'graphrag'
$env:WHU_DATA = Join-Path $graphRoot 'data'
$env:WHU_EMBED_MODEL = Join-Path $dbgptRoot 'models/bge-small-zh-v1.5'
$env:WHU_LLM = $env:WHU_QWEN_API_BASE.TrimEnd('/') + '/chat/completions'
$env:WHU_LLM_MODEL = 'qwen3.8-flash-next'
$env:WHU_LLM_VERIFY_SSL = 'false'
$env:WHU_LLM_API_KEY = $env:WHU_QWEN_API_KEY
if ($DebugConsole) { $env:WHU_REACT_DEBUG = '1' }
$env:WHU_HOST = '127.0.0.1'
$env:WHU_GRAPH_RETRIEVE_URL = 'http://127.0.0.1:8090/api/retrieve'
Start-LocalServer -Name 'graphrag' -Executable $python `
    -ServerArgs @('app/app.py') -Directory $graphRoot -Port 8090
if ((Invoke-RestMethod -Uri 'http://127.0.0.1:8090/api/stats' -TimeoutSec 10).chunks -le 0) {
    throw 'GraphRAG 索引尚未建立。'
}
if ($Restart) {
    $route = Join-Path $dbgptRoot 'packages/dbgpt-app/src/dbgpt_app/openapi/api_v1/whu_react.py'
    & $python -m py_compile $route
    if ($LASTEXITCODE -ne 0) { throw '后端代码有语法错误，请修正后再重启。' }
    Write-Host '正在重启本项目的 DB-GPT…'
    Stop-ProjectDbGpt
}
Start-LocalServer -Name 'dbgpt' -Executable (Join-Path $dbgptRoot '.venv/Scripts/dbgpt.exe') `
    -ServerArgs @('start', 'webserver', '--config', 'configs/whu-qwen.toml') -Directory $dbgptRoot -Port 15670

if ((Invoke-RestMethod -Uri 'http://127.0.0.1:15670/api/v1/test' -TimeoutSec 10) -ne 'service status is UP') {
    throw 'DB-GPT 服务状态检查未通过。'
}

$embeddingProbe = @{ model = 'BAAI/bge-small-zh-v1.5'; input = @('readiness') } | ConvertTo-Json -Compress
$embeddingReady = $false
$deadline = (Get-Date).AddMinutes(1)
while (-not $embeddingReady -and (Get-Date) -lt $deadline) {
    try {
        $vectors = Invoke-RestMethod -Uri 'http://127.0.0.1:15670/api/worker/embeddings' `
            -Method Post -ContentType 'application/json' -Body $embeddingProbe -TimeoutSec 5
        $embeddingReady = $vectors[0].Count -gt 0
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $embeddingReady) { throw '政策检索模型尚未就绪。' }

& $python (Join-Path $PSScriptRoot 'configure_dbgpt.py')
if ($LASTEXITCODE -ne 0) { throw '招生数据源配置失败。' }

Write-Output '后端地址 http://127.0.0.1:15670'
