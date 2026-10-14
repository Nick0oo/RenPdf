# Auditoría del entorno — 2026-10-14

## Verificación posterior con autorización local

El diagnóstico inicial de abajo conserva lo encontrado al comenzar. Después de
la autorización del usuario se instalaron EmbeddingGemma 300M (622 MB, Ollama)
y EmbeddingGemma 2 Q8_0 de texto (310 MB, llama.cpp CPU b11624). La cuenta usa
el segundo para embeddings; no se descargó otro modelo generativo pesado.
Ollama 0.34.4 requiere actualización para su variante EmbeddingGemma 2; ese
runtime se conservó. El servidor llama.cpp escucha loopback 8081, sin CUDA.

Docling slim 2.139.0 y HybridChunker se comprobaron realmente sin Torch ni pesos
neuronales. El pipeline nativo, tablas, figuras y geometría CropBox/rotación
pasaron pruebas offline. El flujo HTTP sintético verificó extracción en 11,52 s,
indexación de 16 vectores de 768 dimensiones en 4,63 s y chat híbrido Ollama
con respuesta correcta/cita en 40,44 s. Son mediciones puntuales de este equipo,
sin garantía de latencia ni medición del pico de RAM. El modelo gemma4:e2b
preexistente también respondió sobre el PDF personal usando CPU y citas persistidas.
Visión local y pipeline neuronal avanzado continúan pendientes.

## Diagnóstico inicial

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
