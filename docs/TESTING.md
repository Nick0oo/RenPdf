# Pruebas

Desde backend: `uv run pytest -q`, `uv run ruff check app tests`,
`uv run ruff format app --check`, `uv run ty check app`.
La última ejecución confirmada aprobó 94 tests, con dos warnings de deprecación upstream.
El conftest dirige todas las pruebas a `renpdf_chat_test` y storage temporal;
ejecuta Alembic antes de iniciar. Nunca usa la base personal para teardown.

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

E2E: en frontend `npm run test -- tests/login.spec.ts tests/research.spec.ts --reporter=line`.
En PowerShell puede usarse `../node_modules/.bin/playwright.cmd` para preservar
los argumentos. `RUN_CLOUD_E2E=1` autoriza Gemini sólo sobre el fixture sintético
creado por esa prueba, durante un día. Sin el flag se verifica el rechazo cloud.
Playwright guarda screenshots/traces locales; no activa analítica externa.

Evaluación real: `uv run --package app python scripts/evaluate_rag.py --cloud --vision`.
Sin --cloud sólo recupera localmente. Guarda configuración y métricas en
`docs/evaluation-results.json`; conserva workspace sintético para inspección.
Recall/MRR miden recuperación por página esperada; no son una evaluación humana
exhaustiva del LLM. Los tiempos medidos incluyen polling y condiciones de este equipo.
