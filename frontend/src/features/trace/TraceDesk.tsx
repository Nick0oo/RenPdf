import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  FileSearch,
  GitBranch,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import { useState } from "react"
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
import { Label } from "@/components/ui/label"
import {
  formatTime,
  sourceLocation,
  sourceType,
} from "@/features/media/location"
import { errorMessage } from "@/features/research/api"
import { ChoiceSelect } from "@/features/research/ChoiceSelect"
import { DocumentCoverage } from "@/features/research/DocumentCoverage"
import { processingLabel } from "@/features/research/presentation"
import {
  type DocumentTrace,
  moduleRequest,
  type PermissionTrace,
  type ResponseTrace,
  type TraceCollection,
  type TraceOverview,
  type TraceRow,
  traceDocuments,
  traceWorkspaces,
} from "./api"
import { ExecutionTrace } from "./ExecutionTrace"
import { RagInspector } from "./RagInspector"

export type TraceSection =
  | "activity"
  | "responses"
  | "documents"
  | "permissions"

const titles: Record<TraceSection, string> = {
  activity: "Actividad de tu investigación",
  responses: "Cómo se construyó cada respuesta",
  documents: "Del archivo a la evidencia",
  permissions: "Qué puede salir de tu equipo",
}
const stateNames: Record<string, string> = {
  COMPLETE: "Completado",
  SUCCEEDED: "Completado",
  COMPLETED: "Completado",
  FAILED: "Falló",
  GENERATING: "Generando",
  QUEUED: "En cola",
  RUNNING: "En curso",
  CANCELLED: "Cancelado",
  INTERRUPTED: "Interrumpido",
  ACTIVE: "Activo",
  REVOKED: "Revocado",
  EXPIRED: "Vencido",
  EXTRACTED: "Texto disponible",
  INDEXED: "Listo para consultar",
  BUILDING: "Construyendo",
  READY: "Listo para consultar",
  MEDIA_READY: "Lista para indexar",
  NATIVE_QUEUED: "Indexación nativa en cola",
  NATIVE_PREPARING: "Preparando segmentos nativos",
  DEGRADED: "Revisar extracción",
}
const usageNames: Record<string, string> = {
  input_tokens: "Tokens de entrada",
  output_tokens: "Tokens de respuesta",
  prompt_tokens: "Tokens de entrada",
  completion_tokens: "Tokens de respuesta",
  total_tokens: "Tokens totales",
  status: "Reporte de uso",
}
const scopes: Record<string, string> = {
  chat: "Respuestas sobre las fuentes",
  media_analysis: "Análisis de audio y video",
  vision: "Lectura de imágenes",
  embeddings: "Creación de embeddings",
  multimodal_embeddings: "Embeddings de imágenes, audio y video",
  original_pdf: "PDF original",
}
const date = (value: string) =>
  new Date(value).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  })
const kindName = (row: TraceRow) =>
  row.kind === "chat"
    ? "Respuesta IA"
    : row.kind === "studio"
      ? "Copia en Studio"
      : row.action === "index"
        ? "Indexación"
        : "Extracción"

function State({ value }: { value: string }) {
  return (
    <Badge variant={value === "FAILED" ? "destructive" : "secondary"}>
      {stateNames[value] ?? value}
    </Badge>
  )
}

export function TraceDesk({
  section = "activity",
}: {
  section?: TraceSection
}) {
  const [workspace, setWorkspace] = useState("all")
  const [state, setState] = useState("all")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  const [selectedResponse, setSelectedResponse] = useState<string>()
  const [selectedDocument, setSelectedDocument] = useState<string>()
  const overview = useQuery({
    queryKey: ["trace-overview"],
    queryFn: () => moduleRequest<TraceOverview>("/trace/overview"),
  })
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: traceWorkspaces,
  })
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: traceDocuments,
  })
  const params = new URLSearchParams({
    kind: section === "responses" ? "chat" : "all",
    limit: "30",
    offset: String(page * 30),
    q: search,
  })
  if (workspace !== "all") params.set("workspace_id", workspace)
  if (state !== "all") params.set("state", state)
  const activity = useQuery({
    queryKey: ["trace-activity", section, workspace, state, page, search],
    queryFn: () => moduleRequest<TraceCollection>(`/trace/activity?${params}`),
    enabled: section === "activity" || section === "responses",
  })
  const permissionParams = new URLSearchParams({
    limit: "30",
    offset: String(page * 30),
  })
  if (workspace !== "all") permissionParams.set("workspace_id", workspace)
  const permissions = useQuery({
    queryKey: ["trace-permissions", workspace, page],
    queryFn: () =>
      moduleRequest<PermissionTrace>(`/trace/permissions?${permissionParams}`),
    enabled: section === "permissions",
  })
  const response = useQuery({
    queryKey: ["trace-response", selectedResponse],
    queryFn: () =>
      moduleRequest<ResponseTrace>(`/trace/responses/${selectedResponse}`),
    enabled: !!selectedResponse,
  })
  const document = useQuery({
    queryKey: ["trace-document", selectedDocument],
    queryFn: () =>
      moduleRequest<DocumentTrace>(`/trace/documents/${selectedDocument}`),
    enabled: !!selectedDocument,
  })
  const current =
    section === "permissions"
      ? permissions
      : section === "documents"
        ? documents
        : activity
  const error = current.error ?? overview.error

  function inspect(row: TraceRow) {
    if (row.kind === "chat") setSelectedResponse(row.id)
    else if (row.document_id) setSelectedDocument(row.document_id)
  }

  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-8 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {titles[section]}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Revisa los modelos, las fuentes y los permisos que realmente
            quedaron guardados. Cada registro pertenece a tu cuenta.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void current.refetch()
            void overview.refetch()
          }}
        >
          <RefreshCw className="size-4" />
          Actualizar
        </Button>
      </header>
      {overview.data && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y py-5 md:grid-cols-4">
          {[
            {
              icon: Activity,
              label: "Respuestas guardadas",
              value: overview.data.responses,
            },
            {
              icon: FileSearch,
              label: "Fuentes",
              value: overview.data.documents,
            },
            {
              icon: GitBranch,
              label: "Copias de Studio",
              value: overview.data.studio_operations,
            },
            {
              icon: ShieldCheck,
              label: "Permisos activos",
              value: overview.data.active_consents,
            },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label}>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="size-4" />
                {label}
              </div>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          {errorMessage(error)}
        </p>
      )}
      {section !== "documents" && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-60">
            <Label className="mb-2 block">Workspace</Label>
            <ChoiceSelect
              label="Filtrar workspace"
              placeholder="Todos mis workspaces"
              value={workspace}
              onValueChange={(value) => {
                setWorkspace(value)
                setPage(0)
              }}
              options={[
                { value: "all", label: "Todos mis workspaces" },
                ...(workspaces.data ?? []).map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
            />
          </div>
          {section !== "permissions" && (
            <>
              <div className="min-w-44">
                <Label className="mb-2 block">Estado</Label>
                <ChoiceSelect
                  label="Filtrar estado"
                  placeholder="Todos los estados"
                  value={state}
                  onValueChange={(value) => {
                    setState(value)
                    setPage(0)
                  }}
                  options={[
                    { value: "all", label: "Todos los estados" },
                    ...[
                      "COMPLETE",
                      "GENERATING",
                      "FAILED",
                      "INTERRUPTED",
                      "CANCELLED",
                      "QUEUED",
                      "RUNNING",
                    ].map((value) => ({ value, label: stateNames[value] })),
                  ]}
                />
              </div>
              <div className="min-w-56 flex-1">
                <Label htmlFor="trace-search" className="mb-2 block">
                  Buscar título o modelo
                </Label>
                <Input
                  id="trace-search"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value)
                    setPage(0)
                  }}
                  placeholder="Nombre del chat, archivo o modelo"
                />
              </div>
            </>
          )}
        </div>
      )}
      {current.isLoading && (
        <p className="py-8 text-sm text-muted-foreground">
          Cargando registros guardados…
        </p>
      )}
      {(section === "activity" || section === "responses") && activity.data && (
        <section className="overflow-hidden rounded-xl border">
          <div className="border-b bg-muted/30 px-5 py-3 text-sm text-muted-foreground">
            {activity.data.total} registros · Se muestran eventos persistidos de
            chat, procesamiento y Studio.
          </div>
          {activity.data.data.length === 0 ? (
            <p className="p-8 text-sm text-muted-foreground">
              No hay registros con estos filtros. Haz una pregunta sobre tus
              fuentes o procesa un PDF para comenzar.
            </p>
          ) : (
            <div className="divide-y">
              {activity.data.data.map((row) => (
                <button
                  type="button"
                  key={`${row.kind}-${row.id}`}
                  onClick={() => inspect(row)}
                  className="grid w-full gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1fr)_180px_150px]"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {kindName(row)}
                      {row.model && ` · ${row.model}`}
                    </p>
                    {row.mode && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Recuperación: {row.mode} · {row.citations ?? 0} citas
                      </p>
                    )}
                  </div>
                  <div>
                    <State value={row.state} />
                    {row.stage && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        {row.stage} · {row.progress}%
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {date(row.created_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-end gap-3 border-t p-3">
            <span className="mr-auto text-xs text-muted-foreground">
              Página {page + 1}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              <ArrowLeft className="size-4" />
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * 30 >= activity.data.total}
              onClick={() => setPage((value) => value + 1)}
            >
              Siguiente
              <ArrowRight className="size-4" />
            </Button>
          </div>
        </section>
      )}
      {section === "documents" && (
        <DocumentList
          documents={documents.data ?? []}
          onSelect={setSelectedDocument}
        />
      )}
      {section === "permissions" && permissions.data && (
        <section className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-5">
            <ShieldCheck className="mt-1 size-5 shrink-0 text-primary" />
            <div>
              <p className="font-medium">
                La nube necesita un permiso por documento y tarea
              </p>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Los PDFs derivados en Studio comienzan sin permisos de nube.
                Revoca o concede acceso desde las fuentes de tu workspace.
              </p>
            </div>
          </div>
          {permissions.data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay permisos guardados en este ámbito. El acceso a proveedores
              de nube está denegado por defecto.
            </p>
          ) : (
            <div className="divide-y rounded-xl border">
              {permissions.data.data.map((item) => (
                <div
                  key={item.consent.id}
                  className="flex flex-wrap items-center justify-between gap-4 p-5"
                >
                  <div className="min-w-0">
                    <p className="break-words font-medium">
                      {item.document_title}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {item.consent.provider} ·{" "}
                      {scopes[item.consent.scope] ?? item.consent.scope}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Concedido {date(item.consent.granted_at)} · Vence{" "}
                      {date(item.consent.expires_at)}
                      {item.consent.revoked_at &&
                        ` · Revocado ${date(item.consent.revoked_at)}`}
                    </p>
                  </div>
                  <State value={item.state} />
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-end gap-3 border-t pt-4">
            <p className="mr-auto text-xs text-muted-foreground">
              {permissions.data.total} permisos · Página {page + 1}
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(page + 1) * 30 >= permissions.data.total}
              onClick={() => setPage((value) => value + 1)}
            >
              Siguiente
            </Button>
          </div>
        </section>
      )}
      <Dialog
        open={!!selectedResponse}
        onOpenChange={(open) => !open && setSelectedResponse(undefined)}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Recorrido de la respuesta</DialogTitle>
            <DialogDescription>
              Modelo, resultado y evidencia guardados en esta ejecución.
            </DialogDescription>
          </DialogHeader>
          {response.isLoading && <p>Cargando respuesta…</p>}
          {response.error && <p role="alert">{errorMessage(response.error)}</p>}
          {response.data && (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <State value={response.data.message.state} />
                <Badge variant="outline">
                  {response.data.message.provider ?? "Proveedor no registrado"}
                </Badge>
                <Badge variant="outline">
                  {response.data.message.model ?? "Sin modelo"}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Modo: {response.data.message.retrieval_mode ?? "No registrado"}{" "}
                · {date(response.data.message.created_at)}
              </p>
              <p className="whitespace-pre-wrap text-sm leading-7">
                {response.data.message.content}
              </p>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                {Object.entries(response.data.message.usage ?? {})
                  .filter(([key]) => key !== "trace")
                  .map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-muted-foreground">
                        {usageNames[key] ?? key}
                      </dt>
                      <dd className="break-words">
                        {typeof value === "object"
                          ? JSON.stringify(value)
                          : String(value)}
                      </dd>
                    </div>
                  ))}
              </dl>
              <ExecutionTrace
                value={response.data.message.usage?.trace}
                documents={documents.data}
                onDocumentSelect={(identifier) => {
                  setSelectedResponse(undefined)
                  setSelectedDocument(identifier)
                }}
              />
              <h3 className="flex items-center gap-2 font-medium">
                <CheckCheck className="size-4" />
                Evidencia citada
              </h3>
              <RagInspector messageId={response.data.message.id} />
              {(response.data.message.citations ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Esta respuesta no guardó citas.
                </p>
              )}
              {(response.data.message.citations ?? []).map((citation) => (
                <article
                  key={`${citation.chunk_id}-${citation.label}`}
                  className="rounded-lg border p-4"
                >
                  <p className="text-sm font-medium">
                    Fuente {citation.label} · {citation.document_title} ·{" "}
                    {sourceLocation(citation)}
                  </p>
                  <blockquote className="mt-2 border-l-2 border-primary/30 pl-3 text-sm leading-6 text-muted-foreground">
                    {citation.text}
                  </blockquote>
                  <p className="mt-2 break-all text-xs text-muted-foreground">
                    Versión {citation.version_id} · Precisión{" "}
                    {citation.precision}
                  </p>
                  <Button asChild variant="link" className="mt-1 px-0">
                    <a
                      href={`/workspaces/${response.data?.workspace_id}?${new URLSearchParams({ document: citation.document_id, ...(sourceType(citation) === "spreadsheet" ? { sheet: citation.sheet_name ?? "", cell: citation.cell_range ?? "" } : sourceType(citation) !== "pdf" ? { time: String(citation.start_seconds ?? 0) } : {}) })}`}
                    >
                      Abrir fuente en el workspace
                    </a>
                  </Button>
                </article>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selectedDocument}
        onOpenChange={(open) => !open && setSelectedDocument(undefined)}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Historia de la fuente</DialogTitle>
            <DialogDescription>
              Extracción, índices y copias derivadas de este archivo.
            </DialogDescription>
          </DialogHeader>
          {document.isLoading && <p>Cargando fuente…</p>}
          {document.error && <p role="alert">{errorMessage(document.error)}</p>}
          {document.data && <DocumentHistory trace={document.data} />}
        </DialogContent>
      </Dialog>
    </main>
  )
}

function DocumentList({
  documents,
  onSelect,
}: {
  documents: DocumentPublic[]
  onSelect: (id: string) => void
}) {
  return (
    <section className="divide-y rounded-xl border">
      {documents.length === 0 ? (
        <p className="p-8 text-sm text-muted-foreground">
          Sube fuentes a tu biblioteca para ver cómo se convierten en evidencia.
        </p>
      ) : (
        documents.map((document) => (
          <button
            type="button"
            key={document.id}
            onClick={() => onSelect(document.id)}
            className="flex w-full flex-wrap items-center justify-between gap-4 p-5 text-left hover:bg-muted/40"
          >
            <div className="min-w-0">
              <p className="break-words font-medium">{document.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {sourceType(document) === "spreadsheet"
                  ? `${document.sheet_count ?? 0} hojas`
                  : sourceType(document) === "pdf"
                    ? `${document.page_count} páginas`
                    : `${sourceType(document)} · ${formatTime(document.duration_seconds)}`}{" "}
                ·{" "}
                {document.active_index_id
                  ? "Índice activo"
                  : "Sin índice vectorial"}
              </p>
            </div>
            <State value={document.status} />
          </button>
        ))
      )}
    </section>
  )
}

export function DocumentHistory({
  trace,
  workspaceId,
}: {
  trace: DocumentTrace
  workspaceId?: string
}) {
  return (
    <div className="space-y-5">
      <DocumentCoverage document={trace.document} />
      <RagInspector
        documentId={trace.document.id}
        sourceType={sourceType(trace.document)}
        workspaceId={workspaceId}
      />
      <div>
        <h3 className="break-words font-medium">{trace.document.title}</h3>
        <p className="mt-2 break-all text-xs text-muted-foreground">
          SHA-256: {trace.sha256}
        </p>
      </div>
      {trace.versions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Todavía no hay una versión extraída. Puedes revisar el trabajo de
          procesamiento en tu biblioteca.
        </p>
      )}
      {trace.versions.map((version) => (
        <article key={version.id} className="rounded-lg border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-medium">Versión {version.number}</h4>
            <State value={version.state} />
            {version.current && <Badge>Actual</Badge>}
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {version.parser} {version.parser_version} · {version.chunks}{" "}
            fragmentos ·{" "}
            {sourceType(trace.document) === "spreadsheet"
              ? `${String(version.extraction?.sheets_extracted ?? 0)} hojas · ${String(version.extraction?.cells_total ?? 0)} celdas`
              : ["audio", "video"].includes(sourceType(trace.document))
                ? `${String(version.extraction?.segments_prepared ?? version.extraction?.segments_analyzed ?? 0)} segmentos preparados`
                : `${version.figures} figuras detectadas`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {date(version.created_at)}
          </p>
          {version.extraction?.analysis_mode === "native_embeddings" ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Embeddings nativos ·{" "}
              {String(version.extraction.segments_prepared ?? 0)}/
              {String(version.extraction.segments_total ?? 0)} segmentos
              preparados · {String(version.extraction.clips_reused ?? 0)} clips
              reutilizados. La transcripción es opcional.
            </p>
          ) : (
            !!version.extraction?.analysis_model && (
              <p className="mt-2 text-sm text-muted-foreground">
                Análisis: {String(version.extraction.analysis_provider)} ·{" "}
                {String(version.extraction.analysis_model)} ·{" "}
                {String(version.extraction.segments_analyzed)}/
                {String(version.extraction.segments_total)} segmentos ·
                intervalos de {String(version.extraction.segment_seconds)} s
              </p>
            )
          )}
          {version.indexes.map((index) => (
            <div key={index.id} className="mt-4 border-t pt-3 text-sm">
              <p className="font-medium">
                {index.profile.provider} · {index.profile.model}
                {index.active && " · Índice activo"}
              </p>
              <p className="mt-1 text-muted-foreground">
                {index.profile.dimensions} dimensiones ·{" "}
                {index.profile.modality} · {index.state}
              </p>
              <p className="mt-2 break-all text-xs text-muted-foreground">
                Versión del modelo: {index.profile.model_version}
              </p>
            </div>
          ))}
        </article>
      ))}
      <h4 className="font-medium">Procesamiento</h4>
      {trace.jobs.map((job) => (
        <div
          key={job.id}
          className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm"
        >
          <span>
            {processingLabel(job.kind, job.state)} · {job.progress}%
          </span>
          <State value={job.state} />
        </div>
      ))}
      <h4 className="font-medium">Linaje de Studio</h4>
      {trace.lineage_total > trace.lineage.length && (
        <p className="text-xs text-muted-foreground">
          Mostrando las {trace.lineage.length} operaciones más recientes de{" "}
          {trace.lineage_total}. Puedes recorrer el historial completo en
          Exportar, dentro de Studio.
        </p>
      )}
      {trace.lineage.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Este archivo no tiene operaciones de Studio registradas.
        </p>
      ) : (
        trace.lineage.map((operation) => (
          <div
            key={operation.id}
            className="rounded-lg bg-muted/40 p-3 text-sm"
          >
            <p className="font-medium">
              {operation.output_name} · {operation.kind}
            </p>
            {operation.sources.map((source, index) => (
              <p
                key={`${source.document_id}-${index}`}
                className="mt-1 break-all text-xs text-muted-foreground"
              >
                Origen {source.document_id} · páginas {source.pages.join(", ")}
              </p>
            ))}
          </div>
        ))
      )}
    </div>
  )
}
