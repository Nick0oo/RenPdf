export function documentStatus(status: string): string {
  return (
    {
      UPLOADED: "Guardado",
      QUEUED: "En cola",
      PROCESSING: "Extrayendo texto",
      EXTRACTED: "Texto disponible",
      DEGRADED: "Extracción parcial",
      INDEXING: "Preparando índice",
      READY: "Listo para consultar",
      MEDIA_READY: "Lista para indexar",
      NATIVE_QUEUED: "Indexación nativa en cola",
      NATIVE_PREPARING: "Preparando segmentos nativos",
      ANALYSIS_QUEUED: "Análisis en cola",
      ANALYZING: "Analizando contenido",
      ANALYSIS_FAILED: "El análisis necesita revisión",
      FAILED: "Necesita revisión",
      CANCELLED: "Cancelado",
    }[status] ?? status
  )
}

export function chatDate(date: string): string {
  return new Intl.DateTimeFormat("es", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date))
}

export function processingLabel(kind: string, state: string): string {
  const task =
    {
      extract: "Extracción",
      media_analysis: "Análisis de audio/video",
      native_prepare: "Preparación nativa",
      index: "Índice",
      questions: "Preguntas",
      summary: "Resumen",
    }[kind] ?? kind
  const status =
    {
      QUEUED: "En cola",
      RUNNING: "En curso",
      SUCCEEDED: "Completado",
      FAILED: "Falló",
      CANCELLED: "Cancelado",
    }[state] ?? state
  return `${task}: ${status}`
}
