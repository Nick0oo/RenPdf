# Audio, video y trazabilidad

El workspace admite varios PDF, audios y videos en una selección. La cabecera
es compacta, el chat permanece montado y el visor se abre al elegir una fuente
o una cita. Cerrar/cambiar el visor no borra un borrador ni corta la respuesta.
El navegador recibe MP3 o MP4 normalizado con peticiones Range autenticadas.

La subida valida bytes y contenedor con FFprobe, rechaza playlists y protocolos
externos, y prepara reproducción local con FFmpeg. No envía contenido a la nube.
WebM de MediaRecorder sin duración se mide a partir de sus paquetes. El límite
es 50 MB y 1800 segundos por archivo; la duración es configurable hasta 7200 s.

La vía principal es `POST /documents/{id}/prepare-native` con `IndexInput`,
`modality=multimodal` y EmbeddingGemma 2 nativo local o Gemini Embedding 2.
FFmpeg prepara intervalos reales sin generar una transcripción. Cada clip recibe
su embedding directamente; la referencia textual del intervalo no se incluye en
el vector. La transcripción completa sigue disponible como opción secundaria.
El usuario debe autorizar `media_analysis` antes de transcribir. Gemini recibe clips
de 10 segundos y devuelve transcripción, descripción sonora y descripción visual
(sólo video). Los tiempos los fija FFmpeg, sin pedir al modelo que los invente.
El silencio digital se detecta localmente sin invocar al modelo ni inventar
transcripciones; queda registrado como proveedor local y uso `NOT_INVOKED`.
Los clips de audio se comprimen a MP3 para acotar transferencia.
Cada segmento conserva sus bytes, SHA-256, modelo/versión, uso reportado,
duración del análisis, chunk y procedencia. La versión activa cambia únicamente
cuando termina el análisis completo. Un fallo conserva el checkpoint y reintenta
desde el siguiente segmento; el permiso se comprueba antes de cada envío.

Las citas públicas tienen `source_type`, `start_seconds`, `end_seconds` y
`page_number: null`. El número interno de unidad mantiene el orden del segmento;
la unidad declara `unit_kind=segment`, sin presentarlo como página PDF.
Una pregunta con `01:02`, «minuto 1» o «segundo 12» filtra segmentos por ese punto.
Las citas abren su intervalo en el reproductor. La precisión es de segmento
(10 s por defecto, configurable 5–30 s), sin prometer transcripción por palabra.

El proveedor `embeddinggemma`, modelo `embeddinggemma-2-native`, usa los encoders
oficiales completos de Sentence Transformers en un servicio local separado
(puerto 8082). El proveedor histórico `llamacpp` continúa sirviendo sus perfiles
de texto en 8081: sus vectores no se mezclan con los nativos. Instala con
`scripts/install_native_embeddings.ps1` y arranca con `scripts/start_native_embeddings.ps1`.
Configura `EMBEDDINGGEMMA_BASE_URL` y `DOCKER_EMBEDDINGGEMMA_BASE_URL`.
Los pesos se descargan durante la instalación explícita; nunca al consultar.
El servicio decodifica localmente con PyAV, audio mono 16 kHz y video a 1 fps,
y registra revisión del modelo, precisión y parámetros de procesamiento.

Gemini requiere los permisos separados `embeddings` y `multimodal_embeddings`.
Ni subir ni autorizar transcripción habilita embeddings remotos automáticamente.
El chat requiere `chat` y un modelo que acepte los clips recuperados: sólo se
adjuntan hasta 6 clips/60 segundos/18 MiB; las omisiones quedan en la ejecución.
El modelo recibe el mapa clip→fuente, tiempos reales y bytes originales del clip.
La trazabilidad registra SHA-256, intervalos, versión y elemento, sin guardar
binarios en los logs. Los tiempos tienen precisión de intervalo, no de palabra.

Durante una reindexación nativa se conservan la versión y el índice activos
hasta completar y validar el nuevo índice. Se reutilizan clips del mismo archivo
y vectores con el mismo hash de clip y perfil inmutable; repetir un índice de la
misma versión/perfil reutiliza su índice listo. Fallar o cancelar conserva el
índice anterior y permite reanudar desde checkpoint. Las colas `extract`, `index`
y `media` tienen consumidores separados para evitar bloqueo por documentos largos.
El consumidor de índices admite dos documentos concurrentes; las consultas de
texto al runtime local tienen prioridad entre clips de lotes de reindexación.
Si ya existe un índice completo de la misma versión/perfil y el runtime confirma
su revisión, la API termina la petición sin volver a encolarla. Al seleccionar
EmbeddingGemma nativo como política local, las nuevas subidas audiovisuales
preparan automáticamente su índice después de la reproducción, sin envíos cloud.

## Módulo RAG y segmentos

Las respuestas con clips nativos usan una respuesta Gemini completa antes de
publicar el texto por SSE al chat; evita perder una respuesta parcial por cortes
del flujo HTTP del proveedor. Un corte de lectura permite un único reintento
con el mismo modelo y contenido, dentro del timeout elegido. La traza registra
`response_mode`, `transport_attempts` y, si falla, la clase de excepción y estado
HTTP sin mensajes privados del SDK.

Los resúmenes y comparaciones generales reconocen audio/video y distribuyen el
presupuesto de clips entre las fuentes antes de aplicar el límite. Los PDFs y
hojas ya extraídos pueden consultarse mientras termina el primer índice denso;
la interfaz informa que la búsqueda semántica sigue en preparación y la traza
registra `indexes_pending`. Las fuentes sin versión extraída siguen pendientes.

La navegación incluye `/trace/rag`: fuentes filtrables por workspace/formato,
cobertura de análisis e índice, versiones, trabajos, modelos y chunks. Las
consultas permiten revisar ejecución, ranking, cobertura y contexto efectivo.
Incluye PDF e historial previo en la medida en que registró esos datos.

Endpoints autenticados y restringidos al propietario:

- `GET /trace/rag/sources`, `GET /trace/rag/queries`: filtros y paginación.
- `GET /trace/documents/{id}/chunks?second=12`: contenido y metadatos de análisis.
- `GET /documents/{id}/coverage`, `GET /documents/{id}/segments`: cobertura y rangos.
- `POST /documents/{id}/analyze`: crea trabajo persistente de análisis.
- `POST /documents/{id}/prepare-native`: prepara clips e índice sin transcripción.
- `GET /documents/{id}/playback`: reproducción con Range; original en `/file`.

La migración `c641e2f4b031` agrega tipo/MIME/duración a Document, tipo de unidad
a DocumentPage y tiempos a DocumentElement. Las fuentes históricas son PDF por
defecto. Studio continúa trabajando con PDF y filtra los demás formatos.

## Verificación reproducible

`backend/tests/test_media_rag.py` usa FFmpeg real y proveedor controlado: prepara
WAV/WebM, verifica Range, límites, permisos, checkpoint/reintento, tiempos,
contexto, consultas/fuentes en su módulo y aislamiento de propietario.
`test_provider_contracts.py` verifica partes binarias de audio/video en el SDK.
`test_native_media.py` verifica indexación directa sin generación, permisos por
alcance, activación atómica, recuperación, reutilización de clips/vectores y chat
con clips y citas temporales. `native-media.spec.ts` cubre local/Gemini en audio
y video, progreso, error/reintento y su módulo RAG.
Chromium cubre subida múltiple, análisis/reintento, citas, seek y conservación
del chat. `rag-media-trace.spec.ts` verifica inspección del módulo y filtro temporal.

`uv run --package app python scripts/evaluate_media_rag.py --cloud` crea sólo
material inventado (voz local de Windows con presupuesto al minuto 1 y video
azul/rojo), realiza análisis nativo, RAG local/multimodal y consultas conjuntas.
Conserva el workspace para revisión y escribe `media-rag-results.json`; `passed`
indica el resultado real. No utiliza archivos personales.

Referencias: [audio nativo](https://ai.google.dev/gemini-api/docs/audio),
[video](https://ai.google.dev/gemini-api/docs/video-understanding),
[embeddings multimodales](https://ai.google.dev/gemini-api/docs/embeddings) y
[encoders nativos de EmbeddingGemma 2](https://ai.google.dev/gemma/docs/embeddinggemma/multimodal-embeddinggemma-with-sentence-transformers).
