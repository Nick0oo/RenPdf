# Limitaciones conocidas

- Docling/HybridChunker y OCR avanzado no se probaron con pesos locales. La ruta
  ligera conserva geometría, tablas y figuras; layouts académicos muy complejos
  pueden requerir Docling y revisión. Tesseract Windows no estaba disponible;
  Docker incluye idiomas eng/spa. No se afirma cobertura universal de OCR.
- Ollama: servidor y catálogo verificados; generación/embeddings/visión de gemma4
  no probados por memoria disponible y prohibición de iniciar modelos grandes.
  llama.cpp/OpenAI compatible no configurados: adaptadores presentes, integración
  real pendiente. No hay un modelo local de embeddings verificado.
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
