# Skills compartidas de RenPdf

Estas seis skills se incluyen como carpetas completas en `.agents/skills/` y
se versionan con el proyecto. Al clonar el repositorio también se reciben sus
instrucciones y archivos de referencia.

| Carpeta | Uso | Fuente |
| --- | --- | --- |
| `frontend-design` | Dirección visual, tipografía, color y composición | Copia de la instalación personal existente, con licencia Apache-2.0 |
| `shadcn` | Componentes, formularios y composición de interfaces | [shadcn-ui/ui](https://github.com/shadcn-ui/ui) |
| `vercel-react-best-practices` | Buenas prácticas y rendimiento de React | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) |
| `fastapi` | APIs, Pydantic, dependencias y convenciones de FastAPI | [fastapi/fastapi](https://github.com/fastapi/fastapi) |
| `domain-modeling` | Conceptos, reglas y vocabulario del negocio | [mattpocock/skills](https://github.com/mattpocock/skills) |
| `architecture-patterns` | Separación de lógica, capas y módulos | [wshobson/agents](https://github.com/wshobson/agents) |

## Uso

Codex descubre las skills locales en `.agents/skills/`, según su
[documentación oficial](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).
Estarán disponibles desde el siguiente turno; si no aparecen, reinicia Codex.
Se aplican cuando corresponden al trabajo solicitado. La arquitectura y las
dependencias de RenPdf siguen siendo la referencia del proyecto.

## Compartir

- Con GitHub: comparte el repositorio o esta carpeta `.agents`.
- Sin GitHub: comprime la carpeta `.agents` y extráela en la raíz del otro proyecto.
- Conserva las carpetas completas, incluidos `SKILL.md`, referencias y licencias.

Estas son copias de archivos, sin enlaces a carpetas personales del equipo.
Las skills instaladas globalmente en el perfil de una persona no se incluyen
automáticamente al compartir un repositorio.

## Versiones y atribución

[skills-sources.json](skills-sources.json) registra los repositorios, commits y
rutas originales de las copias descargadas. Para `frontend-design`, conserva las
huellas SHA-256 de la instalación personal copiada. Las licencias originales se
conservan en `LICENSE.upstream` o `LICENSE.txt`; la skill de Vercel declara MIT
en su propio `SKILL.md`.
Al actualizar una skill, conserva sus referencias y registra la nueva revisión.
