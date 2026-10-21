export type SourceType = "pdf" | "audio" | "video" | "spreadsheet"

type Location = {
  source_type?: string | null
  page_number?: number | null
  start_seconds?: number | null
  end_seconds?: number | null
  sheet_name?: string | null
  cell_range?: string | null
}

export function sourceType(source?: {
  source_type?: string | null
}): SourceType {
  return source?.source_type === "audio" ||
    source?.source_type === "video" ||
    source?.source_type === "spreadsheet"
    ? source.source_type
    : "pdf"
}

export function formatTime(seconds?: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—"
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const remaining = String(total % 60).padStart(2, "0")
  return `${String(minutes).padStart(2, "0")}:${remaining}`
}

export function sourceLocation(source: Location): string {
  if (sourceType(source) === "spreadsheet" || source.sheet_name)
    return (
      [source.sheet_name, source.cell_range].filter(Boolean).join(" · ") ||
      "Hoja de cálculo"
    )
  if (sourceType(source) !== "pdf" || source.start_seconds != null) {
    const start = formatTime(source.start_seconds)
    return source.end_seconds != null &&
      source.end_seconds !== source.start_seconds
      ? `${start}–${formatTime(source.end_seconds)}`
      : start
  }
  return source.page_number != null
    ? `p. ${source.page_number}`
    : "Sin ubicación"
}
