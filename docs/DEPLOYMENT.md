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

Aplicación compilada: http://localhost:8000. Desarrollo frontend con hot reload:
`npm ci --ignore-scripts` y `npm run dev`; abrir http://localhost:5173.
API nativa alternativa: desde backend `uv run python -m app.bootstrap`,
`uv run fastapi dev --host 127.0.0.1`. No arrancar API nativa y contenedor API en
el mismo puerto. Worker Windows: `uv run celery -A app.workers.celery_app:celery_app worker --pool=solo --concurrency=1`.

Para producción se usa `docker compose -f compose.yml up -d --build`; omite el
override/hot reload y no publica DB/Redis. API conserva loopback para un reverse
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

Docling opcional: `uv sync --package app --extra docling`. Instalar artefactos de
layout/OCR manualmente, indicar DOCLING_ARTIFACTS_PATH y elegir parser docling.
HybridChunker requiere DOCLING_TOKENIZER_PATH con un tokenizer local. El límite
PARSER_MEMORY_LIMIT_MB debe ajustarse si esos artefactos necesitan más espacio virtual.
No se descarga ningún peso desde la aplicación; HF_HUB_OFFLINE y
TRANSFORMERS_OFFLINE se activan en la ruta Docling. La imagen ligera incluye
Tesseract eng/spa, no Torch/Docling ni modelos generativos.
