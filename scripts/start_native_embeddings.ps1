$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'RenPdf/native-embeddings'
$nativePython = Join-Path $runtimeRoot '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $nativePython)) { throw 'Run install_native_embeddings.ps1 first.' }
if (Get-NetTCPConnection -LocalPort 8082 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8082 is already in use; existing process preserved.' }
$repoRoot = Split-Path -Parent $PSScriptRoot
$process = Start-Process -FilePath $nativePython -ArgumentList @('-m', 'uvicorn', 'scripts.native_embedding_server:app', '--host', '127.0.0.1', '--port', '8082', '--workers', '1') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeRoot 'server.out.log') -RedirectStandardError (Join-Path $runtimeRoot 'server.err.log')
$process.Id | Set-Content -LiteralPath (Join-Path $runtimeRoot 'server.pid')
Write-Output "EmbeddingGemma 2 native CPU runtime starting on loopback:8082, PID $($process.Id)."
