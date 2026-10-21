import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Database, FileSearch, RefreshCw } from "lucide-react"
import { useDeferredValue, useState } from "react"
import type { DocumentPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatTime, sourceType } from "@/features/media/location"
import { errorMessage } from "@/features/research/api"
import { ChoiceSelect } from "@/features/research/ChoiceSelect"
import {
  type DocumentTrace,
  moduleRequest,
  type ResponseTrace,
  traceDocuments,
  traceWorkspaces,
} from "./api"
import { ExecutionTrace } from "./ExecutionTrace"
import { RagInspector } from "./RagInspector"
import { DocumentHistory } from "./TraceDesk"

type Source = {
  document: DocumentPublic
  coverage: Record<string, unknown>
  chunks: number
  workspace_ids: string[]
}
type Query = {
  id: string
  query: string | null
  title: string
  state: string
  model: string | null
  retrieval_mode: string | null
  workspace_id: string
  usage: Record<string, unknown>
  created_at: string
}
type Collection<T> = { data: T[]; total: number }

export function RagDesk() {
  const [tab, setTab] = useState("queries")
  const [workspace, setWorkspace] = useState("all")
  const [kind, setKind] = useState("all")
  const [search, setSearch] = useState("")
  const query = useDeferredValue(search)
  const [offset, setOffset] = useState(0)
  const [selectedQuery, setSelectedQuery] = useState<Query>()
  const [selectedSource, setSelectedSource] = useState<Source>()
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: traceWorkspaces,
  })
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: traceDocuments,
  })
  const parameters = new URLSearchParams({
    q: query,
    offset: String(offset),
    limit: "20",
  })
  if (workspace !== "all") parameters.set("workspace_id", workspace)
  const queries = useQuery({
    queryKey: ["rag-queries", workspace, query, offset],
    queryFn: () =>
      moduleRequest<Collection<Query>>(`/trace/rag/queries?${parameters}`),
    enabled: tab === "queries",
  })
  const sources = useQuery({
    queryKey: ["rag-sources", workspace, kind, query, offset],
    queryFn: () =>
      moduleRequest<Collection<Source>>(
        `/trace/rag/sources?${parameters}&source_type=${kind}`,
      ),
    enabled: tab === "sources",
  })
  const response = useQuery({
    queryKey: ["trace-response", selectedQuery?.id],
    queryFn: () =>
      moduleRequest<ResponseTrace>(`/trace/responses/${selectedQuery?.id}`),
    enabled: !!selectedQuery,
  })
  const source = useQuery({
    queryKey: ["trace-document", selectedSource?.document.id],
    queryFn: () =>
      moduleRequest<DocumentTrace>(
        `/trace/documents/${selectedSource?.document.id}`,
      ),
    enabled: !!selectedSource,
  })
  const current = tab === "queries" ? queries : sources
  return (
    <main className="mx-auto flex max-w-[1440px] flex-col gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Database /> RAG y segmentos
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Del archivo al contexto: extracción, análisis, chunks, embeddings y
            consultas de PDF, Excel, audio y video.
          </p>
        </div>
        <Button variant="outline" onClick={() => void current.refetch()}>
          <RefreshCw data-icon="inline-start" /> Actualizar
        </Button>
      </header>
      <div className="grid gap-3 md:grid-cols-[minmax(12rem,20rem)_minmax(0,1fr)]">
        <ChoiceSelect
          label="Workspace de trazabilidad RAG"
          placeholder="Todos los workspaces"
          value={workspace}
          onValueChange={(value) => {
            setWorkspace(value)
            setOffset(0)
          }}
          options={[
            { value: "all", label: "Todos los workspaces" },
            ...(workspaces.data ?? []).map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
        />
        <Input
          aria-label="Buscar en trazabilidad RAG"
          placeholder={
            tab === "queries"
              ? "Buscar por consulta o conversación…"
              : "Buscar fuentes por nombre…"
          }
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setOffset(0)
          }}
        />
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value)
          setOffset(0)
        }}
      >
        <TabsList>
          <TabsTrigger value="queries">Consultas y recuperación</TabsTrigger>
          <TabsTrigger value="sources">Fuentes, análisis y chunks</TabsTrigger>
        </TabsList>
        {current.error && (
          <p role="alert" className="p-4 text-sm text-destructive">
            {errorMessage(current.error)}
          </p>
        )}
        {current.isPending && (
          <p role="status" className="p-4 text-sm">
            Cargando registros RAG…
          </p>
        )}
        <TabsContent value="queries" className="mt-4 flex flex-col gap-3">
          {queries.data?.data.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setSelectedQuery(item)}
              className="flex w-full flex-wrap items-start justify-between gap-3 rounded-xl border bg-background p-4 text-left hover:bg-muted/30"
              aria-label={`Inspeccionar consulta ${item.query ?? item.title}`}
            >
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium">
                  {item.query ?? "Consulta histórica sin texto registrado"}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {item.title} · {item.model ?? "Modelo no invocado"} ·{" "}
                  {item.retrieval_mode ?? "Sin recuperación registrada"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString("es-CO")}
                </p>
              </div>
              <Badge
                variant={item.state === "FAILED" ? "destructive" : "secondary"}
              >
                {item.state === "COMPLETE" ? "Completada" : item.state}
              </Badge>
            </button>
          ))}
          {queries.data?.data.length === 0 && (
            <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              No hay consultas para este filtro. Las próximas preguntas
              conservarán su recorrido de recuperación.
            </p>
          )}
        </TabsContent>
        <TabsContent value="sources" className="mt-4 flex flex-col gap-4">
          <ChoiceSelect
            label="Tipo de fuente RAG"
            placeholder="Todos los formatos"
            value={kind}
            onValueChange={(value) => {
              setKind(value)
              setOffset(0)
            }}
            className="max-w-xs"
            options={[
              { value: "all", label: "Todos los formatos" },
              { value: "pdf", label: "PDF" },
              { value: "spreadsheet", label: "Excel y tablas" },
              { value: "audio", label: "Audio" },
              { value: "video", label: "Video" },
            ]}
          />
          <div className="grid gap-3 lg:grid-cols-2">
            {sources.data?.data.map((item) => (
              <button
                type="button"
                key={item.document.id}
                onClick={() => setSelectedSource(item)}
                className="min-w-0 rounded-xl border bg-background p-4 text-left hover:bg-muted/30"
                aria-label={`Inspeccionar fuente ${item.document.title}`}
              >
                <p className="flex items-center gap-2 text-sm font-medium">
                  <FileSearch className="shrink-0" />
                  <span className="truncate">{item.document.title}</span>
                  <Badge variant="outline">
                    {sourceType(item.document) === "spreadsheet"
                      ? "Excel"
                      : sourceType(item.document).toUpperCase()}
                  </Badge>
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  {sourceType(item.document) === "spreadsheet"
                    ? `${String(item.coverage.sheets_extracted ?? 0)}/${item.document.sheet_count ?? 0} hojas · ${String(item.coverage.cells_total ?? 0)} celdas · ${String(item.coverage.formula_cells ?? 0)} fórmulas`
                    : sourceType(item.document) === "pdf"
                      ? `${item.document.page_count} páginas · ${String(item.coverage.figures_total ?? 0)} figuras`
                      : item.coverage.analysis_mode === "native_embeddings"
                        ? `${formatTime(item.document.duration_seconds)} · ${String(item.coverage.segments_indexed ?? 0)}/${String(item.coverage.segments_total ?? 0)} segmentos indexados · embeddings nativos`
                        : `${formatTime(item.document.duration_seconds)} · ${String(item.coverage.segments_analyzed ?? 0)}/${String(item.coverage.segments_total ?? 0)} segmentos analizados`}
                </p>
                <p className="mt-2 text-xs">
                  {item.chunks} chunks ·{" "}
                  {item.document.active_index_id
                    ? "Índice activo"
                    : "Sin índice vectorial"}{" "}
                  · {item.document.status}
                </p>
              </button>
            ))}
          </div>
          {sources.data?.data.length === 0 && (
            <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
              No hay fuentes para este filtro.
            </p>
          )}
        </TabsContent>
      </Tabs>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{current.data?.total ?? 0} registros</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            Anteriores
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={offset + 20 >= (current.data?.total ?? 0)}
            onClick={() => setOffset(offset + 20)}
          >
            Siguientes
          </Button>
        </div>
      </div>
      <Dialog
        open={!!selectedQuery}
        onOpenChange={(open) => {
          if (!open) setSelectedQuery(undefined)
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Recorrido de la consulta RAG</DialogTitle>
            <DialogDescription>
              {selectedQuery?.query ?? selectedQuery?.title}
            </DialogDescription>
          </DialogHeader>
          {response.isPending && <p role="status">Cargando ejecución…</p>}
          {response.error && <p role="alert">{errorMessage(response.error)}</p>}
          {response.data && (
            <>
              <ExecutionTrace
                value={response.data.message.usage?.trace}
                documents={documents.data}
              />
              <RagInspector
                key={response.data.message.id}
                messageId={response.data.message.id}
                workspaceId={response.data.workspace_id}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selectedSource}
        onOpenChange={(open) => {
          if (!open) setSelectedSource(undefined)
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Extracción, análisis e índice</DialogTitle>
            <DialogDescription>
              {selectedSource?.document.title}
            </DialogDescription>
          </DialogHeader>
          {selectedSource?.workspace_ids[0] && (
            <Link
              className="text-sm text-primary underline"
              to="/workspaces/$workspaceId"
              params={{ workspaceId: selectedSource.workspace_ids[0] }}
              search={{
                document: selectedSource.document.id,
                time: ["pdf", "spreadsheet"].includes(
                  sourceType(selectedSource.document),
                )
                  ? undefined
                  : 0,
              }}
            >
              Abrir fuente en el workspace
            </Link>
          )}
          {source.isPending && <p role="status">Cargando fuente…</p>}
          {source.error && <p role="alert">{errorMessage(source.error)}</p>}
          {source.data && (
            <DocumentHistory
              trace={source.data}
              workspaceId={selectedSource?.workspace_ids[0]}
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  )
}
