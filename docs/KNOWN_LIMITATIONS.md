# Limitaciones conocidas

- Docling NativePdfPipeline y HybridChunker se ejecutaron realmente sin modelos:
  texto, figuras, tablas complementadas por PyMuPDF y CropBox/rotación verificados.
  El chunker utiliza un presupuesto UTF-8 conservador sin descargar tokenizer.
  El pipeline avanzado de layout/lectura/OCR neuronal sigue sin pesos locales.
  Layouts académicos complejos pueden requerir esos modelos y revisión. Tesseract Windows no estaba disponible;
  Docker incluye idiomas eng/spa. No se afirma cobertura universal de OCR.
- Ollama: generación real de gemma4:e2b y una respuesta sobre el PDF personal
  con tres citas persistidas verificadas; visión local no probada. CPU con dos
  hilos, contexto limitado y keep_alive=0. Embeddings locales verificados con
  EmbeddingGemma 2 Q8_0 de texto en llama.cpp; no se cargaron sus torres multimodales.
  Ollama 0.34.4 rechazó la variante oficial EmbeddingGemma 2 por exigir actualización;
  el runtime existente no se actualizó. OpenAI compatible externo sigue sin servidor.
- Reranking tiene contrato y estado NOT_CONFIGURED. No existe reranker ficticio.
  Se usa RRF sin puntuaciones inventadas de un modelo.
- Embeddings multimodales directos implementados para Gemini Embedding 2 con
  consentimiento adicional `multimodal_embeddings`. La visión recibe regiones
  renderizadas con su evidencia; las tablas conservan filas/celdas y figuras su
  región. Fórmulas se conservan en texto o imagen sin reconstrucción LaTeX inventada.
- No selección visual libre con arrastre; se seleccionan regiones detectadas.
  Notas, marcadores y subrayado de región se crean en UI; no se promete precisión de palabra. Búsqueda del visor
  se limita a la página actual y texto extraído; no hay thumbnails de todas las páginas.
- Historia completa se conserva. El contexto enviado al modelo usa preguntas
  previas acotadas, no todas las respuestas históricas ni PDFs completos.
- Presupuestos/timeouts son configurables; no hay cuotas mensuales acumuladas,
  fallback automático, reranker, billing, SaaS ni multi-tenant.
- Límite configurado 500 páginas/50 MB no equivale a benchmark de cualquier PDF.
  Falta prueba de carga exhaustiva, sandbox completo de SO y validación visual de todos
  los CropBox/MediaBox posibles. PDF.js carga una página y rendering bajo demanda.
- Word-level citations no se afirman. IDs válidos verifican trazabilidad, no verdad
  factual del LLM. Las métricas pequeñas sintéticas no equivalen a calidad general.
- Storage S3 y original_pdf a cloud quedan preparados, no implementados. No se
  exportan secretos ni el PDF original a proveedores.
- Mypy strict no pasa todavía; ty/Ruff y TypeScript son las verificaciones mantenidas.
  El template conserva módulos admin/items y sus tests, aunque no aparecen en la
  navegación de investigación. Flujos de email requieren configurar SMTP.

Estos puntos impiden afirmar que todas las capacidades del superprompt están
completas. La matriz de aceptación distingue pruebas reales, contractuales y
pendientes; cualquier ampliación debe mantener persistencia/consentimiento/citas.
