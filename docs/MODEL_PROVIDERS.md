# Proveedores

Gemini usa `google-genai` oficial. Claves: `GEMINI_API_KEY`, `GOOGLE_API_KEY` o
`GOOGLE_GENERATIVE_AI_API_KEY`. Nunca se almacenan en PostgreSQL ni se entregan al
frontend. El catálogo se consulta con SDK; las selecciones se persisten por tarea.
El modelo generativo no está fijado como única opción. El entorno actual confirmó
catálogo, generación y embeddings de 768 dimensiones con entradas sintéticas.

Ollama usa `/api/tags`, `/api/show`, `/api/chat`, `/api/embed`. Se consulta el catálogo
real y capacidades declaradas. `keep_alive=0s`, dos hilos y contexto acotado evitan
dejar modelos grandes residentes tras una solicitud del usuario. No hay endpoint
de descarga ni pull automático. El modelo disponible pesa 7.16 GB; su inferencia
no se inició durante la auditoría con RAM libre insuficiente.

llama.cpp y OpenAI compatible usan `/v1/models`, `/v1/chat/completions` SSE y
`/v1/embeddings`. No se atribuye visión o embeddings sólo por HTTP 200. Catálogos
compatibles sin declaración de capacidades muestran UNKNOWN; una operación real
debe verificar su formato. El adaptador requiere una base sin `/v1` final.

Endpoints se configuran en el servidor. Sólo hosts de PROVIDER_ALLOWED_HOSTS,
sin credenciales/query/fragment, sin redirects; remoto requiere HTTPS. Direcciones
distintas a localhost/127.0.0.1/host.docker.internal se tratan como cloud aunque
sean de Ollama. Cambiar un host requiere autorización administrativa explícita
en el entorno. Contenido documental nunca decide URLs.

Orden de selección: entorno → global → personal → workspace → conversación.
Tareas independientes: chat, embeddings, visión, preguntas, resumen, reranking.
Los timeouts y budgets se guardan en preferencias. No hay fallback silencioso;
un error se muestra con código seguro. Reranking tiene contrato, pero ningún
reranker está configurado ni se fabrican sus puntuaciones.

Referencias: [SDK](https://googleapis.github.io/python-genai/),
[embedding inputs](https://ai.google.dev/gemini-api/docs/embeddings),
[Ollama](https://docs.ollama.com/api/introduction),
[llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).
