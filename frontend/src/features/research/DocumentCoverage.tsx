import { useQuery } from "@tanstack/react-query"
import type { DocumentPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { formatTime, sourceType } from "@/features/media/location"
import { moduleRequest } from "@/features/trace/api"
import { processingLabel } from "./presentation"

type Coverage = {
  source_type?: string
  duration_seconds?: number | null
  segments_total?: number
  analysis_mode?: string
  segments_prepared?: number
  segments_analyzed?: number
  segments_indexed?: number
  analysis_status?: string
  processing?: {
    kind: string
    state: string
    progress: number
    checkpoint: number
    error_message?: string | null
  } | null
  temporal_precision_seconds?: number
  sheets_total?: number
  sheets_extracted?: number
  cells_total?: number
  cells_with_chunks?: number
  formula_cells?: number
  missing_formula_values?: number
  indexed_chunks?: number
  warnings?: string[]
  pages_total: number
  pages_extracted: number
  ocr_pending_pages: number[]
  figures_total: number
  figures_with_chunks: number
  figures_multimodal_indexed: number
  visual_status: string
}

export function DocumentCoverage({
  document,
  onPrepare,
}: {
  document: DocumentPublic
  onPrepare?: () => void
}) {
  const coverage = useQuery({
    queryKey: [
      "document-coverage",
      document.id,
      document.current_version_id,
      document.active_index_id,
      document.status,
    ],
    queryFn: () =>
      moduleRequest<Coverage>(`/documents/${document.id}/coverage`),
    enabled: !!document.current_version_id || sourceType(document) !== "pdf",
    staleTime: 15000,
    refetchInterval: (query) =>
      document.status === "INDEXING" ||
      ["QUEUED", "RUNNING"].includes(
        query.state.data?.processing?.state ?? "",
      ) ||
      (["audio", "video"].includes(sourceType(document)) &&
        !document.current_version_id)
        ? 3000
        : false,
  })
  if (coverage.isError)
    return (
      <p className="mt-1 text-[11px] text-muted-foreground">
        Cobertura no disponible.
      </p>
    )
  const data = coverage.data
  if (!data) return null
  const processing = data.processing
  const busy = !!processing && ["QUEUED", "RUNNING"].includes(processing.state)
  const nativeCoverage =
    data.analysis_mode === "native_embeddings" ||
    (!data.analysis_mode &&
      !data.segments_analyzed &&
      processing?.kind !== "media_analysis")
  if (sourceType(document) === "spreadsheet")
    return (
      <details
        data-testid="document-coverage"
        className="mt-1 text-[11px] leading-5 text-muted-foreground"
      >
        <summary className="cursor-pointer">
          {data.sheets_extracted ?? 0}/{data.sheets_total ?? 0} hojas ·{" "}
          {data.cells_total ?? 0} celdas
        </summary>
        <p>
          {data.cells_with_chunks ?? 0} celdas consultables ·{" "}
          {data.indexed_chunks ?? 0} fragmentos indexados
        </p>
        <p>
          {data.formula_cells ?? 0} fórmulas ·{" "}
          {data.missing_formula_values ?? 0} sin resultado guardado
        </p>
        <p>Extracción local. Búsqueda por texto con citas de hoja y celda.</p>
        {data.warnings?.map((warning) => (
          <p key={warning}>{warning}</p>
        ))}
      </details>
    )
  if (sourceType(document) !== "pdf")
    return (
      <details
        open={busy || processing?.state === "FAILED" || undefined}
        data-testid="document-coverage"
        className="mt-1 text-[11px] leading-5 text-muted-foreground"
      >
        <summary className="cursor-pointer">
          {nativeCoverage
            ? (data.segments_indexed ?? 0)
            : (data.segments_analyzed ?? 0)}
          /{data.segments_total ?? 0} segmentos{" "}
          {nativeCoverage ? "indexados" : "analizados"}
        </summary>
        {processing && (
          <div role="status" className="mt-1 space-y-1">
            <p
              className={
                processing.state === "FAILED"
                  ? "text-destructive"
                  : "font-medium text-primary"
              }
            >
              {processingLabel(processing.kind, processing.state)} ·{" "}
              {processing.progress}%
            </p>
            {busy && (
              <progress
                className="h-1 w-full accent-primary"
                value={processing.progress}
                max={100}
                aria-label="Progreso de preparación de la fuente"
              />
            )}
            {processing.state === "QUEUED" && (
              <p>Esperando un procesador disponible.</p>
            )}
            {processing.error_message && (
              <p className="text-destructive">{processing.error_message}</p>
            )}
          </div>
        )}
        {nativeCoverage && (
          <p>
            Embeddings nativos · {data.segments_prepared ?? 0} segmentos
            preparados. La transcripción es opcional.
          </p>
        )}
        <p>
          {formatTime(data.duration_seconds)} · {data.segments_indexed ?? 0}{" "}
          segmentos indexados
        </p>
        <p>
          Precisión: intervalos de {data.temporal_precision_seconds ?? 10}s.
        </p>
        {!document.current_version_id && onPrepare && !busy && (
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0"
            onClick={onPrepare}
          >
            Preparar fuente
          </Button>
        )}
      </details>
    )
  return (
    <details
      data-testid="document-coverage"
      className="mt-2 flex flex-col gap-1 text-[11px] leading-5 text-muted-foreground"
    >
      <summary className="cursor-pointer">
        {data.pages_extracted}/{data.pages_total} páginas extraídas ·{" "}
        {data.figures_total} regiones visuales
      </summary>
      {data.figures_total > 0 && (
        <>
          <p>
            {data.figures_multimodal_indexed}/{data.figures_total} con embedding
            visual · {data.figures_with_chunks}/{data.figures_total} con
            referencias consultables
          </p>
          <p>
            El chat lee las regiones recuperadas con un modelo de visión y sus
            permisos.
          </p>
        </>
      )}
      {data.ocr_pending_pages.length > 0 && (
        <p className="font-medium">
          OCR pendiente: páginas {data.ocr_pending_pages.join(", ")}
        </p>
      )}
      {data.visual_status === "REINDEX_REQUIRED" && (
        <>
          <p className="font-medium">
            Hay imágenes sin referencias de búsqueda. Renueva el índice.
          </p>
          {onPrepare && (
            <Button
              variant="link"
              size="sm"
              className="h-auto justify-start p-0"
              onClick={onPrepare}
            >
              Preparar imágenes
            </Button>
          )}
        </>
      )}
    </details>
  )
}
