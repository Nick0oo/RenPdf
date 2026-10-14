# RenPdf

ChatPDF personal y autohospedado sobre el Full Stack FastAPI Template oficial.
PDFs persistentes, workspaces, extracción por páginas, OCR, pgvector + búsqueda
bilingüe, chat con Gemini u Ollama, citas verificadas y visor PDF.js con regiones reales.

La aplicación funciona sin inferencia cloud: login, biblioteca, lectura y
extracción local permanecen disponibles. No se envían documentos a un proveedor
hasta autorizar su propósito. Las API keys se configuran sólo en el servidor.

## Inicio

Requisitos: Docker Desktop/WSL2, Python 3.14 + uv, Node 24 + npm.

```powershell
uv sync --package app
uv run --package app python scripts/init_env.py
docker compose up -d db redis
uv run --package app python scripts/configure_local.py
docker compose up -d --build backend worker scheduler
```

Abre [RenPdf](http://localhost:8000). La cuenta y su contraseña están en el `.env`
local: FIRST_SUPERUSER y FIRST_SUPERUSER_PASSWORD. No están en documentación ni
código. En este entorno ya se prepararon las bases dedicadas y los servicios.

Para desarrollo del frontend: `npm ci --ignore-scripts` y `npm run dev`, en la raíz.
Hot reload en [localhost:5173](http://localhost:5173). API Swagger en
[localhost:8000/docs](http://localhost:8000/docs).

## Flujo de investigación

1. Importa un PDF. Su archivo se guarda y el worker extrae contenido sin usar LLM.
2. Pulsa **Chatear con PDF** para abrir su conversación; puedes añadir más fuentes.
3. En Modelos selecciona chat, embeddings, visión, preguntas y resumen.
4. Si usas nube, en Fuentes y permisos autoriza cada propósito para ese proveedor.
5. Crea el índice para búsqueda semántica y espera su estado persistido. Puedes
   consultar texto extraído antes con búsqueda léxica; un índice incompleto nunca se activa.
6. Pregunta, abre las citas, inspecciona regiones, toma notas o exporta la conversación.

Ollama y llama.cpp son opcionales, con endpoints en el entorno. La app no descarga
modelos automáticamente. En este equipo se instaló llama.cpp CPU con EmbeddingGemma 2
de texto (~310 MB) y se comprobó chat con Gemma4 ya existente. Para reproducir la
instalación manual: `uv run --package app python scripts/install_llamacpp.py` y
`./scripts/start_llamacpp.ps1`. Véase [despliegue](docs/DEPLOYMENT.md).
Gemini reconoce GEMINI_API_KEY, GOOGLE_API_KEY y GOOGLE_GENERATIVE_AI_API_KEY.
El modelo se elige del catálogo real; la existencia de un catálogo no verifica
inferencia. Embeddings iniciales: 768 dimensiones, perfiles aislados por versión.
Para imágenes, Gemini Embedding 2 exige una autorización multimodal adicional.

## Verificación

```powershell
# Desde backend/
uv run pytest -q
uv run ruff check app tests
uv run ruff format app --check
uv run ty check app

# Desde la raíz
npm run lint
npm run build
npm run generate-client
npm audit

# Desde frontend/, con API y frontend activos
../node_modules/.bin/playwright.cmd test --reporter=line
```

El conftest impide usar una base personal para la limpieza de tests. La suite
Playwright mantenida cubre el producto personal; tests del template para registro
público/admin/items/email se conservan como referencia y no son su aceptación.
RUN_CLOUD_E2E=1 habilita inferencia sólo para el fixture sintético del E2E.

Evaluación opt-in: `uv run --package app python scripts/evaluate_rag.py --cloud --vision`.
Usa únicamente fixtures públicos sintéticos y registra sus consentimientos.
Resultados en [evaluation-results.json](docs/evaluation-results.json).
Prueba de reinicio en [restart-results.json](docs/restart-results.json).
Evaluación totalmente local: `uv run --package app python scripts/evaluate_local.py`;
[resultado](docs/local-evaluation-results.json) con Docling, pgvector y chat CPU reales.

## Documentación

[Arquitectura](docs/ARCHITECTURE.md) · [Auditoría](docs/ENVIRONMENT_AUDIT.md) ·
[Datos](docs/DATA_MODEL.md) · [API](docs/API.md) · [RAG](docs/RAG_PIPELINE.md) ·
[Proveedores](docs/MODEL_PROVIDERS.md) · [Citas](docs/CITATION_SYSTEM.md) ·
[Seguridad](docs/SECURITY.md) · [Pruebas](docs/TESTING.md) ·
[Despliegue](docs/DEPLOYMENT.md) · [ADR](docs/DECISIONS.md) ·
[Limitaciones](docs/KNOWN_LIMITATIONS.md) · [Matriz por fases](docs/IMPLEMENTATION_REPORT.md) ·
[Auditoría de diseño](docs/DESIGN_AUDIT.md).

Docling nativo y HybridChunker funcionan sin descargar modelos ni tokenizers.
La extracción avanzada con layout neuronal sigue pendiente de artefactos locales.
Los resúmenes generales avisan que usan una muestra de páginas; no se declara
cobertura universal de PDFs de 500 páginas ni visión local verificada.

[Template oficial](https://github.com/fastapi/full-stack-fastapi-template), base
372dbcb; adaptación inicial 1c32e668065d7e5490263d90e75eb4b7cdb9fcba. Licencia [MIT](LICENSE).
