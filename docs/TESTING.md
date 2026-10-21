# Pruebas

Desde backend: `uv run pytest -q`, `uv run ruff check app tests`,
`uv run ruff format app --check`, `uv run ty check app`.
La última ejecución completa aprobó 168 tests en 461,53 s, con dos warnings de
deprecación upstream. Incluye Docling nativo offline, geometría CropBox/rotación,
reutilización/reciclado/timeout del parser, prefijos EmbeddingGemma y búsqueda de
preguntas naturales/resúmenes con cobertura parcial.
Incluye Studio/Trazabilidad, Laboratorio/Estudio, telemetría real sin secretos,
consulta multimodal con revocación, preparación local automática del corpus completo,
reintentos/idempotencia y figuras recuperadas automáticamente con PNG reales y permisos.
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
La ejecución Chromium completa de la iteración anterior aprobó 18 tests,
incluyendo Gemini real, permisos, índices, citas, zoom/rotación y recarga; acceso
directo desde biblioteca, reapertura del chat, móvil y controles shadcn. Fallos
de assets controlados comprueban una sola recarga automática, sesión conservada
y recuperación a biblioteca. La captura original de Error/Oops no se reprodujo
con una sesión nueva; esas pruebas verifican el mecanismo de recuperación.

La nueva aceptación incorpora chat-continuity, módulos, aprendizaje y studio-preview.
El router TanStack controla la única recarga de recuperación; se retiró el segundo
listener de Vite. Una petición pendiente sobrevivió a sondeos, notas y páginas
1→2→1 sin recargas ni abortos, con borrador conservado, una descarga del PDF y máximo
dos lienzos. El primer índice conserva el borrador hasta READY y bloquea envíos prematuros.

Validación integrada actual: los 28 flujos Chromium están verificados. Con la
preferencia local activa, 26 pasaron en la suite completa; dos expectativas del
test todavía asumían estado EXTRACTED y etiqueta Fuente 1. Se corrigieron para
aceptar READY y una cita real de la página esperada; ambos casos se repitieron y
pasaron (3/3 incluyendo setup, 1,1 min). No requirió cambios en la aplicación.

`rag-complete-content-results.json` conserva la verificación HTTP real con un PDF
inventado de dos páginas: extracción e indexación local automática (18 chunks,
768 dimensiones), pregunta libre de importe/mes con siete citas y Gemini 3.8 Flash,
y recuperación visual automática con un PNG real, forma/color correctos y cita
de su figura. No se seleccionó la región manualmente ni se enviaron documentos privados.

`backfill-local-results.json` verifica 17 documentos existentes que no tenían
índice: 1.243 chunks y 1.243 vectores locales de 768 dimensiones, con SHA-256 de
originales y versiones preservados. No publica IDs ni contenido privado.

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

## Entrega de RAG visual y workspace — 20 de octubre de 2026

Verificación final: **157 tests backend aprobados** (355,16 s); Chromium:
**27 aprobados y uno opt-in cloud omitido** (3,6 min). Ruff, formato, ty,
TypeScript, Biome, generación del cliente y build de producción aprobados.

`test_rag_workspace.py` procesa PDFs inventados con una imagen rasterizada y un
dibujo vectorial, comprueba chunks/procedencias, filtro de página y PNG reales
entregados al chat. También verifica recuperación equilibrada frente a 40 chunks
de una fuente larga, exclusión de fuentes no seleccionadas y rechazo de acceso
ajeno a cobertura, chunks y contexto. Las pruebas mantenidas de continuidad
verifican cero recargas/abortos durante una respuesta, borrador conservado,
una descarga del PDF y un máximo de dos lienzos al cambiar de página.
La selección de fuentes también se conserva tras recargar el workspace.

La aceptación opt-in con Gemini real se ejecutó sobre PDFs inventados y pasó:
EmbeddingGemma 2 de texto + chat con visión (círculo rojo), Gemini Embedding 2
multimodal con 2/2 figuras indexadas (triángulo verde), comparación entre dos
fuentes (120/90 MWh, diferencia 30) y contexto/citas inspeccionables. Se repitieron
la consulta visual por página y la comparación sobre el backend final.
Resultados: [workspace-rag-results.json](workspace-rag-results.json).

Se inspeccionaron capturas de escritorio y móvil. Fuentes y notas tienen scroll
propio; chat y visor permanecen montados. La recuperación de una imagen continúa
limitada por el presupuesto visual de cada consulta, que la traza muestra.

## Audio, video y workspace compacto

La ampliación añade pruebas con FFmpeg real (WAV, MP3 y WebM sin duración),
reproducción Range, análisis por segmentos, permisos revocados entre envíos,
checkpoint/reintento, detección local de silencio y consultas temporales. Las
34 regresiones finales aprobadas también comprueban que página PDF y segundo de audio se
filtran por separado en una consulta mixta, y que el uso de un clip no se
atribuye al siguiente cuando el proveedor no lo reporta.

Chromium aprobó 30 casos mantenidos; el caso opt-in de comparación cloud sigue
omitido en la suite ordinaria. Se corrigió y repitió el caso que abría el visor al
entrar desde «Chatear». La versión compilada pasó cuatro comprobaciones
(autenticación, PDF desde biblioteca e inspección de consultas/segmentos RAG).

La aceptación real con material inventado aprobó: voz con presupuesto 731 USD
en 01:00–01:04, video azul/rojo con evidencia roja en 00:10–00:12, comparación de
ambas fuentes con citas y búsqueda híbrida con Gemini Embedding 2 nativo para
audio y video. Usó también el índice local de EmbeddingGemma para las preguntas
iniciales. Hubo fallos transitorios de conexión con checkpoint/reintento y se
seleccionó explícitamente el modelo estable configurado para embeddings.
Resultados y ubicaciones verificables: [media-rag-results.json](media-rag-results.json).
Procedimiento, alcance y precisión: [MEDIA_RAG.md](MEDIA_RAG.md).

## Excel, citas por celda y actualización general de interfaz

La suite completa de backend aprobó **177 pruebas** (447,08 s). Después del ajuste
de referencias múltiples y espacios escapados en citas del proveedor, las
**28 regresiones** de Excel y contratos del proveedor aprobaron (32,17 s). Ruff,
ty, TypeScript, Biome y build de producción aprobaron; sigue la advertencia
conocida del chunk PDF.js de 638 KB, cargado sólo al abrir el visor PDF.

La suite Chromium completa aprobó **32 casos y omitió uno opt-in cloud** (6,3 min).
Incluye subida simultánea de dos XLSX, selección de ambas fuentes al preguntar,
grid paginado, navegación por hojas, valor/formula/caché, citas y enlaces a celda,
chat/borrador persistentes, móvil y filtros de hoja/celda en Trazabilidad → RAG.
También se revisaron capturas de login, biblioteca, workspaces, Excel y móvil.

La aceptación con proveedores reales usó dos libros y un PDF inventados:
consulta exacta B2, comparación entre hojas 120/90 (diferencia 30), comparación
entre libros y PDF 120/90/70/80, fórmula con resultado guardado 210, fórmula sin
resultado disponible y búsqueda híbrida con Gemini Embedding 2. Las consultas
iniciales usaron el índice local de EmbeddingGemma. La prueba detectó y corrigió
una cita con espacios TeX dentro de una expresión; se conserva la comprobación
de referencias permitidas y se normaliza únicamente ese espacio.
Resultados: [spreadsheet-rag-results.json](spreadsheet-rag-results.json).
Alcance y ejecución: [SPREADSHEET_RAG.md](SPREADSHEET_RAG.md).

La copia compilada estable en localhost:5173 aprobó ocho comprobaciones de
autenticación/recuperación, Excel y módulo RAG. Tras reconstruir y arrancar
backend, worker y scheduler, la comprobación directa de API confirmó las tres
hojas, resultado guardado 210, fórmula sin caché nula, seis contextos de respuesta,
dos libros y PDF, MIME del original y reproducción Range de audio/video existentes.
Resultados: [spreadsheet-deployment-results.json](spreadsheet-deployment-results.json).
La misma batería sobre la aplicación servida por Docker en localhost:8000 aprobó
sus ocho comprobaciones (1,5 min), incluida la subida simultánea de dos libros.

## Apertura de workspaces después de actualizar

Ante un reporte de pantalla de recuperación en Brave, la inspección encontró el
workspace ya abierto y permitió navegar a los de Excel y PDF en la misma pestaña.
No se conservó el error inicial de la aplicación, por lo que no se atribuye una
causa definitiva a esa incidencia. La comprobación automática abrió los veinte
workspaces existentes sin errores JavaScript.

Se encontró y corrigió un problema de entrega: el HTML de la aplicación no tenía
una política explícita de caché y admitía respuestas condicionales 304. Ahora las
navegaciones reciben HTML fresco con `Cache-Control: no-store`; los chunks
ausentes tampoco se cachean. Los assets presentes conservan su revalidación.
Dos pruebas HTTP verifican estos casos, las rutas internas de workspace y que
los errores de API continúan devolviendo JSON.
Después del despliegue se volvieron a abrir los veinte workspaces; la suite de
recuperación aprobó cuatro comprobaciones en Chromium (12,7 s). El servidor
confirmó HTML condicional 200 con `no-store`, assets vigentes 200 y chunks
ausentes 404 con `no-store`. La pestaña original de Brave mostró de nuevo el
chat y sus fuentes después de cargar la versión actual.

## Embeddings nativos y reutilización de índices

La validación del 20 de octubre de 2026 aprobó 38 pruebas de backend en
`test_native_media.py`, `test_automatic_local_index.py` y
`test_provider_contracts.py`. Cubren indexación sin transcripción, carga local
automática, imágenes PDF por defecto, permisos Gemini separados, referencias
temporales, activación atómica, reintento, reutilización de clips/vectores,
respuesta y resumen con clips adjuntos, y rechazo de un índice textual de
referencias sin transcripción. Ruff, ty y el build TypeScript/Vite aprobaron.

Chromium sobre la entrega de producción en 5173 aprobó seis casos, incluidos
los dos proveedores audiovisuales, el módulo RAG, PDF con imágenes local y el
rechazo real por permisos. Las pruebas de continuidad conservaron el borrador,
la respuesta en streaming y el visor durante la navegación entre páginas.

`native-media-results.json` conserva la aceptación real con datos inventados:
audio con presupuesto al minuto 1, video azul/rojo, preguntas conjuntas con
ambos proveedores y figura roja de PDF indexada automáticamente con el encoder
local. Sus respuestas citan intervalos o página/figura y la ejecución registra
los clips/píxeles realmente adjuntos. La prueba incluyó reintentos visibles de
fallos temporales de Gemini; no cambió de proveedor.

Reproducir después de arrancar el runtime nativo:

```powershell
uv run --package app python scripts/evaluate_native_media.py --cloud
uv run --package app python scripts/evaluate_native_pdf.py --cloud
```

Ambos comandos envían únicamente sus fixtures inventadas a Gemini. La primera
repetición de índices locales completos tardó 0,37 s para las dos fuentes de
prueba; volver desde Gemini al perfil local reutilizando clips y vectores tardó
4,27 s, incluyendo el sondeo de trabajos. Son mediciones de caché, no tiempos
de una primera indexación ni un benchmark general.

## Regresión de consultas audiovisuales y documentos en preparación

El 20 de octubre se reprodujo un corte `ReadError` al responder con varios
clips reales. El adaptador audiovisual usa respuesta completa y un único
reintento de transporte dentro del timeout. La pregunta general conjunta
respondió con citas de ambas fuentes; no se conserva su contenido privado en
este informe.

La regresión posterior aprobó **56 pruebas** en `test_provider_contracts.py`,
`test_native_media.py`, `test_rag_workspace.py`, `test_media_rag.py` y
`test_automatic_local_index.py`. Comprueban el transporte con cortes, errores
SDK sin filtración de mensajes, reparto del límite de clips, comparaciones
generales y consulta de texto ya extraído durante el primer índice semántico.
La recuperación sobre el workspace de tres PDFs incluyó evidencia de los tres;
el índice de su PDF de 223 páginas terminó correctamente.

La entrega desplegada completó nuevamente la pregunta conjunta sobre los dos
archivos del usuario en 5,68 s, con seis citas temporales y ambos formatos
representados. Dos consultas reales sobre los PDFs inventados (comparación
numérica y comparación general) citaron ambos documentos. El índice largo
terminó con 9.592/9.592 vectores; los medios originales conservaron 7/7 y 6/6
segmentos nativos. Repetir su preparación reutilizó los índices en 0,10 y
0,09 s. Son comprobaciones puntuales, no un benchmark de rendimiento general.

La comparación audiovisual general también se completó con Gemini 3.8 Flash
sobre audio/video inventados, con citas de ambos formatos. Chromium aprobó
nueve comprobaciones sobre el build desplegado: continuidad del chat/visor,
envío durante indexación, medios nativos, inspección RAG y apertura automática
de Privacidad cuando falta permiso. Esa apertura conserva la pregunta y no
crea autorizaciones automáticamente. La subida incluye `workspace_id` para
aplicar el routing del workspace antes de crear sus trabajos.

## Laboratorio y estudio con generación IA

La aceptación del 20 de octubre de 2026 aprobó **51 pruebas de backend** en
`test_learning.py`, `test_learning_generation.py`, `test_provider_contracts.py`,
`test_native_media.py` y `test_rag_workspace.py`. Cubren generación y guardado
de resúmenes, bancos de preguntas y mazos, repaso, referencias PDF/celda/minuto,
permisos, aislamiento y rechazo de resultados estructurados inválidos sin
guardar material parcial. Ruff, ty y el build TypeScript/Vite aprobaron.

Chromium sobre la entrega de producción aprobó ocho comprobaciones de
generación controlada, continuidad y uso manual; dos casos cloud se omitieron
en esa ejecución. Una ejecución posterior con Gemini real aprobó tres casos
(autenticación y dos flujos): generar preguntas y mazo, guardar las citas,
revelar una respuesta y registrar el repaso; comparar dos PDFs con citas de
ambos y guardar la respuesta existente como resumen.

`learning-ai-results.json` conserva la aceptación API con datos inventados:
resumen, banco de cuatro preguntas y mazo de tres fichas con Gemini, junto
con una comprobación audiovisual cuyo presupuesto cita el audio desde 01:00.
Los clips nativos se acompañan de su identificador y tiempo original para
que el modelo pueda atribuir cada dato a su intervalo. Son comprobaciones
puntuales de procedencia y funcionamiento, no una garantía de exactitud
factual de cualquier material generado. La interfaz indica cobertura parcial
y permite abrir las fuentes y la ejecución para revisar el resultado.

La entrega comprobada sirve el mismo build en 8000 y 5173; las rutas de
Laboratorio y Estudio responden correctamente.
