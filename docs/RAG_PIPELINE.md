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

FTS combina configuraciones español/inglés; GIN acelera la expresión. Se fusionan
rankings léxicos y semánticos con RRF, deduplicando cada lista. Los filtros se
aplican antes de buscar. Los vectores se consultan con distancia coseno exacta;
no se agrega HNSW sin una escala medida que lo justifique. La ausencia/revocación
de embeddings habilita modo lexical explícito, sin enviar datos a otro proveedor.

Contexto máximo 24 000 caracteres, preguntas 4 000, respuesta 2 048 tokens por
defecto. No hay herramientas ejecutables desde contenido recuperado. El modelo
debe abstenerse si la evidencia no respalda la pregunta. Validar IDs garantiza
trazabilidad; no demuestra por sí solo que cada afirmación sea verdadera.

Los chunks ligeros conservan títulos y spans. El adaptador Docling puede usar
HybridChunker con DOCLING_TOKENIZER_PATH local y varias procedencias por fragmento;
su ejecución real queda pendiente por falta de artefactos. Los embeddings multimodales
usan un perfil separado y permiso adicional. Consulte KNOWN_LIMITATIONS.md y evaluation-results.json.
