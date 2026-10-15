# Limitaciones conocidas

- Docling NativePdfPipeline y HybridChunker se ejecutaron realmente sin modelos:
  texto, figuras, tablas complementadas por PyMuPDF y CropBox/rotación verificados.
  El chunker utiliza un presupuesto UTF-8 conservador sin descargar tokenizer.
  El pipeline avanzado de layout/lectura/OCR neuronal sigue sin pesos locales.
  Layouts académicos complejos pueden requerir esos modelos y revisión. Tesseract Windows no estaba disponible;
  Docker incluye idiomas eng/spa. No se afirma cobertura universal de OCR.
- Ollama: generación real de gemma4:e2b y una respuesta sobre el PDF personal
  con citas persistidas verificadas; visión local no probada. CPU con dos
  hilos, contexto limitado y keep_alive=0. Embeddings locales verificados con
  EmbeddingGemma 2 Q8_0 de texto en llama.cpp; no se cargaron sus torres multimodales.
  Ollama 0.34.4 rechazó la variante oficial EmbeddingGemma 2 por exigir actualización;
  el runtime existente no se actualizó. OpenAI compatible externo sigue sin servidor.
- La extracción histórica por líneas necesita ventanas de contexto para los
  resúmenes. Se verificó el resumen por HTTP con nueve citas; son fragmentos de
  ocho páginas, no una revisión exhaustiva de las 72 páginas. Tardó 166,18 s
  en CPU; el índice de 1.733 fragmentos tardó 525,99 s. El equipo puede ejecutarlo,
  pero esas latencias no ofrecen interacción instantánea ni garantizan rendimiento general.
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
- RAG indexa el contenido extraído de todas las páginas; cada respuesta usa los
  fragmentos recuperados y su contexto vecino. Indexar todo no equivale a enviar
  el PDF completo en cada prompt. El resumen general conserva aviso de muestra parcial.
- La factura real quedó indexada localmente con 33 vectores. La recuperación de
  una pregunta doble incluyó fecha e importe; Gemma4 local respondió el mes pero
  omitió el importe en dos intentos. Un índice correcto no garantiza que ese modelo
  pequeño responda todas las partes; invoice-local-check.json registra esa limitación.
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
- Studio organiza páginas y transforma copias; no implementa edición de texto,
  firmas ni redacción segura. CropBox sólo cambia el área visible. Se limita a
  30 fuentes, 50 MB totales y 500 páginas de salida; no promete conservar firmas
  ni todos los metadatos/marcadores del original.
- Laboratorio conserva respuestas separadas por fuente; no es un detector automático
  de contradicciones. Estudio registra autoevaluación manual, sin notas inventadas
  de un modelo ni generación automática de fichas.
- La telemetría se registra para ejecuciones nuevas. El historial anterior no
  contiene necesariamente tokens, tiempos o política efectiva. No se reconstruyen
  esos datos como si se hubieran medido.
- El chunk de workspace incorpora PDF.js/Markdown/KaTeX y ronda 962 KB sin comprimir.
  Los módulos adicionales se cargan a demanda; queda pendiente reducir ese chunk.

Estos puntos impiden afirmar que todas las capacidades del superprompt están
completas. La matriz de aceptación distingue pruebas reales, contractuales y
pendientes; cualquier ampliación debe mantener persistencia/consentimiento/citas.
