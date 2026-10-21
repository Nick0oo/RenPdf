# Excel en workspaces

Se pueden subir varios XLSX, XLSM, XLS y CSV/TSV UTF-8 desde el workspace o la
biblioteca. El procesamiento local conserva todas las hojas, incluidas las
ocultas, sus nombres, coordenadas, valores y rangos combinados. No necesita
consentimiento cloud para extraerlos. Los formatos de celdas se presentan de
forma básica; el archivo original queda disponible para descargar.

Cada celda no vacía produce un elemento con procedencia. Los chunks agrupan
celdas de una fila con sus encabezados y conservan la relación con cada celda.
La recuperación reserva evidencia entre documentos y hojas para que una hoja
larga no desplace a otra corta. Se pueden pedir celdas y rangos explícitos,
por ejemplo «Compara B2 y C2 de la hoja Ventas», o combinar libros con PDFs.

Las citas llevan documento, hoja y referencia A1. Abren el visor en esa celda,
incluso fuera de la ventana visible. El visor carga ventanas de filas y columnas
desde la extracción persistida: no vuelve a leer el archivo al navegar.
Las pestañas de hoja, la celda seleccionada y el chat se conservan al alternar
fuentes; el visor se abre a demanda y tiene desplazamiento independiente.

Trazabilidad → RAG y segmentos incorpora el filtro «Excel y tablas», cobertura
de hojas/celdas, consultas, ranking, contexto enviado y enlaces al visor.
Los chunks admiten filtros por hoja y referencia o rango. Su análisis muestra
valor guardado, presentación, fórmula, disponibilidad de caché y SHA del original.

## Fórmulas y límites

No hay motor de cálculo. XLSX/XLSM conservan la fórmula y el último resultado
guardado. Si falta ese resultado, aparece «sin resultado guardado», nunca cero.
El chat distingue un cálculo inferido de un valor almacenado. Para actualizar
resultados, abre, recalcula y guarda el libro en Excel antes de importarlo.
XLS conserva sus valores guardados; xlrd no expone el texto de sus fórmulas.
CSV/TSV conservan ceros iniciales y tratan `=` como texto.

No se ejecutan macros, vínculos externos ni instrucciones dentro de celdas.
Gráficos e imágenes incrustadas quedan fuera del análisis y se advierte en
cobertura. No es un editor de hojas de cálculo ni reproduce todo el diseño Excel.

Límites predeterminados configurables en `.env`: 50 hojas, 200.000 celdas,
1.000.000 posiciones de cuadrícula acumuladas, 50.000 filas y 512 columnas por
hoja, 100 MB expandidos y el límite general de subida de 50 MB. Se valida el ZIP
y XML antes de abrir XLSX; no se confía en dimensiones declaradas artificiales.

Los índices actuales de Excel son de **texto derivado de celdas**, tanto con
EmbeddingGemma local como Gemini Embedding 2. El original XLSX no se envía como
una entrada multimodal. El uso cloud requiere los permisos de embeddings/chat
correspondientes a cada documento.

## Verificación

`backend/tests/test_spreadsheet_rag.py` usa archivos reales XLSX y XLS, CSV y PDF.
Comprueba extracción, caché, celdas combinadas, paginación, aislamiento por dueño,
cancelación/reintento, consulta entre libros/hojas/PDF, citas, exportación y módulo
de trazabilidad. Chromium prueba subida múltiple, grid, navegación, citas,
continuidad de chat, móvil y procedencia en el módulo RAG.

La aceptación opcional con proveedores reales usa únicamente libros y un PDF
inventados, primero con índice local y después con Gemini:

```powershell
uv run --package app python scripts/evaluate_spreadsheet_rag.py --cloud
```

`--resume` reutiliza sus fuentes y conversación. Resultados verificables en
[spreadsheet-rag-results.json](spreadsheet-rag-results.json).
