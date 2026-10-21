$ErrorActionPreference = 'Stop'
$runtimeRoot = Join-Path $env:LOCALAPPDATA 'RenPdf/native-embeddings'
uv venv --python 3.12 (Join-Path $runtimeRoot '.venv') --allow-existing
$nativePython = Join-Path $runtimeRoot '.venv/Scripts/python.exe'
uv pip install --python $nativePython 'torch==2.14.1+cpu' 'torchvision==0.29.1+cpu' --index-url https://download.pytorch.org/whl/cpu
if ($LASTEXITCODE -ne 0) { throw 'CPU Torch installation failed.' }
uv pip install --python $nativePython 'sentence-transformers==6.1.0' 'transformers==5.20.2' fastapi uvicorn pillow soundfile numpy av
if ($LASTEXITCODE -ne 0) { throw 'Native embedding dependencies failed.' }
& $nativePython -c "from huggingface_hub import snapshot_download; snapshot_download('google/embeddinggemma-2', revision='914f7f89142e33e77833254d9c9b90c3cef7303b', ignore_patterns=['*.gguf','*.onnx','onnx/*'])"
if ($LASTEXITCODE -ne 0) { throw 'Model download failed.' }
