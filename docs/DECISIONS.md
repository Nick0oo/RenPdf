# Decisiones arquitectónicas (ADR)

1. **Conservar la base existente.** La raíz no estaba vacía y ya provenía del
   template oficial. Se extiende su auth/router/SQLModel/OpenAPI; no se clona encima.
2. **Bases y rol dedicados.** Hay PostgreSQL Windows y un volumen Docker existente.
   Se crean renpdf_chat y renpdf_chat_test con rol renpdf_app; no se migra Windows
   ni se cambia el password administrativo de su contenedor preexistente.
3. **npm + Biome + ty.** El template actual usa Bun/Biome/ty además de Mypy. La
   petición exige npm, así que se genera un lock portable y se conserva bun.lock
   como referencia. Biome cumple el lint frontend sin introducir ESLint paralelo.
   ty es el checker activo: los bindings PyMuPDF/Celery carecen de stubs completos
   y Mypy strict detectó anotaciones pendientes; no se oculta ese resultado.
4. **Docling nativo sin pesos.** La base incluye docling-slim 2.139.0 y
   NativePdfPipeline, comprobado offline. HybridChunker usa presupuesto UTF-8
   conservador; un tokenizer local es opcional. El pipeline avanzado con modelos
   de layout sigue opt-in; no se instalaron Torch ni sus pesos. Tablas nativas
   se complementan con estructura real PyMuPDF, sin atribuirle inferencia neural.
5. **EXTRACTED separado de READY.** Consentimiento no se infiere al subir. La
   biblioteca funciona sin AI; índice semántico requiere activación explícita y
   verificación de conteo/dimensiones. OCR pendiente produce DEGRADED.
6. **Vectores por índice/perfil.** Vector de dimensión variable, perfil inmutable
   y búsqueda exacta con filtros; reindexar no borra el anterior. HNSW se pospone
   hasta justificar escala y construir índices parciales por dimensión/perfil.
7. **Batch Gemini 2 independiente.** Una llamada por fragmento evita agregación
   de partes en un único vector. Prefijos query/document según documentación.
8. **Citas por elementos.** El modelo produce referencias controladas; el servidor
   deriva página/versión/bbox de FK y valida IDs antes de done/persistencia.
9. **Outbox de jobs en PostgreSQL.** Redis sólo transporta. Beat recupera pendientes;
   checkpoint por página y advisory lock resisten redelivery/reinicio.
10. **Filesystem primero.** Interfaz StorageBackend; sin MinIO obligatorio.
    Integración S3 no se simula ni se declara implementada.
11. **Cookie personal.** JWT HttpOnly/SameSite strict evita persistirlo en JS. Bearer
    continúa para CLI/tests; CORS/Origin y loopback limitan superficie local.
12. **Sin fallback cloud ni telemetría.** Cuatro alcances expiran/revocan por documento;
    la recuperación léxica es una degradación visible y nunca cambia proveedor.
13. **EmbeddingGemma 2 de texto en CPU.** Ollama 0.34.4 rechazó la variante
    solicitada por exigir actualización. Se preservó ese runtime y se instaló
    llama.cpp CPU b11624 con GGUF oficial Q8_0 (~310 MB). El perfil usa SHA256 y
    dimensión de salida medida (768), en vez de la dimensión interna anunciada (512).
    No se descargaron torres multimodales ni otro modelo generativo pesado.
14. **Acceso directo y controles compartidos.** Chatear con PDF reutiliza workspace
    e historial, abre chat primero en móvil y agrupa ajustes en panel shadcn.
    La recuperación de assets permite una recarga por bundle; un fallo persistente
    conserva una salida a biblioteca y no borra la sesión HttpOnly.
