# Informe de fases y aceptación — 2026-10-14

No se declara cobertura completa de cualquier PDF ni de proveedores ausentes.
Se distingue operación real de contratos o recursos pendientes. Los informes
JSON son evidencia reproducible con fixtures sintéticos.

| Fase | Implementación / archivos principales | Migración y verificación | Pendiente |
|---|---|---|---|
| 0 Diagnóstico | ENVIRONMENT_AUDIT; Git, Windows/WSL2, hardware, runtimes, servicios | Repo limpio inicial; base oficial; catálogos reales | Inferencia local pesada evitada por RAM |
| 1 Fundación | config, auth cookie, bootstrap, Compose, init_env/configure_local | Migraciones template + dominio; login; PG18/vector, Redis, reinicio | TLS/reverse proxy para futura exposición pública |
| 2 Documentos/workspaces | domain, routes, storage/local, ResearchDesk | Upload/dedup/hash/download y visor reales | S3 futuro, opcional |
| 3 Ingesta | workers, parsing/pdf/runner/isolated, fixtures | Extracción/tablas; Tesseract Docker; checkpoint reanudado en PG | Docling/HybridChunker requieren artefactos locales |
| 4 Recuperación | providers, rag/retrieval, EmbeddingProfile/Index | Gemini 768; pgvector; FTS/GIN/RRF; filtros y perfiles | HNSW pospuesto por escala; reranker ausente |
| 5 Chat | contracts/providers/routing, rag/chat, ChatPanel | Gemini SSE/historial; Ollama catálogo; selección conserva historial | llama.cpp/OpenAI compatible sin servidor; inferencia Ollama no probada |
| 6 Citas | citations/validation, PdfReader, Citation | IDs reales, fuentes agrupadas, overlay/zoom/rotación/recarga | Word-level y geometrías complejas |
| 7 Multimodal | vision/regions, embed_multimodal, índices por modalidad | Figura interpretada y citada, embeddings texto+imagen, OCR | Docling y fórmulas complejas no probados |
| 8 Investigación | WorkspaceDesk, PrivacyPanel, enrichment, annotations/export | Notas, marcadores/subrayados, cinco preguntas/resumen, JSON/Markdown | Selección visual libre y búsqueda multipágina avanzada |
| 9 Robustez | tests, evaluate_rag/check_restart, logging y docs | Backend/E2E, build Windows/Linux, npm audit, reinicio, límites | Benchmark exhaustivo de 500 páginas, pentest, sandbox completo |

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
| Extracción digital/tablas | Sí | No | PyMuPDF + fixtures | Layout complejo puede requerir Docling |
| Docling/HybridChunker | Adaptador opcional | No | NOT_CONFIGURED | Sin artefactos/tokenizer locales |
| OCR | Sí | No | Tesseract Docker, LUNA-42 | Windows sin Tesseract; scans difíciles pendientes |
| Embeddings Gemini texto | Sí | Sí | Modelo real, 768, PG | Autorización y cuotas |
| Embeddings multimodales | Sí | Sí | Región PNG real, índice separado | Permiso adicional; Embedding 2 |
| FTS/RRF/perfiles | Sí | Sí, proveedor controlado | PostgreSQL/pgvector | Búsqueda exacta; sin reranker |
| Gemini chat/streaming | Sí | Sí | Cinco consultas + E2E | IDs válidos no prueban verdad general |
| Ollama | Sí | Sí, contrato HTTP | Catálogo real | Inferencia NOT_TESTED por memoria |
| llama.cpp/OpenAI compatible | Sí | Sí, contrato HTTP | NOT_CONFIGURED | Servidor/credenciales ausentes |
| VisionProvider | Sí | No | Gemini + cita a la figura | Visión local no probada |
| Citas/zoom/rotación/persistencia | Sí | Sí | PDF/browser reales | Región, no palabra |
| Preguntas/resumen | Sí | No | Gemini + persistencia | Muestra acotada |
| Notas/marcadores/subrayados/export | Sí | No | API + E2E | Subrayado de región |
| Consentimiento/revocación | Sí | Sí | Rechazo E2E + grants explícitos | No recupera envíos anteriores |
| Jobs/checkpoints | Sí | Fallo controlado en test | PG/Celery/parser separado | No sandbox completo del SO |
| Reinicio | Sí | No | Hashes, índices, citas comparados | No simula pérdida de disco |
| RerankProvider | Contrato | No | NOT_CONFIGURED | RRF operativo sin modelo |

Cinco preguntas ES/EN: Recall@8=1, MRR=1, página en primer resultado=1, cobertura
de citas=1, citas inválidas=0. Una pregunta sin información produjo abstención
y cero fuentes. Dataset pequeño, no calidad general. evaluation-results.json
conserva tiempos medidos; restart-results.json conserva verificación del reinicio.
