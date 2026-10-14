# Citas y geometría

Los identificadores los asigna el backend a elementos existentes. El modelo ve
`source_id` y contenido; no decide documento/página/coordenadas. La respuesta
sólo puede usar los IDs entregados. Se rechazan fuentes inexistentes y respuestas
con afirmaciones sin referencias; una abstención exacta permite cero citas.

Las citas se vinculan a message/chunk/element. Element → page → document_version
→ document permite auditar parser, hash, método de extracción, tamaño, CropBox y
rotación. Se conserva el quote; reindexar no cambia evidencias históricas.

Canónico: origen superior izquierdo del CropBox sin rotar, `[0,1]`, x/y/width/height.
PyMuPDF extrae con rotación temporal 0. Docling transforma desde su origen usando
la altura. El visor suma rotación nativa y del usuario y transforma los rectángulos
0/90/180/270 antes de aplicar porcentajes al viewport renderizado. Zoom y ResizeObserver
escalan página y overlay juntos. Se carga sólo una página, también en PDFs extensos.

Precisión inicial: region si hay geometría, page si sólo hay página. No se promete
word ni se fabrica un resaltado cuando falta bbox. Las pruebas de normalización
y rotación usan tolerancia `1e-9` en coordenadas normalizadas. Los E2E verifican
apertura, navegación, overlay, cambio de tamaño y rotación en el PDF real.

La selección textual sólo se asocia a un elemento cuando su texto contiene la
selección; la selección visual utiliza un elemento de tipo figura y envía su ID,
no una descripción simulada. Las regiones se renderizan bajo demanda hasta 1600px.
La conversación transmite imágenes sólo tras consentimiento vision y contexto
textual sólo tras chat. Citas inline y botones de fuentes abren el origen.
