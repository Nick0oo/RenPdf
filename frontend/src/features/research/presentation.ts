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
