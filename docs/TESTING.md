# Pruebas

Desde backend: `uv run pytest -q`, `uv run ruff check app tests`,
`uv run ruff format app --check`, `uv run ty check app`.
La última ejecución completa aprobó 115 tests en 241,32 s, con dos warnings de
deprecación upstream. Incluye Docling nativo offline, geometría CropBox/rotación,
reutilización/reciclado/timeout del parser, prefijos EmbeddingGemma y búsqueda de
preguntas naturales/resúmenes con cobertura parcial.
El conftest dirige todas las pruebas a `renpdf_chat_test` y storage temporal;
ejecuta Alembic antes de iniciar. Nunca usa la base personal para teardown.

Se comprobó también un volumen PostgreSQL nuevo y aislado: el script de inicio
creó `renpdf_chat`, el rol `renpdf_app`, su acceso por contraseña y pgvector.
El contenedor temporal se eliminó al terminar; los volúmenes personales se conservaron.

Desde raíz: `npm ci --ignore-scripts`, `npm run lint`, `npm run build`,
`npm run generate-client`. El lockfile contiene bindings Windows/Linux;
`bun.lock` preserva la referencia original, pero npm es el gestor documentado.
Biome y TypeScript verifican el frontend. El checker mantenido es ty; Mypy
estricto del template requiere completar anotaciones/stubs y no es el criterio
activo. No se afirma que ambos checkers hayan pasado.

Fixtures: `uv run --package app python scripts/generate_fixtures.py`. Cuatro PDFs
sintéticos con español/inglés, contradicción 120/90 MWh, tabla 120/80/200,
imagen triángulo verde, fórmula, instrucción maliciosa, escaneo y CropBox/rotación.
`backend/tests/fixtures/expected.json` fija respuestas y páginas; no hay datos privados.
La tabla/imagen se revisó en el rendering generado.

Contratos usan doubles sólo dentro de tests. Integración utiliza PostgreSQL real,
Alembic y vector, almacenamiento real, PyMuPDF, chunks, referencias, chat persistente
con proveedor controlado y cambios de perfil. Se comprueban rechazos cloud antes
de llamadas, cuotas, cardinalidad, dimensiones, aislamiento y ausencia de evidencia.

E2E: en frontend `npm run test -- --reporter=line`.
En PowerShell puede usarse `../node_modules/.bin/playwright.cmd` para preservar
los argumentos. `RUN_CLOUD_E2E=1` autoriza Gemini sólo sobre el fixture sintético
creado por esa prueba, durante un día. Sin el flag se verifica el rechazo cloud.
Playwright guarda screenshots/traces locales; no activa analítica externa.
La ejecución Chromium completa contra la imagen compilada actual aprobó 18 tests,
incluyendo Gemini real, permisos, índices, citas, zoom/rotación y recarga; acceso
directo desde biblioteca, reapertura del chat, móvil y controles shadcn. Fallos
de assets controlados comprueban una sola recarga automática, sesión conservada
y recuperación a biblioteca. La captura original de Error/Oops no se reprodujo
con una sesión nueva; esas pruebas verifican el mecanismo de recuperación.

Una muestra puntual de `docker stats` durante la evaluación sintética registró
458 MiB para API, 305 MiB para worker, 245 MiB para scheduler, 64 MiB para
PostgreSQL y 10 MiB para Redis. No incluye Docker Desktop ni el sistema operativo
y no representa el pico de memoria ni un benchmark de PDFs grandes.

Evaluación real: `uv run --package app python scripts/evaluate_rag.py --cloud --vision`.
Sin --cloud sólo recupera localmente. Guarda configuración y métricas en
`docs/evaluation-results.json`; conserva workspace sintético para inspección.
Recall/MRR miden recuperación por página esperada; no son una evaluación humana
exhaustiva del LLM. Los tiempos medidos incluyen polling y condiciones de este equipo.

Evaluación CPU: `uv run --package app python scripts/evaluate_local.py`.
Usa sólo un fixture público sintético, sin grants cloud. Verifica Docling Native
2.139.0/HybridChunker, hash del original, 16 chunks y 16 vectores reales 768 en
pgvector, perfil llama.cpp/EmbeddingGemma 2, recuperación hybrid y respuesta
Gemma4 con valor esperado y cita persistida. Guarda local-evaluation-results.json.
El instalador llama.cpp se repitió con el servidor activo: hashes idénticos
conservan binarios/DLLs en uso y no vuelven a descargar los pesos.
