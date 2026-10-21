# API

Swagger en `/docs`; contrato en `/api/v1/openapi.json`. Cliente TypeScript:
`npm run generate-client`. Se mantiene el generador del template.

| Grupo | Operaciones |
|---|---|
| `/login/access-token`, `/login/logout` | Login con cookie HttpOnly y cierre de sesión |
| `/users/me` | Perfil y contraseña de la cuenta |
| `/documents/` | Carga multipart real, biblioteca y búsqueda por título |
| `/documents/{id}` | Metadata pública, renombrar y eliminar |
| `/documents/{id}/file`, `/thumbnail` | Original y miniatura autenticados |
| `/documents/{id}/pages/{n}/elements` | Elementos, tablas y coordenadas de una versión |
| `/documents/{id}/elements/{element}/image` | Rendering acotado de una región |
| `/documents/{id}/process`, `/index` | Trabajos persistentes de extracción/reindexación |
| `/documents/{id}/index-local` | Preparación local idempotente del índice según política configurada; nunca cambia a nube |
| `/documents/{id}/jobs` | Progreso, errores, cancelación y reintento |
| `/documents/{id}/consents` | Autorizar/listar/revocar cada alcance cloud |
| `/documents/{id}/enrichment` | Preguntas y resumen, generación asíncrona explícita |
| `/workspaces/` | CRUD de colecciones personales |
| `/workspaces/{id}/documents` | Añadir/quitar/listar fuentes |
| `/workspaces/{id}/search` | Recuperación filtrada, con evidencias reales |
| `/workspaces/{id}/annotations` | Notas, subrayados geométricos y marcadores |
| `/workspaces/{id}/conversations` | Conversaciones persistentes |
| `/conversations/{id}/model`, `/messages` | Selección de modelo, historial y chat SSE |
| `/conversations/{id}/messages/{message}/cancel` | Cancelación de generación |
| `/conversations/{id}/export` | Exportación Markdown o JSON con fuentes |
| `/providers/`, `/providers/routing`, `/providers/diagnostics` | Catálogos reales, preferencias y diagnóstico local |
| `/trace/overview`, `/trace/activity` | Recuentos, actividad filtrada y paginación del propietario |
| `/trace/responses/{id}`, `/trace/documents/{id}`, `/trace/permissions` | Ejecución persistida, versiones/índices/linaje y permisos |
| `/studio/operations` | Crear copias combinadas/organizadas/rotadas/recortadas y listar historial |
| `/studio/documents/{id}/pages/{n}/preview` | PNG de página original, con autenticación y control de propietario |
| `/learning/research` | Preguntas, comparaciones e informes con respuestas citadas |
| `/learning/decks`, `/learning/cards`, `/learning/reviews`, `/learning/progress` | Mazos, fichas con fuente, repasos y autoevaluación |

SSE usa `start`, `token`, `done`, `error`. Los tokens son provisionales; `done`
se emite después de validar fuentes y confirmar la transacción. No se presentan
citas inválidas como enlaces. Cancelar cierra el stream y registra su estado.

Una respuesta 200 a una carga confirma el archivo y su fila, no el trabajo ni
el índice. Un job aceptado sigue QUEUED hasta que el worker lo ejecuta. Si falta
Redis, la fila sobrevive y el dispatcher vuelve a enviarla al recuperarse.
Los errores de proveedor contienen códigos sanitizados, nunca su respuesta raw.

Los contratos completos de los módulos están en MODULES_STUDIO_TRACE.md y
LEARNING_MODULES.md. Las operaciones de Studio producen nuevos documentos y jobs;
no heredan permisos cloud. Las respuestas históricas sin telemetría no reciben
datos de ejecución inventados.
