# Auditoría de diseño y navegación

Skill aplicada: [frontend-design de Anthropic](https://github.com/anthropics/skills/tree/main/skills/frontend-design), instalada en `C:/Users/ASUS/.codex/skills/frontend-design/SKILL.md`.

## Plan y revisión del brief

RenPdf es un escritorio de lectura y conversación documental. La tarea principal es abrir un PDF, preguntar y volver a su evidencia. La biblioteca debe mostrar archivos y chats; los ajustes se abren cuando hacen falta.

- Color: papel `#FFFFFF`, tinta `#192B27`, acento de evidencia `#087B71`, superficie `#F4F7F6`, borde `#DDE5E1`, error `#B42318`. Tema oscuro mantiene superficies tranquilas y un acento con contraste suficiente.
- Tipo: Segoe UI para lectura e interfaz en Windows, con fuentes locales de sistema como alternativa; KaTeX para matemáticas. Jerarquía de 24/20/16/14/12 px y texto de respuesta con interlineado amplio. Sin descargar fuentes.
- Distribución: biblioteca de documentos y acceso directo al chat; escritorio con PDF y conversación; fuentes, privacidad y notas en un panel lateral con pestañas. Alineación izquierda para contenido y controles.
- Principios: cada acción dice lo que hará; un único selector compartido; el color señala selección y citas; los estados explican qué falta y dónde resolverlo.

```text
Biblioteca → Chatear con PDF → [ PDF | conversación + pregunta ]
                             ↳ Fuentes / Privacidad / Notas
```

La primera revisión descartó ampliar el hero y añadir decoración. La app necesita un escritorio útil, no más elementos de promoción. También se sustituyeron rótulos en mayúsculas y ajustes mezclados en el contenido por nombres claros y controles agrupados.

## Problemas encontrados y cambios

| Antes | Cambio |
| --- | --- |
| Importar no ofrecía una entrada directa al chat. | Chatear con PDF abre o reutiliza el proyecto y su conversación. |
| En móvil se abría el visor y quedaba oculto el inicio del chat. | Entrada en chat; pestaña Documento para consultar el PDF. |
| Historial en un selector pequeño y nuevo chat representado solo con `+`. | Conversaciones con título y fecha; botón Nuevo chat. |
| Selectores y casillas nativos mezclados con componentes shadcn. | ChoiceSelect y ProviderModelSelect reutilizables; controles shadcn. |
| Fuentes, índice, permisos y notas formaban un bloque largo. | Panel lateral con pestañas por propósito. |
| Respuestas, citas y acciones tenían poca separación. | Jerarquía de mensaje, citas de página y compositor más legibles. |
| Errores de permiso no ofrecían una salida cercana. | Acción para abrir los permisos del proveedor usado en el chat. |
| Botones de resumen/reprocesado estaban dentro de un `select`, HTML inválido. | Herramientas del documento en su sección. |

## Verificación

- `npm run typecheck` y `npm run build`: aprobados.
- Biome de módulos de investigación, modelos, chat, estilos y pruebas modificadas: aprobado sin advertencias.
- Playwright final: 18/18 aprobados juntos contra la imagen de producción en localhost:8000, incluido setup, recuperación de assets, sesión HttpOnly, acceso directo y flujo de investigación con Gemini sintético.
- Entrada directa, reapertura sin duplicar chat, nuevo chat, selección de modelo shadcn, permisos en panel lateral, notas persistidas y viewport móvil de 390 px comprobados con PDFs sintéticos.
- Revisión visual de escritorio claro y móvil oscuro; las capturas viven en carpetas de resultados ignoradas por Git. Se recortó el estado vacío para que las sugerencias queden visibles junto al compositor.
- Contraste calculado: botón primario claro 5,14:1; primario oscuro 7,52:1; texto sobre papel 14,83:1. Se respeta `prefers-reduced-motion`.
- La revisión inicial usó localhost:5173; la verificación final y sus capturas usan el frontend compilado y la API de localhost:8000 después de reconstruir/desplegar Docker.

## Límites

El audit usa documentos sintéticos para capturas. La lectura de PDFs privados sigue sujeta a extracción disponible y los envíos a la nube a autorización explícita. El índice usa la ruta de embeddings guardada para el proyecto o la cuenta; el perfil local no activa envíos a Gemini. No se añadieron funciones de producto ni fuentes, imágenes o modelos externos como parte del diseño. El visor y Markdown/PDF.js conservan un bundle grande; esta pasada no pretende resolver su división en paquetes. La validación completa de inferencia local y resúmenes generales corresponde al backend desplegado.
