import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { sourceLocation } from "@/features/media/location"
import { errorMessage } from "@/features/research/api"
import { moduleRequest } from "./api"

type Fragment = {
  id?: string
  chunk_id?: string
  label?: number
  document_title?: string
  page_number: number | null
  source_type?: string
  document_id?: string
  start_seconds?: number | null
  end_seconds?: number | null
  sheet_name?: string | null
  cell_range?: string | null
  analysis?: Record<string, unknown>
  text: string
  contextualized_text?: string
  kind: string
  score?: number
}
type Result = {
  query?: string
  sources?: Fragment[]
  data?: Fragment[]
  total?: number
}

export function RagInspector({
  messageId,
  documentId,
  sourceType = "pdf",
  workspaceId,
}: {
  messageId?: string
  documentId?: string
  sourceType?: string
  workspaceId?: string
}) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState("")
  const [sheet, setSheet] = useState("")
  const [offset, setOffset] = useState(0)
  const params = new URLSearchParams({ limit: "20", offset: String(offset) })
  const spreadsheet = sourceType === "spreadsheet"
  const validReference =
    !spreadsheet ||
    !page ||
    /^\$?[A-Za-z]{1,3}\$?[1-9]\d*(?::\$?[A-Za-z]{1,3}\$?[1-9]\d*)?$/.test(page)
  if (page && validReference)
    params.set(
      spreadsheet ? "cell" : sourceType === "pdf" ? "page" : "second",
      page,
    )
  if (sheet) params.set("sheet", sheet)
  const result = useQuery({
    queryKey: [
      "rag-inspector",
      messageId,
      documentId,
      sourceType,
      page,
      sheet,
      offset,
    ],
    queryFn: () =>
      moduleRequest<Result>(
        messageId
          ? `/trace/responses/${messageId}/context`
          : `/trace/documents/${documentId}/chunks?${params}`,
      ),
    enabled: open && validReference && !!(messageId || documentId),
  })
  const fragments = validReference
    ? (result.data?.sources ?? result.data?.data ?? [])
    : []
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open
          ? "Ocultar fragmentos"
          : messageId
            ? "Inspeccionar contexto RAG"
            : "Explorar chunks del documento"}
      </Button>
      {open && (
        <>
          {documentId && (
            <div className="grid gap-2 sm:grid-cols-2">
              {spreadsheet && (
                <Input
                  aria-label="Filtrar chunks por hoja"
                  placeholder="Todas las hojas (nombre exacto)"
                  value={sheet}
                  onChange={(event) => {
                    setSheet(event.target.value)
                    setOffset(0)
                  }}
                />
              )}
              <Input
                type={spreadsheet ? "text" : "number"}
                min={spreadsheet ? undefined : sourceType === "pdf" ? 1 : 0}
                aria-label={
                  spreadsheet
                    ? "Filtrar celdas por referencia"
                    : sourceType === "pdf"
                      ? "Filtrar chunks por página"
                      : "Filtrar segmentos por segundo"
                }
                placeholder={
                  spreadsheet
                    ? "Todas las celdas (B2 o B2:C8)"
                    : sourceType === "pdf"
                      ? "Todas las páginas"
                      : "Todos los intervalos (segundos)"
                }
                value={page}
                onChange={(event) => {
                  setPage(event.target.value)
                  setOffset(0)
                }}
              />
            </div>
          )}
          {!validReference && (
            <p role="alert" className="text-xs text-destructive">
              Usa una referencia como B2 o B2:C8.
            </p>
          )}
          {result.isPending && (
            <p role="status" className="text-xs">
              Cargando fragmentos…
            </p>
          )}
          {result.error && (
            <p role="alert" className="text-xs text-destructive">
              {errorMessage(result.error)}
            </p>
          )}
          {result.data?.query && (
            <p className="text-sm">
              <strong>Consulta:</strong> {result.data.query}
            </p>
          )}
          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto">
            {fragments.map((fragment, index) => (
              <article
                key={`${fragment.chunk_id ?? fragment.id}:${index}`}
                className="min-w-0 rounded-lg border p-3 text-xs"
              >
                <p className="font-medium">
                  {fragment.label ? `Fuente ${fragment.label} · ` : ""}
                  {fragment.document_title} · {sourceLocation(fragment)} ·{" "}
                  {fragment.kind}
                </p>
                <p className="mt-1 break-all text-[10px] text-muted-foreground">
                  Chunk {fragment.chunk_id ?? fragment.id}
                  {typeof fragment.score === "number"
                    ? ` · puntuación RRF ${fragment.score.toFixed(6)}`
                    : ""}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words leading-6">
                  {fragment.text ||
                    (fragment.analysis?.native_reference === true
                      ? "Referencia al segmento original. Recuperación mediante embeddings nativos, sin transcripción."
                      : "Sin texto registrado.")}
                </p>
                {workspaceId && (fragment.document_id || documentId) && (
                  <Link
                    className="mt-2 inline-block text-primary underline"
                    to="/workspaces/$workspaceId"
                    params={{ workspaceId }}
                    search={{
                      document: fragment.document_id ?? documentId,
                      time: fragment.start_seconds ?? undefined,
                      sheet: fragment.sheet_name ?? undefined,
                      cell: fragment.cell_range ?? undefined,
                    }}
                  >
                    Abrir fuente en el workspace
                  </Link>
                )}
                {fragment.analysis &&
                  Object.keys(fragment.analysis).length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer">
                        {fragment.source_type === "spreadsheet"
                          ? "Valor, fórmula y procedencia de la celda"
                          : fragment.analysis?.native_reference === true
                            ? "Referencia nativa y procedencia del segmento"
                            : "Análisis y procedencia del segmento"}
                      </summary>
                      <dl className="mt-2 flex flex-col gap-1">
                        {Object.entries(fragment.analysis).map(
                          ([key, value]) => (
                            <div key={key} className="min-w-0">
                              <dt className="font-medium">{key}</dt>
                              <dd className="break-all">
                                {typeof value === "object"
                                  ? JSON.stringify(value)
                                  : String(value)}
                              </dd>
                            </div>
                          ),
                        )}
                      </dl>
                    </details>
                  )}
                {fragment.contextualized_text && (
                  <details className="mt-2">
                    <summary className="cursor-pointer">
                      Texto usado para buscar
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap break-words">
                      {fragment.contextualized_text}
                    </p>
                  </details>
                )}
              </article>
            ))}
            {!result.isPending && !result.error && fragments.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No hay fragmentos registrados para esta selección.
              </p>
            )}
          </div>
          {documentId && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                Anteriores
              </Button>
              <span className="text-xs">
                {result.data?.total ?? 0} referencias
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={offset + 20 >= (result.data?.total ?? 0)}
                onClick={() => setOffset(offset + 20)}
              >
                Siguientes
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
