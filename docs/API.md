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
| `/providers/`, `/routing`, `/diagnostics` | Catálogos reales, preferencias y diagnóstico local |

SSE usa `start`, `token`, `done`, `error`. Los tokens son provisionales; `done`
se emite después de validar fuentes y confirmar la transacción. No se presentan
citas inválidas como enlaces. Cancelar cierra el stream y registra su estado.

Una respuesta 200 a una carga confirma el archivo y su fila, no el trabajo ni
el índice. Un job aceptado sigue QUEUED hasta que el worker lo ejecuta. Si falta
Redis, la fila sobrevive y el dispatcher vuelve a enviarla al recuperarse.
Los errores de proveedor contienen códigos sanitizados, nunca su respuesta raw.
