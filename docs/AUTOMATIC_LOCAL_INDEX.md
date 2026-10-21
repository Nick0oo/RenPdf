# Preparación automática para RAG

La extracción prepara todas las páginas y sus fragmentos; el índice local vectoriza **cada fragmento de texto de la versión completa**. Las consultas recuperan las fuentes pertinentes de ese corpus, sin depender de una lista de preguntas previstas. Las ventanas contiguas conservan etiquetas y valores separados con su procedencia exacta.

## Flujo y estado real

1. Subir un PDF crea un trabajo de extracción persistente.
2. Al completar la extracción, su resultado y el siguiente trabajo de índice local se guardan en la misma transacción. `AUTO_INDEX_LOCAL=true` habilita este paso.
3. Un documento sin índice activo permanece `INDEXING` mientras se procesa la cola. Su versión y el texto extraído ya existen; todavía no se declara listo para consultas semánticas.
4. El trabajador verifica el modelo local real, su versión y capacidades. Procesa todos los fragmentos por lotes y guarda cada lote de vectores con su checkpoint.
5. Solo activa el índice cuando la cantidad de vectores coincide con todos los fragmentos de la versión actual. El estado pasa a `READY`, o conserva `DEGRADED` si hay páginas pendientes de OCR.

El índice previo sigue activo durante una reindexación de la misma versión. Los perfiles y sus versiones no se mezclan. Al extraer una versión documental distinta, el índice de la versión anterior se conserva como registro histórico, pero deja de ser su índice activo.

## Selección de modelo y privacidad

Se utiliza la política real de embeddings del propietario: global, personal y, cuando corresponde, del workspace explícito de la subida o del único workspace asociado. Si el documento pertenece a varios workspaces sin una selección explícita, se usa la configuración personal.

Solo se automatizan `ollama` o `llamacpp` con un endpoint local y un modelo configurado. llama.cpp requiere modo `embeddings`. Si la configuración selecciona nube, el sistema no cambia a otro proveedor ni inicia envíos implícitos. La indexación en nube sigue siendo una acción manual con sus permisos correspondientes.

La creación del trabajo no descarga modelos ni contacta proveedores para descubrimiento. El trabajador verifica la disponibilidad local al ejecutar el índice. Una configuración no local, deshabilitada o incompleta deja el texto extraído disponible y explica por qué no se preparó el índice automático.

## Fallos, recuperación y documentos existentes

Una caída del runtime local deja el trabajo de índice en `FAILED`, sin perder la extracción ni activar un índice incompleto. El documento vuelve a `EXTRACTED` o `DEGRADED`. Reintentar el trabajo restaura `INDEXING` y completa únicamente los vectores que faltan. Cancelar un trabajo automático todavía en cola también restaura el estado del texto.

`POST /api/v1/documents/{document_id}/index-local` prepara un documento propio ya extraído usando esta misma política. Devuelve `state`, `reason` y el trabajo público cuando existe. Es idempotente: reutiliza trabajos pendientes o intentos anteriores y conserva cualquier índice actual válido, incluso si pertenece a otro perfil. Re-subir un archivo duplicado antiguo puede preparar su índice sin duplicar el PDF ni su versión.

Un intento fallido no se reinicia silenciosamente al consultar este endpoint: se reintenta mediante la acción normal de trabajos. PostgreSQL conserva la cola; el dispatcher vuelve a publicarla si Redis o el trabajador se interrumpen.

## Límites y verificación

Indexar todo el texto hace que todos sus fragmentos sean consultables; cada respuesta sigue teniendo un contexto acotado y citas concretas. Las imágenes no se convierten en comprensión visual mediante embeddings de texto. Una página sin texto legible conserva el aviso de OCR pendiente; el sistema no inventa contenido ni declara un índice completo inexistente.

Las suites generales deshabilitan `AUTO_INDEX_LOCAL` antes de importar la configuración para evitar llamadas masivas a modelos reales. Las pruebas específicas lo habilitan con un adaptador controlado y verifican corpus completo de varias páginas, consultas de temas ajenos al vocabulario de campos, aislamiento, idempotencia, cancelación, recuperación de un lote parcial, política de workspace, rechazo de nube/remoto/configuración inválida y OCR pendiente. La inferencia real privada previa está registrada únicamente con agregados en `invoice-local-check.json`.
