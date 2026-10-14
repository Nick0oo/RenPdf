# Ingesta y recuperación

Validación por contenido y límites → guardado atómico/fsync → SHA-256 → inspección
→ extracción por páginas → elementos/tablas/figuras → spans/chunks → perfil de
embeddings → pgvector → FTS bilingüe → RRF → contexto acotado → modelo → validación
de IDs → persistencia → fuentes en visor.

La extracción no llama a un LLM ni vectoriza automáticamente en cloud. Cada página
confirma sus elementos, chunks y checkpoint en una sola transacción. El reintento
continúa en la siguiente página. Un advisory lock por documento evita ejecuciones
duplicadas incluso cuando el broker vuelve a entregar una tarea. Un worker solo,
prefetch 1, dos hilos y rendering selectivo limitan consumo. Los PDFs originales
no se convierten por completo en imágenes residentes en RAM.

Estados: UPLOADED, EXTRACTED, DEGRADED, READY. DEGRADED conserva páginas pendientes
de OCR. READY requiere índice verificado. Un job fallido sigue FAILED y no activa
un índice incompleto. La reindexación utiliza artefactos ya extraídos y conserva
el índice anterior hasta completar el nuevo.

Gemini Embedding 2 usa **una llamada por chunk**, garantizando un vector independiente
por entrada, con prefijos de recuperación documentados y validación de cardinalidad,
dimensión, finitud y norma. Embedding 001 usa task_type. No se mezclan versiones,
modelos o dimensiones. Las consultas verifican la versión del modelo del perfil.

FTS combina configuraciones español/inglés; GIN acelera la expresión. Retira
palabras conversacionales y completa resultados con términos OR cuando la búsqueda
estricta queda corta, conservando los filtros de documentos y versiones. Se fusionan
rankings léxicos y semánticos con RRF, deduplicando cada lista. Los filtros se
aplican antes de buscar. Los vectores se consultan con distancia coseno exacta;
no se agrega HNSW sin una escala medida que lo justifique. La ausencia/revocación
de embeddings habilita modo lexical explícito, sin enviar datos a otro proveedor.

Contexto máximo 24 000 caracteres, preguntas 4 000, respuesta 2 048 tokens por
defecto. No hay herramientas ejecutables desde contenido recuperado. El modelo
debe abstenerse si la evidencia no respalda la pregunta. Validar IDs garantiza
trazabilidad; no demuestra por sí solo que cada afirmación sea verdadera.

Docling NativePdfPipeline es el parser base sin pesos neuronales. HybridChunker
usa un presupuesto conservador de bytes UTF-8 sin conexión, o el tokenizer local
DOCLING_TOKENIZER_PATH. Cada chunk conserva título, página y procedencias; las
citas usan el span de su elemento, evitando citar sólo un encabezado. El proceso
se reutiliza hasta ocho páginas y se recicla, con timeout y memoria acotados.

Las preguntas generales sobre el documento usan `document_overview`: una muestra
distribuida de fragmentos reales por página/documento, sin exigir que el PDF contenga
palabras como «resume». El chat muestra y persiste el aviso de cobertura parcial;
no promete un resumen exhaustivo de las 72 páginas. Preguntas factuales sin evidencia
mantienen la abstención. Los PDFs sin selección, pendientes o sin texto tienen errores
distintos y visibles.

Los embeddings multimodales usan un perfil separado y permiso adicional.
Consulte KNOWN_LIMITATIONS.md, evaluation-results.json y local-evaluation-results.json.
