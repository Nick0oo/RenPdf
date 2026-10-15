# Instalación y despliegue

Python 3.14, uv, Node 24/npm y Docker Desktop con WSL2. En una instalación nueva:

```powershell
uv sync --package app
uv run --package app python scripts/init_env.py
docker compose up -d db redis
uv run --package app python scripts/configure_local.py
docker compose up -d --build backend worker scheduler
```

`init_env.py` crea secretos locales sin imprimirlos. Revisar FIRST_SUPERUSER en
.env y usar FIRST_SUPERUSER_PASSWORD para login. `configure_local.py` prepara sólo
las dos bases dedicadas de Docker, crea un rol propio, instala vector desde el
usuario administrativo y guarda backup local de la configuración previa. No
regenera ni cambia passwords de un volumen PostgreSQL existente.

Aplicación compilada estable: http://localhost:8000, con `fastapi run`.
Desarrollo frontend con hot reload: `npm ci --ignore-scripts` y `npm run dev`;
abrir http://localhost:5174. Guardar código puede recargar esa página e interrumpir
su conexión SSE. Para probar en 5173 sin HMR: `npm run build` y
`./scripts/serve_preview.ps1`. El script conserva assets anteriores y actualiza
la copia sin reiniciar el servidor de preview.
API nativa alternativa: desde backend `uv run python -m app.bootstrap`,
`uv run fastapi dev --host 127.0.0.1`. No arrancar API nativa y contenedor API en
el mismo puerto. Worker Windows: `uv run celery -A app.workers.celery_app:celery_app worker --pool=solo --concurrency=1`.

El backend con recarga automática es opt-in:
`docker compose -f compose.yml -f compose.override.yml -f compose.dev.yml up --watch`.
La ejecución habitual no activa esa recarga.

Para producción se usa `docker compose -f compose.yml up -d --build`; omite el
override de puertos locales y no publica DB/Redis. API conserva loopback para un reverse
proxy TLS del host. Configurar FRONTEND_HOST y COOKIE_SECURE=true para HTTPS.
No hay un proxy externo impuesto ni puertos de administración abiertos.

Volúmenes: `app-db-data` conserva PostgreSQL; Redis usa AOF; documentos en ./storage.
No borrar estos directorios al reiniciar. Backups deben incluir DB y storage de
manera consistente y cifrada cuando contengan información privada. El contenedor
ejecuta API/worker con usuario no-root; en VPS Linux preparar permisos de ./storage
para el UID del contenedor antes de montar el directorio.

Windows/WSL/contenedor son namespaces distintos. Dentro de Docker, localhost no
es Windows: OLLAMA usa host.docker.internal; fuera usa localhost:11434. Para
llama.cpp en el host configurar DOCKER_LLAMACPP_BASE_URL. No hay IP LAN fija.
WSL2/Docker deben estar activos; ejecutar `docker compose config --quiet`,
`docker compose ps`, logs acotados y diagnóstico desde Modelos antes de reindexar.
No imprimir `docker compose config` sin --quiet: el resultado contiene secretos.

La instalación base incluye `docling-slim` y el pipeline nativo sin modelos.
`PARSER_ENGINE=auto` lo utiliza cuando no hay un pipeline avanzado configurado;
`docling-native` lo selecciona explícitamente y `pymupdf` conserva el modo anterior.
El parser reutiliza su subprocess por hasta PARSER_RECYCLE_PAGES (8 por defecto),
con timeout por página y límite de memoria en Linux; después lo recicla.

Docling avanzado opcional: `uv sync --package app --extra docling`. Instalar artefactos de
layout/OCR manualmente, indicar DOCLING_ARTIFACTS_PATH y elegir parser docling.
HybridChunker funciona con presupuesto de bytes UTF-8 sin descargas. Para medir
tokens de un modelo específico, DOCLING_TOKENIZER_PATH acepta un tokenizer local. El límite
PARSER_MEMORY_LIMIT_MB debe ajustarse si esos artefactos necesitan más espacio virtual.
No se descarga ningún peso desde la aplicación; HF_HUB_OFFLINE y
TRANSFORMERS_OFFLINE se activan en la ruta Docling. La imagen ligera incluye
Tesseract eng/spa y Docling nativo, no Torch ni modelos generativos.

Runtime local Windows x64, instalación manual explícita:

```powershell
uv run --package app python scripts/install_llamacpp.py
./scripts/start_llamacpp.ps1
```

Instala CPU llama.cpp b11624 y EmbeddingGemma 2 Q8_0 de texto (~310 MB), verificando
SHA-256 de los binarios y pesos. Quedan en `%LOCALAPPDATA%/RenPdf/llama.cpp`, fuera
del repositorio. No instala CUDA ni las torres de visión/audio. El server escucha
loopback 8081; no ocupa el 8080 preexistente. Tras reiniciar Windows, arrancarlo
con el segundo comando antes de indexar. Configuración del entorno actual:
LLAMACPP_BASE_URL=http://127.0.0.1:8081,
DOCKER_LLAMACPP_BASE_URL=http://host.docker.internal:8081,
LLAMACPP_MODE=embeddings y LLAMACPP_MODEL_VERSION=SHA256 del GGUF instalado.
Seleccionar `llamacpp / embeddinggemma-2-q8_0` para embeddings (768 dimensiones).
El modo embeddings no se anuncia como chat. Para chat local se usa el modelo
Ollama ya instalado; OLLAMA_NUM_CTX=4096, OLLAMA_NUM_THREADS=2 y OLLAMA_NUM_GPU=0.
