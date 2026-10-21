# Laboratorio y Estudio

Laboratorio convierte las fuentes de un workspace en material para entenderlas;
Estudio permite practicarlo y repasar lo pendiente. Ambos conservan la sesión
y el aislamiento por propietario del resto de la aplicación.

## Preparar material

- **Resúmenes:** selecciona fuentes, modelo y un enfoque opcional. La IA genera
  un resumen con citas y lo guarda automáticamente en Laboratorio.
- **Preguntas:** la IA genera un banco de preguntas y respuestas, y un mazo
  con las mismas fichas para empezar a practicar.
- **Comparar fuentes:** una consulta conjunta contrasta los documentos elegidos.
  Guardar una comparación necesita citas de al menos dos fuentes.

La selección manual de respuestas y las notas quedan como opciones secundarias.
Cada generación conserva su conversación, respuesta y citas en el workspace,
y su ejecución se puede consultar en Trazabilidad.

## Estudiar

**Generar mazo** crea fichas citadas o añade fichas a un mazo existente.
La cantidad admite entre 3 y 20 preguntas. El modelo debe devolver la cantidad
solicitada, preguntas distintas y fuentes válidas; si falla no se guarda un
mazo incompleto. Las preguntas deben respetar el enfoque elegido.

Las citas abren la página PDF, el intervalo audiovisual o la hoja y celda.
Una ficha puede conservar varias citas. La creación y edición manual continúan
disponibles; una referencia manual de página sólo corresponde a PDF.

En **Repasar**, recuerda o escribe la respuesta antes de revelarla. Después
elige Otra vez (10 minutos), Difícil (1 día), Bien (3 días) o Fácil (7 días).
El progreso conserva registros reales y `assessment=self_reported`: los
contenidos se generan con IA, mientras la valoración del repaso es personal.
No se presenta como una nota automática de exactitud.

## API y persistencia

`POST /api/v1/learning/generate` recibe `workspace_id`, `kind`
(`summary`, `questions`, `deck`), `document_ids`, `provider`/`model`
opcionales, `title`, `focus`, `count` y `deck_id` opcional. Devuelve
la conversación/respuesta, investigaciones, mazo, fichas y cobertura.

Reutiliza el RAG del chat: búsqueda equilibrada, regiones PDF y clips nativos
recuperados. El texto extraído puede consultarse durante la construcción del
primer índice denso. Una fuente sin versión preparada debe procesarse primero.

Las fichas salen de un esquema estructurado. El servidor valida cantidad,
preguntas únicas e identificadores de evidencia, añade las citas y guarda
banco/mazo/fichas en una transacción. Un fallo queda en la trazabilidad y no
crea material parcial. IDs válidos prueban procedencia, no verdad factual.

Los permisos cloud se verifican antes del envío. Si faltan, la interfaz abre
Privacidad y conserva las opciones; no concede permisos automáticamente.
Gemini espera la respuesta completa y admite un único reintento de conexión
dentro del timeout, sin cambiar de proveedor. Cada generación utiliza una
muestra recuperada, no todos los archivos completos.

La traza incluye `learning.kind`, `requested_items`, `generated_items`,
`research_ids`, `deck_id`, `storage_state`, modelos, tiempos y contexto.
Los endpoints manuales `/research`, `/decks`, `/cards`, `/reviews` y
`/progress` continúan disponibles. No se agrega una migración.

## Verificación

`test_learning_generation.py` cubre generación, persistencia, repaso, referencias
temporales/celdas, aislamiento, consentimiento y rechazo atómico de fuentes
falsas, preguntas duplicadas, cantidades incompletas y cortes del proveedor.
`test_learning.py` conserva las comprobaciones manuales y de progreso.
`frontend/tests/learning.spec.ts` prueba generación, estados pendientes, guardado,
preguntas/mazos, permisos, trazabilidad y el flujo manual.

```powershell
uv run --project backend python scripts/evaluate_learning.py --cloud
uv run --project backend python scripts/evaluate_learning.py --cloud --native
```

La aceptación real usa sólo los PDFs inventados de
`docs/workspace-rag-results.json`, creados previamente con
`scripts/evaluate_workspace_rag.py --cloud`. Guarda el resultado y el material
generado en `docs/learning-ai-results.json`.

La opción `--native` comprueba además las fuentes audiovisuales inventadas de
`docs/native-media-results.json`: genera fichas y verifica que el presupuesto
del audio cite su intervalo original a partir de 01:00. Deben existir primero
los fixtures creados por `scripts/evaluate_native_media.py --cloud`.
