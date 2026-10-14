# Auditoría del entorno — 2026-10-14

Repositorio limpio al iniciar. Base: `372dbcb` (importación del Full Stack FastAPI
Template oficial); adaptación preexistente `1c32e668065d7e5490263d90e75eb4b7cdb9fcba`.
Se conserva el template; no se vuelve a clonar sobre los archivos existentes.

| Recurso | Resultado observado |
|---|---|
| Sistema | Windows 11 Pro; PowerShell; WSL2 Docker Desktop activo, Ubuntu detenido |
| CPU | Ryzen 7 7730U, 8 núcleos / 16 hilos |
| RAM | 15.4 GiB total; aproximadamente 451 MiB libres en primera lectura |
| GPU | AMD Radeon integrada, 512 MiB declarados; sin NVIDIA/CUDA |
| Python | 3.14.6 activo; 3.12.7 y 3.13.9 también instalados |
| uv | 0.9.5 |
| Node / npm | 24.18.0 / 12.0.2 |
| Git | disponible, remoto Nick0oo/RenPdf |
| Docker / Compose | 27.5.1 / 2.32.4; daemon accesible |
| PostgreSQL Windows | 17.4, base renpdf, vector 0.8.7, migración b8c14e53a902 |
| PostgreSQL Docker | contenedor renpdf-db-1, pgvector 0.8.7 / PG18, puerto 5433 |
| Redis | no estaba configurado; se añade instancia dedicada |
| Ollama | /api/tags accesible; gemma4:e2b, 7.16 GB; completion/vision declaradas |
| llama.cpp | /health en 8080 no accesible; no se instala |
| Gemini | ausente al primer diagnóstico; el usuario añadió una clave durante el trabajo |
| API / frontend | no estaban ejecutándose |

No se imprimieron variables secretas. No se migrará ni borrará la base PostgreSQL
Windows. Las pruebas utilizarán una base dedicada terminada en `_test`. No se
descargan pesos ni se carga gemma4 durante la auditoría. La disponibilidad de un
catálogo no verifica inferencia, embeddings ni visión.

El template actual usa Bun y Biome. Por petición explícita se habilita npm con
package-lock.json; se conserva bun.lock como referencia de la base. Se mantiene
Biome en vez de incorporar un segundo linter equivalente. Véase DECISIONS.md.

Fuentes consultadas: [template](https://github.com/fastapi/full-stack-fastapi-template),
[desarrollo oficial](https://raw.githubusercontent.com/fastapi/full-stack-fastapi-template/master/development.md),
[Gemini embeddings](https://ai.google.dev/gemini-api/docs/embeddings),
[SDK](https://googleapis.github.io/python-genai/),
[Docling](https://docling-project.github.io/docling/usage/advanced_options/),
[Ollama](https://docs.ollama.com/api/introduction),
[llama.cpp](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md),
[React-PDF](https://github.com/wojtekmaj/react-pdf),
[pgvector](https://github.com/pgvector/pgvector).
