# Informe de fases y aceptación — 2026-10-14

No se declara cobertura completa de cualquier PDF ni de proveedores ausentes.
Se distingue operación real de contratos o recursos pendientes. Los informes
JSON son evidencia reproducible con fixtures sintéticos.

| Fase | Implementación / archivos principales | Migración y verificación | Pendiente |
|---|---|---|---|
| 0 Diagnóstico | ENVIRONMENT_AUDIT; Git, Windows/WSL2, hardware, runtimes, servicios | Base oficial; catálogos e inferencia CPU real | Sin benchmark de carga general |
| 1 Fundación | config, auth cookie, bootstrap, Compose, init_env/configure_local | Migraciones template + dominio; login; PG18/vector, Redis, reinicio e inicio en volumen nuevo aislado | TLS/reverse proxy para futura exposición pública |
| 2 Documentos/workspaces | domain, routes, storage/local, ResearchDesk | Upload/dedup/hash/download y visor reales | S3 futuro, opcional |
| 3 Ingesta | workers, parsing/docling/pdf/runner/isolated, fixtures | Docling Native + HybridChunker offline, tabla/figura/crop; parser caliente reciclado; Tesseract; checkpoints PG | Layout neuronal avanzado sin pesos |
| 4 Recuperación | providers, rag/retrieval, EmbeddingProfile/Index | Gemini y EmbeddingGemma2 CPU 768 en pgvector; FTS estricto/OR; RRF; filtros/perfiles | HNSW pospuesto por escala; reranker ausente |
| 5 Chat | contracts/providers/routing, rag/chat, ChatPanel | Gemini y Ollama SSE/persistencia; resumen general con aviso de muestra y citas | Visión local y OpenAI compatible externo pendientes |
| 6 Citas | citations/validation, PdfReader, Citation | IDs reales, fuentes agrupadas, overlay/zoom/rotación/recarga | Word-level y geometrías complejas |
| 7 Multimodal | vision/regions, embed_multimodal, índices por modalidad | Figura interpretada y citada, embeddings texto+imagen Gemini, OCR y regiones Docling | Fórmulas complejas y torres locales no probadas |
| 8 Investigación | WorkspaceDesk, PrivacyPanel, enrichment, annotations/export | Notas, marcadores/subrayados, cinco preguntas/resumen, JSON/Markdown | Selección visual libre y búsqueda multipágina avanzada |
| 9 Robustez | tests, evaluate_rag/evaluate_local/check_restart, assetRecovery, docs | 115 backend/18 E2E, build Windows/Linux, audit, reinicio, recuperación acotada; diseño shadcn | Benchmark 500 páginas, pentest, sandbox completo |

Migraciones: `19ef30d98c01` y `7d81a5e050a2`. ADR en DECISIONS.md. La base Windows
no se migró; el volumen Docker original se conservó. Credenciales nuevas sólo en
.env local. Pytest usa una base dedicada con guardia contra teardown personal.

Se corrigieron: expectativas de registro público del template, lockfile sin
bindings Linux, FileList invalidado al limpiar el input, fuentes agrupadas por
Gemini, cita de caption en vez de imagen, preguntas sin esquema JSON y selección
de pruebas UI heredadas incompatible con la cuenta personal.

| Funcionalidad | Implementada | Probada con mocks | Probada realmente | Limitación |
|---|---|---|---|---|
| Auth personal/cookie/registro desactivado | Sí | No | Pytest + browser | Cuenta bootstrap |
| Workspaces/filtros | Sí | No | PG + E2E | Sin multi-tenant |
| PDF/miniatura | Sí | No | Upload/hash/visor | 50 MB / 500 páginas configuradas |
| Extracción digital/tablas | Sí | No | Docling Native + PyMuPDF + fixtures | Layout complejo puede requerir pesos neuronales |
| Docling/HybridChunker | Sí, base slim | No | Conversión y chunking offline; Docker/HTTP | Pipeline neuronal avanzado sin artefactos |
| OCR | Sí | No | Tesseract Docker, LUNA-42 | Windows sin Tesseract; scans difíciles pendientes |
| Embeddings Gemini texto | Sí | Sí | Modelo real, 768, PG | Autorización y cuotas |
| Embeddings multimodales | Sí | Sí | Región PNG real, índice separado | Permiso adicional; Embedding 2 |
| FTS/RRF/perfiles | Sí | Sí, proveedor controlado | PostgreSQL/pgvector; consultas naturales y resumen | Búsqueda exacta; sin reranker |
| Gemini chat/streaming | Sí | Sí | Cinco consultas + E2E | IDs válidos no prueban verdad general |
| Ollama | Sí | Sí, contrato HTTP | Gemma4 CPU, fixture y PDF personal con citas | Latencia CPU; visión local no probada |
| llama.cpp | Sí, instalado CPU | Sí, contrato HTTP | EmbeddingGemma2 Q8_0, 768, índice/consulta real | Sólo texto embeddings, sin torres multimodales |
| OpenAI compatible externo | Adaptador | Sí, contrato HTTP | NOT_CONFIGURED | Sin servidor externo |
| VisionProvider | Sí | No | Gemini + cita a la figura | Visión local no probada |
| Citas/zoom/rotación/persistencia | Sí | Sí | PDF/browser reales | Región, no palabra |
| Preguntas/resumen | Sí | No | Gemini + persistencia | Muestra acotada |
| Notas/marcadores/subrayados/export | Sí | No | API + E2E | Subrayado de región |
| Consentimiento/revocación | Sí | Sí | Rechazo E2E + grants explícitos | No recupera envíos anteriores |
| Jobs/checkpoints | Sí | Fallo controlado en test | PG/Celery/parser separado | No sandbox completo del SO |
| Reinicio | Sí | No | Hashes, índices, citas comparados | No simula pérdida de disco |
| Navegación/chat/shadcn | Sí | No | Desktop/móvil, acceso directo, histórico, permisos | Bundle PDF/Markdown grande |
| Recuperación de assets | Sí | Fallo HTTP controlado en browser | Una recarga automática, sesión y biblioteca | Captura Error/Oops original no reproducida |
| RerankProvider | Contrato | No | NOT_CONFIGURED | RRF operativo sin modelo |

Cinco preguntas ES/EN: Recall@8=1, MRR=1, página en primer resultado=1, cobertura
de citas=1, citas inválidas=0. Una pregunta sin información produjo abstención
y cero fuentes. Dataset pequeño, no calidad general. evaluation-results.json
conserva tiempos medidos; restart-results.json conserva verificación del reinicio.

Verificación final: 115 tests de backend y 18 tests Chromium aprobados; Ruff,
ty, Biome y build de producción Docker aprobados. La auditoría npm de dependencias
de producción informó cero vulnerabilidades. El reinicio conservó ocho PDFs,
sus hashes e índices activos y trece conversaciones con sus citas. La evaluación
real de Gemini volvió a comprobar OCR, visión de la figura y embeddings multimodales.

La evaluación HTTP totalmente local extrajo el fixture en 11,52 s, indexó 16
vectores en 4,63 s y respondió el dato esperado con una cita en 40,44 s usando
Ollama. local-evaluation-results.json conserva parser, perfiles y tiempos.
La pregunta general de la captura se corrigió con muestreo de páginas y aviso
persistido de cobertura parcial; no se declara un resumen exhaustivo del documento.
El audit frontend está en DESIGN_AUDIT.md; skill frontend-design instalada localmente.
