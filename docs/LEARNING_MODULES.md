# Laboratorio y Estudio

Laboratorio conserva preguntas e informes vinculados a respuestas reales del chat. Estudio permite preparar fichas con una fuente documental y guardar repasos manuales. Ambos módulos usan la sesión personal existente y pertenecen a un workspace; no comparten datos entre propietarios.

## Laboratorio

- **Comparación de fuentes** consulta el mismo tema en cada PDF seleccionado por separado. Cada respuesta conserva su modelo, fragmentos y citas. El usuario revisa las respuestas y añade observaciones; el módulo no presenta una síntesis automática de diferencias que no haya generado. Sólo se permite guardar una comparación con citas que respalden al menos dos documentos.
- **Preguntas de investigación** guarda una pregunta pendiente sin llamar a un modelo. Puede consultarse después y actualizarse con respuestas citadas, conservando el mismo registro.
- **Resúmenes guardados** conserva una respuesta citada generada a demanda o elegida de un chat existente. El generador de resumen general del chat informa su cobertura parcial. Un informe guardado permite inspeccionar sus fragmentos, abrir la página original y exportar Markdown.

Las llamadas nuevas usan el modelo seleccionado y el servicio de chat RAG existente. Los permisos de nube se verifican por documento; guardar una pregunta o reutilizar una respuesta no genera nuevas llamadas. Si una fuente no aporta citas, no se fabrica una respuesta para completar el informe. Los intentos quedan en el historial del workspace y pueden cancelarse.

## Estudio

- **Fichas con evidencia** guarda una pregunta y una respuesta escrita por el usuario, vinculadas a una página válida de un PDF procesado o a una cita real guardada en Laboratorio. Las referencias manuales y las citas se identifican por separado.
- **Mazos** organiza las fichas por tema dentro de un workspace; admite nombre, descripción, edición y eliminación. Eliminar un mazo elimina sus fichas y repasos, y conserva los PDFs.
- **Repaso y progreso** oculta la respuesta de referencia hasta que el usuario decide verla. Guarda su respuesta escrita, valoración y próxima fecha. Otra vez programa 10 minutos; difícil, 1 día; bien, 3 días; fácil, 7 días. El progreso suma registros reales y se identifica como `self_reported`: no mide exactitud mediante IA ni asigna una calificación automática.

Si se elimina una fuente, la ficha conserva el contenido del usuario y marca la fuente como no disponible. Si desaparece la respuesta original de un informe, el informe informa que ya no está disponible. No se guarda un supuesto texto de IA de respaldo ni una cita inventada.

## API y persistencia

El router `/api/v1/learning` expone:

| Recurso | Operaciones |
|---|---|
| `/research` | GET (filtro `workspace_id`), POST |
| `/research/{id}` | PATCH, DELETE |
| `/decks` | GET (filtro `workspace_id`), POST |
| `/decks/{id}` | PATCH, DELETE |
| `/decks/{id}/cards` | GET |
| `/cards` | POST |
| `/cards/{id}` | PATCH, DELETE |
| `/cards/{id}/reviews` | POST |
| `/decks/{id}/reviews` | GET, hasta 500 registros recientes |
| `/decks/{id}/progress` | GET, conteos de todos los repasos del mazo |

La migración `b531d1e3a920`, hija de `a421c9f2b810`, crea `researchentry`, `studydeck`, `studycard` y `studyreview`. Las respuestas citadas se resuelven desde el chat persistido; se rechazan mensajes incompletos, sin citas o de otro workspace. Las fichas conservan la versión documental usada al crearse.

El frontend exporta `LabDesk({section: 'compare' | 'questions' | 'summaries'})` y `StudyDesk({section: 'cards' | 'decks' | 'review'})`. Estudio acepta enlaces con `workspace` y `deck` para abrir el mazo correcto.

## Verificación

`backend/tests/test_learning.py`: seis integraciones verifican conservación de citas de dos PDFs sintéticos, actualización de preguntas, rechazo de evidencias ausentes, páginas válidas, eliminación de fuentes, calendario y progreso persistidos, cascadas e independencia entre usuarios/workspaces. Pasaron en la base dedicada terminada en `_test`.

`frontend/tests/learning.spec.ts`: flujos de preguntas, creación de mazos/fichas, recarga del progreso y vista móvil; la prueba de comparación/resumen usa generación real sólo con `RUN_CLOUD_E2E=1` y permisos limitados a PDFs sintéticos de prueba.

Ambos flujos Chromium pasaron contra la imagen final: persistencia de fichas y
autoevaluación en móvil, y comparación/resumen con citas generadas realmente
para dos PDFs inventados. No se usaron documentos privados para las llamadas cloud.
