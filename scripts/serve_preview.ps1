param([int]$Port = 5173)
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$compiledRoot = Join-Path $repoRoot 'backend/app/frontend'
$previewRoot = Join-Path $repoRoot 'tmp/stable-preview'
if (-not (Test-Path -LiteralPath (Join-Path $compiledRoot 'index.html'))) {
    throw 'Primero ejecuta npm run build en la raiz del proyecto.'
}
New-Item -ItemType Directory -Force -Path $previewRoot | Out-Null
# Keep previous hashed assets so an already-open tab can still load its modules.
Get-ChildItem -LiteralPath $compiledRoot | Copy-Item -Destination $previewRoot -Recurse -Force

$viteCli = Join-Path $repoRoot 'node_modules/vite/bin/vite.js'
$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $running = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if (-not ($running.Name -eq 'node.exe' -and $running.CommandLine.Contains($viteCli.Replace('/', '\')) -and $running.CommandLine.Contains('preview') -and $running.CommandLine.Contains('stable-preview'))) {
        throw "El puerto $Port pertenece a otro proceso. Usa localhost:8000 o elige otro -Port."
    }
    Write-Output "Preview actualizado sin reiniciar: http://localhost:$Port"
    exit 0
}
$nodeRuntime = (Get-Command node).Source
$task = Start-Process -FilePath $nodeRuntime -ArgumentList @(
    ('"' + $viteCli + '"'), 'preview', '--host', '127.0.0.1', '--port', "$Port",
    '--strictPort', '--outDir', ('"' + $previewRoot + '"')
) -WorkingDirectory (Join-Path $repoRoot 'frontend') -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $repoRoot 'tmp/preview.stdout.log') `
  -RedirectStandardError (Join-Path $repoRoot 'tmp/preview.stderr.log')
Write-Output "Preview estable PID $($task.Id): http://localhost:$Port"
