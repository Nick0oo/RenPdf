# Studio y trazabilidad

Studio trabaja sobre los PDFs de la cuenta autenticada y genera archivos nuevos. No envía originales, páginas ni imágenes a servicios externos. Las copias entran en la biblioteca como documentos independientes y reciben un trabajo de extracción persistido; opcionalmente se vinculan a un workspace existente de esa cuenta.

## Studio

- **Combinar:** selecciona dos o más PDFs, cambia el orden de los archivos y elige páginas de cada uno. La salida sigue exactamente ese orden.
- **Organizar:** escribe páginas o intervalos, por ejemplo `3, 1-2, 5`. Permite extraer páginas, retirar las que no se incluyen, reordenarlas y duplicarlas. El campo vacío conserva todas.
- **Recortar y rotar:** aplica giros adicionales de 90°, 180° o 270° y recorta porcentajes de los márgenes de las páginas seleccionadas. El recorte se calcula sobre el CropBox sin girar; después se aplica el giro. La vista previa muestra el original.
- **Exportar:** recupera copias anteriores, descarga el PDF real y consulta los archivos y páginas de origen. Puede abrir el workspace asociado.

Se permiten hasta 30 entradas, 50 MB entre los originales y 500 páginas en la salida, respetando también límites menores configurados. Cada entrada se valida contra el propietario y sus páginas reales. El documento original se abre solo para lectura y no se modifica. El archivo de salida tiene nombre nuevo, identificador propio, SHA-256 y un registro `StudioOperation` que conserva los IDs y hashes de origen, páginas, giros y recortes.

Los permisos de nube y los índices vectoriales del original **no se copian** al derivado. Las operaciones sobre páginas no son un editor de texto tipo Acrobat completo. Recortar modifica el área visible y **no es redacción segura**: el contenido fuera del recorte puede permanecer en el PDF. La salida no conserva firmas digitales válidas y no promete reconstruir marcadores o enlaces internos entre páginas.

## Trazabilidad

- **Actividad:** muestra registros persistidos de respuestas IA, extracción/indexación y copias de Studio. Permite filtrar por workspace, estado, título o modelo y paginar. No reconstruye eventos que nunca se registraron.
- **Respuestas:** muestra proveedor, modelo, modo de recuperación, estado, tokens que reportó el proveedor y citas guardadas. Las ejecuciones nuevas además guardan inicio/fin/duración, política y versión de modelo, comprobación de acceso, fuentes e índices utilizados, ventanas y tamaño del contexto, etapas, incidencias semánticas y motivo de finalización reportado. El detalle del contenido y las citas se abre por una acción explícita del usuario.
- **Fuentes:** permite recorrer versiones de extracción, parser y versión, número de fragmentos/figuras, perfiles de embeddings con dimensiones/versión/modalidad y el índice activo. También muestra trabajos y linaje de Studio.
- **Permisos:** diferencia permisos activos, vencidos y revocados por documento, proveedor y tarea, con sus fechas. Sin permiso, el acceso a la nube continúa denegado.

El historial presenta lo que está guardado. Los mensajes anteriores que no tienen metadatos de ejecución no reciben una latencia o una política inventada. Los índices actuales de un documento no prueban qué perfil utilizó una respuesta antigua. Los contadores son consultas a PostgreSQL, no muestras de interfaz. Todas las consultas y transformaciones están delimitadas a la cuenta, incluidos previews, detalles, workspaces y fuentes.

El registro de Studio conserva su linaje si se elimina la copia, y marca que ya no está disponible para descargar. Eliminar la cuenta elimina sus registros. Eliminar un workspace desvincula el registro de Studio sin eliminar los PDFs de biblioteca.

## API

| Método | Ruta | Resultado |
|---|---|---|
| GET | `/api/v1/trace/overview` | Contadores reales de la cuenta |
| GET | `/api/v1/trace/activity` | Eventos filtrados y paginados |
| GET | `/api/v1/trace/responses/{id}` | Respuesta y citas con ownership |
| GET | `/api/v1/trace/documents/{id}` | Versiones, perfiles, trabajos y linaje |
| GET | `/api/v1/trace/permissions` | Permisos y estado actual |
| GET | `/api/v1/studio/operations` | Copias locales de la cuenta |
| POST | `/api/v1/studio/operations` | Copia persistida, linaje y trabajo de extracción |
| GET | `/api/v1/studio/documents/{id}/pages/{n}/preview` | PNG del original, máximo 600 px |

Ejemplo de entrada local, que requiere IDs reales de la cuenta:

```json
{
  "kind": "merge",
  "output_name": "Fuentes combinadas.pdf",
  "workspace_id": null,
  "sources": [
    {"document_id": "UUID-DEL-PRIMER-PDF", "pages": [1, 3], "rotation": 0, "crop": null},
    {"document_id": "UUID-DEL-SEGUNDO-PDF", "pages": null, "rotation": 0, "crop": null}
  ]
}
```

La migración `a421c9f2b810` agrega únicamente `studiooperation` y sus índices. Sus referencias al workspace y la copia usan `SET NULL`; su propietario usa `CASCADE`. No modifica tablas ni archivos históricos. La siguiente migración de Laboratorio/Estudio es hija de esta revisión.

## Verificación

`backend/tests/test_studio_trace.py`: siete pruebas aprobadas en la base aislada `_test`. Comprueban orden y texto reales del PDF combinado, conservación de hashes originales, organización/duplicación de páginas, recorte con CropBox y rotación, límites y validación, PNG de vista previa, aislamiento entre cuentas, ausencia de permisos heredados, estados de autorización, metadatos sin claves/prompts y linaje después de eliminar la copia. No utilizan una API de IA ni envían los fixtures a la nube.

PyMuPDF es el motor de transformación. Referencias primarias: [Document](https://pymupdf.readthedocs.io/en/latest/document.html), [Page](https://pymupdf.readthedocs.io/en/latest/page.html).

## Contexto visual y diagnóstico de carga

La vista previa de Studio se obtiene con la sesión autenticada y se muestra como un blob local. Cancela solicitudes antiguas al cambiar de página, libera sus URLs y permite reintentar errores sin mostrar un icono de imagen rota. Los clientes de módulos rechazan una respuesta HTML de un backend antiguo como ApiContractError; esa incompatibilidad no se presenta como una colección vacía.

El diagnóstico sobre el fixture público del triángulo confirmó la diferencia entre recuperar una leyenda y observar una imagen: Docling guardó una figura real en página 2, con bbox y sin texto. El índice local de EmbeddingGemma2 encontró la leyenda «Figura A: triángulo verde.», pero no contenía un vector visual de esa figura.

El contexto visual automático se limita ahora a figuras persistidas que aparecen en la evidencia recuperada y están presentes en un índice **multimodal** activo que realmente participó en esa consulta. Verifica propietario, versión, chunk, procedencia, perfil e índice; no adjunta logos o imágenes vecinas por estar en la misma página. Adjunta como máximo dos PNG de hasta 1024 px y 4 MB cada uno, después de verificar permiso de chat y visión para el proveedor seleccionado. Mantiene ese proveedor y modelo, no concede permisos ni realiza un cambio automático a la nube. El prompt relaciona cada imagen con su número de fuente, y la traza guarda región, dimensiones, tamaño y SHA-256.

Este comportamiento **no convierte el índice de texto local en un buscador de píxeles**. El índice multimodal disponible usa Gemini Embedding 2 con autorización explícita; la consulta manual de una región sigue disponible por separado. No se descargan modelos visuales locales nuevos.

El archivo de pruebas backend/tests/test_visual_context.py tiene siete pruebas aprobadas con PNG reales del fixture público y proveedor de inferencia controlado exclusivamente en tests. Incluyen selección y límites, exclusión de índices de texto/fuentes ajenas/versiones antiguas/regiones sin vector, integridad del índice, invocación automática sin elegir una región manual y denegación antes de renderizar o invocar si falta permiso de visión. No son una evaluación de calidad de un modelo de visión externo ni envían documentos privados a la nube.

## Inspección del RAG

Cada respuesta nueva ofrece **Detalles de respuesta y RAG** en el chat, con
etapas, perfiles, ranking RRF, cobertura por fuente e imágenes enviadas.
**Inspeccionar contexto RAG** muestra la consulta y los fragmentos efectivamente
seleccionados, con IDs, páginas y puntuaciones. El detalle de una fuente permite
**Explorar chunks del documento**, filtrar por página y recorrer sus referencias.
Los endpoints comprueban propiedad de la conversación y del documento; no se
agregan prompts ni texto documental a logs. El historial antiguo conserva los
datos que realmente registró, sin inventar consultas ni etapas.

La navegación añade **RAG y segmentos** (`/trace/rag`) con fuentes PDF/audio/video,
filtros por workspace/formato, cobertura e historial de análisis/índice. Las
consultas abren su ejecución y contexto efectivo; los chunks de medios muestran
tiempos, modelo, hashes y uso reportado, con enlace al reproductor. El historial
de PDF comparte estos inspectores. Excel aparece como fuente propia, con cobertura
por hojas/celdas, filtro por hoja y referencia A1, valores, fórmulas, caché y enlaces
al visor en la celda exacta. Alcance y pruebas en [MEDIA_RAG.md](MEDIA_RAG.md)
y [SPREADSHEET_RAG.md](SPREADSHEET_RAG.md).
