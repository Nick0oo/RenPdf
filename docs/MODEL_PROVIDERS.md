# Proveedores

Gemini usa `google-genai` oficial. Claves: `GEMINI_API_KEY`, `GOOGLE_API_KEY` o
`GOOGLE_GENERATIVE_AI_API_KEY`. Nunca se almacenan en PostgreSQL ni se entregan al
frontend. El catálogo se consulta con SDK; las selecciones se persisten por tarea.
El modelo generativo no está fijado como única opción. El entorno actual confirmó
catálogo, generación y embeddings de 768 dimensiones con entradas sintéticas.

Ollama usa `/api/tags`, `/api/show`, `/api/chat`, `/api/embed`. Se consulta el catálogo
real y capacidades declaradas. Temperatura 0 reduce variación en respuestas
documentales. `keep_alive=0s`, dos hilos y contexto acotado evitan
dejar modelos grandes residentes tras una solicitud del usuario. No hay endpoint
de descarga ni pull automático. El modelo de chat preexistente `gemma4:e2b` pesa
7.16 GB: generación y respuestas con citas sobre PDFs se verificaron en CPU.
El fixture local produjo la respuesta correcta en 40,44 segundos con un presupuesto
de 128 tokens. Ese tiempo puntual no predice latencia de otras preguntas.
`embeddinggemma:300m` (622 MB) también quedó instalado tras la autorización inicial;
la ruta de embeddings de la cuenta usa EmbeddingGemma 2 en llama.cpp.

llama.cpp CPU b11624 se instaló y comprobó con EmbeddingGemma 2 Q8_0 de texto:
dos vectores reales de 768 dimensiones, valores finitos y cardinalidad correcta.
Su alias es embeddinggemma-2-q8_0; la versión de perfil es el SHA256 verificado
del GGUF. La dimensión interna que `/v1/models` anuncia (512) no se usa como
dimensión de salida: la proyección medida produce 768. Los prefijos de consulta
y documento siguen la guía de Google; no se mezclan con perfiles Gemini. El flujo
HTTP completo verificó 16 chunks Docling, 16 vectores en pgvector, índice READY,
recuperación híbrida y respuesta Ollama citada; véase local-evaluation-results.json.

`generateContent` compartido en el catálogo Gemini no demuestra chat textual:
las familias TTS y Lyria documentadas se conservan en el catálogo y se marcan
como no compatibles con este adaptador de conversación textual. El selector
por tarea no las ofrece para preguntas sobre PDFs. Referencias de Google:
[TTS](https://ai.google.dev/gemini-api/docs/speech-generation) y
[Lyria](https://ai.google.dev/gemini-api/docs/music-generation).

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
