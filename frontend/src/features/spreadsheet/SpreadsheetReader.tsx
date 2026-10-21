import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Table2,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import type { DocumentPublic, EvidencePublic } from "@/client"
import { DocumentsService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage } from "@/features/research/api"
import { processingLabel } from "@/features/research/presentation"
import { moduleRequest } from "@/features/trace/api"
import { cn } from "@/lib/utils"

type Sheet = {
  name: string
  index: number
  rows: number
  columns: number
  nonempty_cells: number
  hidden: boolean
  formula_cells: number
  missing_formula_values: number
}
type Sheets = {
  document_id: string
  version_id: string
  data: Sheet[]
  warnings: string[]
}
type Cell = {
  coordinate: string
  row: number
  column: number
  value: unknown
  display_value: string
  formula: string | null
  cached: boolean
  number_format: string
  merged_range: string | null
  kind: string
  element_id: string
}
type Cells = {
  sheet: string
  row_start: number
  column_start: number
  rows_total: number
  columns_total: number
  cells: Cell[]
  merged_ranges: string[]
}
const ROWS = 30,
  COLUMNS = 12

export function columnName(column: number): string {
  let value = column,
    result = ""
  while (value > 0) {
    value--
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}
export function cellPosition(coordinate?: string | null) {
  const match = coordinate?.replace(/\$/g, "").match(/^([A-Za-z]+)([1-9]\d*)/)
  if (!match) return { row: 1, column: 1 }
  const column = [...match[1].toUpperCase()].reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
    0,
  )
  return {
    row: Math.min(Number(match[2]), 1048576),
    column: Math.min(column, 16384),
  }
}

export function SpreadsheetReader({
  document,
  citation,
  initialSheet,
  initialCell,
}: {
  document: DocumentPublic
  citation?: EvidencePublic
  initialSheet?: string
  initialCell?: string
}) {
  const cache = useQueryClient()
  const [saved] = useState<{ sheet?: string; cell?: string }>(() => {
    try {
      const value = JSON.parse(
        localStorage.getItem(`spreadsheet-location:v1:${document.id}`) ??
          "null",
      )
      return value &&
        typeof value.sheet === "string" &&
        typeof value.cell === "string"
        ? value
        : {}
    } catch {
      return {}
    }
  })
  const [sheetName, setSheetName] = useState(
    citation?.sheet_name ?? initialSheet ?? saved.sheet ?? "",
  )
  const initial = cellPosition(
    citation?.cell_range ?? initialCell ?? saved.cell,
  )
  const [row, setRow] = useState(
    Math.floor((initial.row - 1) / ROWS) * ROWS + 1,
  )
  const [column, setColumn] = useState(
    Math.floor((initial.column - 1) / COLUMNS) * COLUMNS + 1,
  )
  const [selected, setSelected] = useState(initial)
  const [coordinate, setCoordinate] = useState(
    citation?.cell_range?.split(":")[0] ?? initialCell ?? saved.cell ?? "A1",
  )
  const viewport = useRef<HTMLDivElement>(null)
  const keyboardFocus = useRef(false)
  const jobs = useQuery({
    queryKey: ["jobs", document.id],
    queryFn: async () =>
      (
        await DocumentsService.documentJobs({
          path: { document_id: document.id },
        })
      ).data,
    refetchInterval: (query) =>
      query.state.data?.some((job) => ["QUEUED", "RUNNING"].includes(job.state))
        ? 2000
        : false,
  })
  const latest = jobs.data?.[0]
  const pendingJob = jobs.data?.find((job) =>
    ["QUEUED", "RUNNING"].includes(job.state),
  )
  const failedJob =
    latest && ["FAILED", "CANCELLED"].includes(latest.state)
      ? latest
      : undefined
  const retry = useMutation({
    mutationFn: () =>
      DocumentsService.retryJob({
        path: { document_id: document.id, job_id: failedJob?.id ?? "" },
      }),
    onSuccess: () => {
      void jobs.refetch()
      void cache.invalidateQueries({ queryKey: ["workspace-documents"] })
    },
  })
  const sheets = useQuery({
    queryKey: ["spreadsheet-sheets", document.id, document.current_version_id],
    queryFn: () => moduleRequest<Sheets>(`/documents/${document.id}/sheets`),
    enabled: !!document.current_version_id,
  })
  const activeSheet =
    sheets.data?.data.find((sheet) => sheet.name === sheetName) ??
    sheets.data?.data[0]
  const sheet = activeSheet?.name ?? ""
  useEffect(() => {
    if (!sheet) return
    const target = viewport.current
    if (!target) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() =>
        target
          .querySelector<HTMLElement>('[data-testid="selected-cell"]')
          ?.scrollIntoView({ block: "nearest", inline: "nearest" }),
      )
    })
    observer.observe(target)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [sheet])
  useEffect(() => {
    if (sheet)
      localStorage.setItem(
        `spreadsheet-location:v1:${document.id}`,
        JSON.stringify({
          sheet,
          cell: `${columnName(selected.column)}${selected.row}`,
        }),
      )
  }, [document.id, sheet, selected])
  const cells = useQuery({
    queryKey: [
      "spreadsheet-cells",
      document.id,
      document.current_version_id,
      sheet,
      row,
      column,
    ],
    queryFn: () =>
      moduleRequest<Cells>(
        `/documents/${document.id}/sheets/cells?sheet=${encodeURIComponent(sheet)}&row=${row}&limit=${ROWS}&column=${column}&columns=${COLUMNS}`,
      ),
    enabled: !!document.current_version_id && !!sheet,
  })
  const focus = (position: { row: number; column: number }) => {
    const next = {
      row: Math.max(
        1,
        Math.min(position.row, activeSheet?.rows || position.row),
      ),
      column: Math.max(
        1,
        Math.min(position.column, activeSheet?.columns || position.column),
      ),
    }
    setSelected(next)
    setCoordinate(`${columnName(next.column)}${next.row}`)
    setRow(Math.floor((next.row - 1) / ROWS) * ROWS + 1)
    setColumn(Math.floor((next.column - 1) / COLUMNS) * COLUMNS + 1)
  }
  useEffect(() => {
    const name = citation?.sheet_name ?? initialSheet
    const coordinate = citation?.cell_range ?? initialCell
    if (name) setSheetName(name)
    if (coordinate) {
      const position = cellPosition(coordinate)
      setSelected(position)
      setCoordinate(`${columnName(position.column)}${position.row}`)
      setRow(Math.floor((position.row - 1) / ROWS) * ROWS + 1)
      setColumn(Math.floor((position.column - 1) / COLUMNS) * COLUMNS + 1)
    }
  }, [citation, initialSheet, initialCell])
  useEffect(() => {
    if (!cells.data) return
    const cell = viewport.current?.querySelector<HTMLElement>(
      `[data-coordinate="${columnName(selected.column)}${selected.row}"]`,
    )
    if (cell && keyboardFocus.current) {
      cell.focus({ preventScroll: true })
      keyboardFocus.current = false
    }
    cell?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [selected, cells.data])
  const selectedCell = cells.data?.cells.find(
    (cell) => cell.row === selected.row && cell.column === selected.column,
  )
  const byCoordinate = new Map(
    cells.data?.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]),
  )
  const rows = Array.from(
    { length: Math.max(0, Math.min(ROWS, (activeSheet?.rows ?? 0) - row + 1)) },
    (_, i) => row + i,
  )
  const columns = Array.from(
    {
      length: Math.max(
        0,
        Math.min(COLUMNS, (activeSheet?.columns ?? 0) - column + 1),
      ),
    },
    (_, i) => column + i,
  )
  const invalidTarget =
    !!sheetName &&
    !!sheets.data &&
    !sheets.data.data.some((item) => item.name === sheetName)
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-testid="spreadsheet-reader"
    >
      {!document.current_version_id && !failedJob && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Extrayendo hojas y celdas localmente. Puedes seguir escribiendo en el
          chat.
        </p>
      )}
      {document.current_version_id && sheets.isPending && (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          Cargando hojas y dimensiones…
        </p>
      )}
      {(pendingJob || failedJob) && (
        <div
          role="status"
          className="flex shrink-0 flex-col gap-2 border-b bg-muted/20 p-3 text-xs"
        >
          <div className="flex items-center justify-between gap-3">
            <span>
              {processingLabel(
                (pendingJob ?? failedJob)!.kind,
                (pendingJob ?? failedJob)!.state,
              )}
            </span>
            <span>{(pendingJob ?? failedJob)!.progress}%</span>
          </div>
          <progress
            aria-label="Progreso de la hoja de cálculo"
            className="h-1.5 w-full accent-primary"
            max={100}
            value={(pendingJob ?? failedJob)!.progress}
          />
          {failedJob?.error_message && (
            <p className="text-destructive">{failedJob.error_message}</p>
          )}
          {failedJob && (
            <Button
              size="sm"
              variant="outline"
              disabled={retry.isPending}
              onClick={() => retry.mutate()}
            >
              {failedJob.kind === "index"
                ? "Reintentar índice"
                : "Reintentar extracción"}
            </Button>
          )}
          {retry.error && (
            <p role="alert" className="text-destructive">
              {errorMessage(retry.error)}
            </p>
          )}
        </div>
      )}
      {(sheets.error || cells.error) && (
        <Alert variant="destructive" className="m-3 w-auto">
          <AlertTitle>No se pudo abrir la hoja</AlertTitle>
          <AlertDescription>
            {errorMessage(sheets.error || cells.error)}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void sheets.refetch()
                void cells.refetch()
              }}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {invalidTarget && (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          No existe la hoja {sheetName}; se muestra {sheet}.
        </p>
      )}
      {sheets.data && (
        <Tabs
          value={sheet}
          onValueChange={(name) => {
            setSheetName(name)
            setRow(1)
            setColumn(1)
            setSelected({ row: 1, column: 1 })
            setCoordinate("A1")
          }}
          className="shrink-0 border-b p-2"
        >
          <TabsList className="h-auto max-w-full justify-start overflow-x-auto">
            {sheets.data.data.map((item) => (
              <TabsTrigger
                key={item.name}
                value={item.name}
                className="shrink-0"
              >
                <Table2 data-icon="inline-start" />
                {item.name}
                {item.hidden ? " (oculta)" : ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {activeSheet && (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault()
                if (/^\$?[A-Za-z]+\$?[1-9]\d*$/.test(coordinate.trim()))
                  focus(cellPosition(coordinate.trim()))
              }}
            >
              <Input
                aria-label="Ir a celda"
                className="h-8 w-24"
                value={coordinate}
                onChange={(event) => setCoordinate(event.target.value)}
              />
              <Button size="sm" variant="ghost" type="submit">
                Ir
              </Button>
            </form>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {activeSheet.rows.toLocaleString()} filas ·{" "}
              {activeSheet.columns.toLocaleString()} columnas
            </span>
          </div>
          {activeSheet.missing_formula_values > 0 ||
          sheets.data?.warnings.length ? (
            <details className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                {activeSheet.missing_formula_values > 0
                  ? `${activeSheet.missing_formula_values} fórmulas sin resultado guardado`
                  : "Avisos del archivo"}
              </summary>
              <p className="mt-2">
                Las fórmulas se muestran tal como están guardadas. No se
                ejecutan ni se inventan sus resultados.
              </p>
              {sheets.data?.warnings.map((warning) => (
                <p key={warning} className="mt-1">
                  {warning}
                </p>
              ))}
            </details>
          ) : null}
          <section
            className="flex shrink-0 flex-col gap-1 border-b bg-muted/25 px-3 py-2"
            aria-label="Detalle de celda seleccionada"
          >
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="outline">
                {sheet} · {columnName(selected.column)}
                {selected.row}
              </Badge>
              {selectedCell?.merged_range && (
                <span className="text-muted-foreground">
                  Combinada: {selectedCell.merged_range}
                </span>
              )}
            </div>
            {selectedCell?.formula && (
              <p
                className="break-all text-xs leading-5"
                data-testid="cell-formula"
              >
                Fórmula: <code>{selectedCell.formula}</code>
              </p>
            )}
            <p
              className="break-words text-sm leading-5"
              data-testid="cell-value"
            >
              {cells.isFetching && !cells.data ? (
                "Cargando celda…"
              ) : selectedCell?.formula && !selectedCell.cached ? (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <AlertTriangle size={13} />
                  Sin resultado guardado
                </span>
              ) : selectedCell ? (
                `Valor${selectedCell.formula ? " guardado" : ""}: ${selectedCell.display_value ?? String(selectedCell.value ?? "")}`
              ) : (
                "Celda vacía"
              )}
            </p>
          </section>
          <div
            ref={viewport}
            id={`sheet-panel-${document.id}`}
            role="tabpanel"
            aria-label={`Celdas de ${sheet}`}
            className="relative min-h-0 flex-1 overflow-auto"
            aria-busy={cells.isFetching}
          >
            {cells.isFetching && (
              <p
                role="status"
                className="sticky left-0 top-0 border-b bg-background px-3 py-1 text-xs text-muted-foreground"
              >
                Cargando celdas…
              </p>
            )}
            <table
              className="w-max min-w-full border-separate border-spacing-0 text-xs"
              aria-label={`Hoja ${sheet}`}
            >
              <thead className="sticky top-0 z-10">
                <tr>
                  <th
                    className="sticky left-0 z-10 min-w-12 border-b border-r bg-muted px-2 py-2"
                    aria-label="Fila"
                  />
                  {columns.map((value) => (
                    <th
                      key={value}
                      scope="col"
                      className="min-w-32 border-b border-r bg-muted px-3 py-2 font-medium"
                    >
                      {columnName(value)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 border-b border-r bg-muted px-2 py-2 font-normal text-muted-foreground"
                    >
                      {r}
                    </th>
                    {columns.map((c) => {
                      const cell = byCoordinate.get(`${r}:${c}`),
                        active = selected.row === r && selected.column === c
                      const label = `${columnName(c)}${r}`
                      return (
                        <td
                          key={c}
                          className={cn(
                            "max-w-64 border-b border-r p-0",
                            active &&
                              "bg-primary/10 outline outline-2 -outline-offset-2 outline-primary",
                          )}
                        >
                          <button
                            data-testid={active ? "selected-cell" : undefined}
                            data-coordinate={label}
                            type="button"
                            tabIndex={active ? 0 : -1}
                            aria-label={`${label}: ${cell?.formula && !cell.cached ? "Sin resultado guardado" : (cell?.display_value ?? "Celda vacía")}`}
                            aria-pressed={active}
                            title={
                              cell?.formula ?? cell?.display_value ?? label
                            }
                            className="block min-h-9 w-full truncate px-3 py-2 text-left focus-visible:outline-2 focus-visible:outline-primary"
                            onClick={() => focus({ row: r, column: c })}
                            onKeyDown={(event) => {
                              const delta: Record<string, [number, number]> = {
                                ArrowUp: [-1, 0],
                                ArrowDown: [1, 0],
                                ArrowLeft: [0, -1],
                                ArrowRight: [0, 1],
                              }
                              const move = delta[event.key]
                              if (move) {
                                event.preventDefault()
                                focus({ row: r + move[0], column: c + move[1] })
                                requestAnimationFrame(() =>
                                  viewport.current
                                    ?.querySelector<HTMLElement>(
                                      `[data-coordinate="${columnName(Math.max(1, c + move[1]))}${Math.max(1, r + move[0])}"]`,
                                    )
                                    ?.focus(),
                                )
                              }
                            }}
                          >
                            {cell?.formula && !cell.cached ? (
                              <span className="text-muted-foreground">
                                Sin resultado guardado
                              </span>
                            ) : (
                              (cell?.display_value ?? "")
                            )}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && !cells.isFetching && (
              <p className="p-5 text-sm text-muted-foreground">
                Esta hoja no contiene celdas con datos.
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-2 py-2">
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Filas anteriores"
                disabled={row === 1}
                onClick={() => focus({ row: row - ROWS, column })}
              >
                <ArrowUp data-icon="inline-start" />
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Filas {row}–{Math.min(row + ROWS - 1, activeSheet.rows)}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Filas siguientes"
                disabled={row + ROWS > activeSheet.rows}
                onClick={() => focus({ row: row + ROWS, column })}
              >
                <ArrowDown data-icon="inline-start" />
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Columnas anteriores"
                disabled={column === 1}
                onClick={() => focus({ row, column: column - COLUMNS })}
              >
                <ArrowLeft data-icon="inline-start" />
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {columnName(column)}–
                {columnName(
                  Math.min(column + COLUMNS - 1, activeSheet.columns),
                )}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Columnas siguientes"
                disabled={column + COLUMNS > activeSheet.columns}
                onClick={() => focus({ row, column: column + COLUMNS })}
              >
                <ArrowRight data-icon="inline-start" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
