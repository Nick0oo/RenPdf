# Modelo de datos

Auth conserva `User` y los modelos del template. Las entidades adicionales están
en `backend/app/domain.py`; las respuestas públicas en `schemas/research.py`.

| Entidad | Responsabilidad |
|---|---|
| Workspace / WorkspaceDocument | Colecciones del propietario y membresía de fuentes |
| Document | Original persistente, SHA-256, tamaño, páginas, versión e índice activos |
| DocumentVersion | Versión inmutable de extracción, parser y manifiesto de artefactos |
| DocumentPage | Geometría, CropBox, rotación y estado real de extracción/OCR |
| DocumentElement | Texto, tabla/figura, región canónica, geometría original y hash |
| Chunk / ChunkProvenance | Fragmentos y spans que los vinculan a elementos reales |
| EmbeddingProfile | Proveedor, modelo, versión, dimensiones, modalidad, métrica, fingerprint |
| DocumentIndex / ChunkEmbedding | Construcción aislada de vectores y activación verificada |
| Job | Etapa, progreso, checkpoint, error, cancelación y parámetros no secretos |
| CloudConsent | Documento, propietario, proveedor, alcance, vencimiento y revocación |
| RoutingPreference | Selección por tarea y ámbito global/personal/workspace |
| Conversation / ChatMessage | Historial, proveedor/modelo y estado persistido de cada respuesta |
| Citation | Referencia validada a chunk y elemento, etiqueta y cita conservada |
| Annotation | Nota/subrayado/marcador, versión, página y región opcional |
| StudioOperation | Operación PDF local, salida y linaje de páginas/hash de originales |
| ResearchEntry | Pregunta/informe/comparación, documentos y referencias a respuestas verificadas |
| StudyDeck / StudyCard | Mazo y ficha anclada a página/version o cita válida |
| StudyReview | Respuesta manual, valoración personal y siguiente fecha de repaso |

Migraciones nuevas: `19ef30d98c01` (dominio), `7d81a5e050a2` (GIN bilingüe),
`a421c9f2b810` (Studio) y `b531d1e3a920` (Laboratorio/Estudio).
Las migraciones previas del template permanecen. No se modifica la base Windows
`renpdf`; desarrollo usa `renpdf_chat` y Pytest `renpdf_chat_test`, propiedad del
rol dedicado `renpdf_app`, sin permisos de superusuario.

La deduplicación aplica a `(owner_id, sha256)`. No se reemplazan versiones ni
vectores existentes al reindexar. La versión activa cambia después de completar
su extracción; el índice cambia después de verificar cardinalidad y perfil.
Las citas históricas conservan sus versiones mientras el documento exista.
Eliminar una fuente elimina sus datos y referencias mediante FK; la UI pide
confirmación y rechaza la eliminación mientras haya un trabajo pendiente.

Los módulos adicionales están en module_domain.py y learning_domain.py.
ChatMessage.usage.trace conserva metadatos reales de ejecución sin prompts,
contenido de las fuentes ni secretos. Las notas, citas e informes sí conservan
el contenido que la persona necesita para investigar, sujeto a su propietario.
Eliminar un mazo elimina sus fichas y repasos, sin eliminar PDFs. Una fuente
eliminada se muestra como no disponible en las fichas e informes restantes.
