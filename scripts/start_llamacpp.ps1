$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'RenPdf\llama.cpp'
$runtimeSettings = Get-Content -LiteralPath (Join-Path $runtimeRoot 'runtime.json') -Raw | ConvertFrom-Json
$listener = Get-NetTCPConnection -LocalPort $runtimeSettings.port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw 'The local runtime port is already in use. Existing processes were preserved.' }
$arguments = @('-m', ('"' + $runtimeSettings.model + '"'), '--alias', $runtimeSettings.alias, '--host', '127.0.0.1', '--port', $runtimeSettings.port, '--embedding', '--pooling', 'mean', '-c', '2048', '-b', '2048', '-ub', '2048', '-t', '2', '-ngl', '0', '--parallel', '1', '--log-verbosity', '0')
$process = Start-Process -FilePath $runtimeSettings.server -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'server.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'server.err.log')
$process.Id | Set-Content -LiteralPath (Join-Path $runtimeRoot 'server.pid')
Write-Output "llama.cpp CPU started on loopback port $($runtimeSettings.port), PID $($process.Id)."
