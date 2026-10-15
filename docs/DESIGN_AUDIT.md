# Auditoría de diseño del escritorio RenPdf

## Brief y dirección

El usuario pidió un rediseño completo: un workspace reconocible, conversación cómoda, notas visibles, PDF con espacio de lectura, selectores buscables y navegación jerárquica. La revisión descartó mantener PDF y chat permanentemente enfrentados: comprimía ambos y acumulaba barras y scrolls.

Skill aplicada: [frontend-design de Anthropic](https://github.com/anthropics/skills/tree/main/skills/frontend-design), instalada en `C:/Users/ASUS/.codex/skills/frontend-design/SKILL.md`.

La dirección visual es un escritorio documental: papel `#FFFFFF`, tinta `#192B27`, acento de evidencia `#087B71`, superficie `#F4F7F6`, borde `#DDE5E1` y error `#B42318`. Usa Segoe UI y alternativas locales; KaTeX conserva las fórmulas. Alineación izquierda, espacios consistentes y texto de respuesta con interlineado amplio. El color comunica selección, evidencia y estado. No se descargaron fuentes, imágenes ni modelos para diseñar la interfaz.

```text
Navegación jerárquica | Workspace: nombre, propósito, fuentes y modelo
                     | Conversación amplia       | Fuentes y notas
                     | Historial y pregunta      | Datos persistidos
                     | ↳ PDF a demanda, con espacio para lectura
```

En escritorio el chat ocupa el centro y las fuentes/notas un lateral. En móvil, fuentes y notas se abren en un panel y el compositor permanece disponible. El visor abre un panel amplio; cerrar o seleccionar una región devuelve al chat. Se respeta `prefers-reduced-motion`.

## Cambios concretos

| Problema | Resultado |
| --- | --- |
| Entrar al chat requería buscar un proyecto y no había una acción clara junto al PDF. | Biblioteca → Chatear con PDF crea o reutiliza el workspace y su conversación sin duplicarlos. |
| El workspace no tenía un lugar propio ni contexto claro. | Overview real en `/`, biblioteca en `/library` y ruta estable `/workspaces/:id`; nombre, propósito y ajustes reales editables. |
| La split dejaba poco espacio para leer y conversar. | Chat principal y visor amplio a demanda, también al abrir una cita. |
| Fuentes y notas estaban ocultas entre controles de procesamiento. | Panel visible con fuentes activas, carga de varios PDFs, selección explícita y notas persistidas. |
| Catálogos extensos difíciles de recorrer. | Un combobox compartido con Command + Popover shadcn: búsqueda por modelo/proveedor, agrupación local/nube y capacidades declaradas/verificadas. |
| Selectores y diálogos inconsistentes. | ChoiceSelect, ProviderModelSelect, NameDialog y ConfirmationDialog compartidos; sin prompts nativos. |
| Menú plano sin jerarquía. | Investigación, Trazabilidad, Studio, Laboratorio y Estudio usan un registro extensible; Configuración y Cuenta tienen destinos propios. |
| Cuenta y configuración demasiado básicas. | Perfil, contraseña, tema persistido, conexiones y preferencias de modelos reales; ámbito personal o por workspace. |
| La extracción y el índice se confundían con estar listo para preguntar. | Texto extraído permite consulta; indexar mejora búsqueda semántica. Documentos pendientes requieren esperar o deseleccionarlos explícitamente. |
| Errores de permisos dejaban al usuario sin salida. | Acción directa a la pestaña Privacidad del proveedor usado; nunca se concede permiso automáticamente. |
| Una sesión caducada se reintentaba varios segundos. | HTTP 401 vuelve al login sin reintentos; se conserva la recuperación limitada de assets. |

Las rutas de los cuatro módulos nuevos montan componentes funcionales sobre APIs reales. La navegación no publica estadísticas ficticias ni pantallas de demostración. El catálogo conserva modelos por verificar, excluye únicamente capacidades incompatibles con la tarea y no presenta modelos de audio como conversación textual cuando el proveedor declara esa incompatibilidad.

## Verificación del rediseño completo

- Build de producción con TypeScript aprobado; Biome de los 40 archivos de frontend y pruebas revisados, sin errores.
- Playwright de investigación: 5/5 aprobados (setup y cuatro flujos). Comprueba acceso directo, reapertura sin duplicar conversación, chat nuevo, búsqueda de modelo, visor a demanda, viewport de 390 px, carga de dos PDFs, notas persistidas tras recarga, edición real del workspace y bloqueo cloud antes de permisos explícitos.
- Cuenta y Configuración verificadas con cambios reales de tema y catálogo de conexiones. La prueba de investigación se repitió después del ajuste del título móvil y siguió aprobada.
- Capturas de escritorio claro, móvil de 390 px, PDF amplio y notas de workspace oscuro revisadas. Se corrigió el título móvil truncado por las acciones y se esperó el cierre del panel antes de capturar.
- Playwright focal posterior: 6/6 aprobados juntos contra el frontend compilado en localhost:5173 y API de localhost:8000 (setup, tres casos de recuperación y dos de continuidad/errores). Un asset ausente ejecuta exactamente dos documentos: la visita inicial y una única recuperación automática de TanStack Router. Se eliminó el listener global duplicado de Vite, que provocaba una segunda recarga. La frontera de error se estabiliza y permite volver a la biblioteca; la cookie HttpOnly se conserva.
- Una petición de chat controlada permaneció abierta durante tres sondeos de documentos, el guardado real de una nota y la lectura de páginas 1 → 2 → 1. Verificados cero recargas, cero abortos, borrador conservado y una sola descarga completa del PDF. Un observador confirmó cero transiciones sin lienzo y un máximo de dos lienzos en memoria. El visor conserva la página anterior hasta terminar el nuevo dibujo; mientras espera, desactiva selección y marcas, y las anotaciones siguen la página realmente mostrada.
- Una respuesta 404 en el detalle del workspace y una respuesta HTML inesperada de Laboratorio terminan con mensajes legibles y un único intento. Los errores de consultas antes omitidos ya se muestran; los errores de contrato y 4xx permanentes no se reintentan.
- Contraste calculado: primario claro 5,14:1; primario oscuro 7,52:1; texto sobre papel 14,83:1.

La primera pasada de investigación usó Vite en localhost:5173. La comprobación focal final usa una preview compilada en ese mismo puerto, sin HMR, y API de localhost:8000. La regeneración del SDK había propagado un reload del servidor de desarrollo durante una respuesta; servir la preview estable elimina esa causa. La suite integrada de todos los módulos se ejecuta tras reconstruir y desplegar Docker; sus resultados se registran en la entrega de integración. El resultado anterior de 18/18 corresponde a la iteración previa y no se atribuye a este rediseño.

## Límites

Integración final: 28 flujos Chromium validados contra la imagen compilada con
embeddings locales activos (26 de la suite y dos casos repetidos tras actualizar
expectativas de estado/cita). Incluye las dos regresiones de preview/HTML y el
borrador INDEXING→READY. El visor y el chat conservaron la sesión y sus datos.

Las capturas contienen exclusivamente PDFs sintéticos. Extracción, citas, consentimiento y streaming conservan sus contratos reales. Las figuras del visor permiten preguntar con `vision_element_id`; análisis visual cloud requiere autorización específica. La indexación de texto e imágenes sólo se ofrece con Gemini Embedding 2; el perfil local EmbeddingGemma2 es de texto. La ruta de embeddings guardada para workspace o cuenta decide el proveedor, sin forzar envíos a Gemini.

El chunk del workspace conserva PDF.js/Markdown/KaTeX y ocupa aproximadamente 964 KB minificado (290 KB gzip); Vite informa ese tamaño como advertencia, sin fallo de compilación. El shell y los módulos están separados. La prueba controlada de continuidad usa exclusivamente un PDF sintético e intercepta la respuesta SSE, sin enviar datos a proveedores; verifica continuidad de interfaz, no calidad de inferencia. Validar calidad de resúmenes, inferencia local y reconocimiento visual corresponde al backend y a las pruebas de integración, sin presentar capacidades locales no verificadas como disponibles.
