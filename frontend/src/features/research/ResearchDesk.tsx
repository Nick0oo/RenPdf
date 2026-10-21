import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  ArrowUpRight,
  BookOpen,
  FilePlus2,
  FolderPlus,
  Headphones,
  LayoutGrid,
  List,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Search,
  Settings2,
  Table2,
  Trash2,
  Video,
} from "lucide-react"
import { useRef, useState } from "react"
import { toast } from "sonner"
import type { DocumentPublic } from "@/client"
import { DocumentsService, ProvidersService, WorkspacesService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { formatTime, sourceType } from "@/features/media/location"
import { ModelSettings } from "@/features/models/ModelSettings"
import { cn } from "@/lib/utils"
import { apiRoot, errorMessage } from "./api"
import { ChoiceSelect } from "./ChoiceSelect"
import { ConfirmationDialog } from "./ConfirmationDialog"
import { NameDialog } from "./NameDialog"
import { documentStatus } from "./presentation"

export function ResearchDesk() {
  const cache = useQueryClient()
  const [search, setSearch] = useState("")
  const [sourceFilter, setSourceFilter] = useState("all")
  const [view, setView] = useState<"list" | "grid">("list")
  const navigate = useNavigate()
  const [newWorkspace, setNewWorkspace] = useState(false)
  const [name, setName] = useState("")
  const [renaming, setRenaming] = useState<DocumentPublic>()
  const [deleting, setDeleting] = useState<DocumentPublic>()
  const [modelsOpen, setModelsOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState("")
  const uploadInput = useRef<HTMLInputElement>(null)
  const documents = useQuery({
    queryKey: ["documents", search],
    queryFn: async () =>
      (await DocumentsService.listDocuments({ query: { q: search } })).data,
    refetchInterval: 4000,
  })
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => (await WorkspacesService.listWorkspaces()).data,
  })
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: async () => (await ProvidersService.providerCatalog()).data,
    staleTime: 60000,
    retry: false,
  })
  const upload = useMutation({
    mutationFn: async (files: FileList | File[]) => {
      for (const file of Array.from(files))
        await DocumentsService.uploadDocument({ body: { file } })
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["documents"] })
      setError("")
      toast.success(
        "Fuentes importadas. Los documentos y hojas se extraen localmente; abre los audios o videos para crear su índice nativo.",
      )
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const createWorkspace = useMutation({
    mutationFn: () => WorkspacesService.createWorkspace({ body: { name } }),
    onSuccess: (response) => {
      void cache.invalidateQueries({ queryKey: ["workspaces"] })
      setNewWorkspace(false)
      setName("")
      openWorkspace(response.data.id)
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (document_id: string) =>
      DocumentsService.deleteDocument({ path: { document_id } }),
    onSuccess: () => {
      setDeleting(undefined)
      return cache.invalidateQueries({ queryKey: ["documents"] })
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const rename = useMutation({
    mutationFn: () =>
      DocumentsService.renameDocument({
        path: { document_id: renaming?.id ?? "" },
        body: { title: name },
      }),
    onSuccess: () => {
      setRenaming(undefined)
      setName("")
      return cache.invalidateQueries({ queryKey: ["documents"] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const openDocumentChat = useMutation({
    mutationFn: async (document: DocumentPublic) => {
      const remembered = localStorage.getItem(`document-chat:${document.id}`)
      const dedicatedName = `Chat · ${document.title}`.slice(0, 120)
      let existing = workspaces.data?.find(
        (workspace) => workspace.id === remembered,
      )
      if (!existing) {
        const named = workspaces.data?.find(
          (workspace) => workspace.name === dedicatedName,
        )
        if (named) {
          const members = (
            await WorkspacesService.listWorkspaceDocuments({
              path: { workspace_id: named.id },
            })
          ).data
          if (members.some((item) => item.id === document.id)) existing = named
        }
      }
      const workspace =
        existing ??
        (
          await WorkspacesService.createWorkspace({
            body: { name: dedicatedName },
          })
        ).data
      await WorkspacesService.attachDocument({
        path: { workspace_id: workspace.id, document_id: document.id },
      })
      localStorage.setItem(`document-chat:${document.id}`, workspace.id)
      return { workspace, document }
    },
    onSuccess: ({ workspace, document }) => {
      cache.setQueryData(["workspaces"], (rows: typeof workspaces.data) =>
        rows?.some((row) => row.id === workspace.id)
          ? rows
          : [workspace, ...(rows ?? [])],
      )
      void cache.invalidateQueries({ queryKey: ["workspaces"] })
      openWorkspace(workspace.id, document.id, true)
    },
    onError: (e) => setError(errorMessage(e)),
  })
  function openWorkspace(id: string, documentId?: string, startChat = false) {
    void navigate({
      to: "/workspaces/$workspaceId",
      params: { workspaceId: id },
      search: { document: documentId, start: startChat || undefined },
    })
  }
  const visibleDocuments =
    documents.data?.filter(
      (document) =>
        sourceFilter === "all" || sourceType(document) === sourceFilter,
    ) ?? []
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Tu biblioteca
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Abre un chat con tus documentos, Excel, audios y videos o reúne
            varias fuentes en un proyecto. Tú decides cuándo compartir contenido
            con un modelo.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!!workspaces.data?.length && (
            <Button
              onClick={() =>
                openWorkspace(workspaces.data[0].id, undefined, true)
              }
            >
              <MessageSquare size={16} /> Continuar chat
            </Button>
          )}
          <Button variant="outline" onClick={() => setModelsOpen(true)}>
            <Settings2 size={16} /> Modelos
          </Button>
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
        <section
          aria-label="Importar documentos"
          className={`relative overflow-hidden rounded-xl border border-dashed p-4 transition-colors ${dragging ? "border-primary bg-primary/10" : "bg-primary/[0.03]"}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            if (e.dataTransfer.files.length)
              upload.mutate(Array.from(e.dataTransfer.files))
          }}
        >
          <FilePlus2 className="mb-2 text-primary" size={22} />
          <h2 className="font-semibold">Importa tus fuentes</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Arrastra PDF, Excel, CSV, TSV, MP3, WAV, M4A, FLAC, OGG, MP4, WEBM o
            MOV. Hasta 50 MB por archivo; 500 páginas PDF o 30 minutos de audio
            y video.
          </p>
          <Button
            className="mt-3"
            disabled={upload.isPending}
            onClick={() => uploadInput.current?.click()}
          >
            {upload.isPending ? "Guardando archivos…" : "Importar fuentes"}
            <ArrowUpRight size={16} />
          </Button>
          <input
            ref={uploadInput}
            data-testid="pdf-upload"
            type="file"
            accept="application/pdf,audio/*,video/*,.pdf,.xlsx,.xlsm,.xls,.csv,.tsv,.mp3,.wav,.m4a,.flac,.ogg,.mp4,.webm,.mov"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length)
                upload.mutate(Array.from(e.target.files))
              e.target.value = ""
            }}
          />
        </section>
        <section className="rounded-xl border bg-card p-4">
          <BookOpen size={22} className="mb-2 text-primary" />
          <h2 className="font-semibold">Agrupa tus fuentes</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Agrupa documentos, compara resultados y guarda tus conversaciones y
            notas.
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => {
              setName("")
              setNewWorkspace(true)
            }}
          >
            <FolderPlus size={16} /> Crear workspace
          </Button>
        </section>
      </div>
      {(error || documents.error || workspaces.error) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error || errorMessage(documents.error || workspaces.error)}
        </p>
      )}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Documentos</h2>
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-2.5 text-muted-foreground"
            />
            <Input
              aria-label="Buscar documentos"
              placeholder="Buscar en tu biblioteca…"
              className="h-9 pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Tabs
            value={sourceFilter}
            onValueChange={setSourceFilter}
            className="min-w-0 max-w-full"
          >
            <TabsList className="max-w-full justify-start overflow-auto">
              {[
                { id: "all", label: "Todas" },
                { id: "pdf", label: "PDF" },
                { id: "spreadsheet", label: "Excel" },
                { id: "audio", label: "Audio" },
                { id: "video", label: "Video" },
              ].map((item) => (
                <TabsTrigger key={item.id} value={item.id}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <Tabs
            value={view}
            onValueChange={(value) => setView(value as "list" | "grid")}
          >
            <TabsList>
              <TabsTrigger value="list" aria-label="Vista de lista">
                <List data-icon="inline-start" />
              </TabsTrigger>
              <TabsTrigger value="grid" aria-label="Vista de cuadrícula">
                <LayoutGrid data-icon="inline-start" />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        {documents.isPending && (
          <div
            className="grid gap-3"
            role="status"
            aria-label="Cargando fuentes"
          >
            {[1, 2, 3].map((index) => (
              <Skeleton key={index} className="h-24 rounded-xl" />
            ))}
          </div>
        )}
        <div
          className={cn(
            "grid gap-3",
            view === "grid" && "sm:grid-cols-2 lg:grid-cols-3",
          )}
        >
          {visibleDocuments.map((document) => (
            <article
              key={document.id}
              className={cn(
                "overflow-hidden rounded-xl border bg-card",
                view === "list" && "flex items-center gap-3 p-3",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center bg-muted/35",
                  view === "grid"
                    ? "h-28 border-b p-3"
                    : "hidden h-20 w-16 shrink-0 rounded-md p-2 sm:flex",
                )}
              >
                {sourceType(document) === "pdf" ? (
                  <img
                    src={`${apiRoot}/documents/${document.id}/thumbnail`}
                    alt={`Miniatura de ${document.title}`}
                    className="max-h-full max-w-full shadow-sm"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    {sourceType(document) === "spreadsheet" ? (
                      <Table2 size={32} />
                    ) : sourceType(document) === "video" ? (
                      <Video size={32} />
                    ) : (
                      <Headphones size={32} />
                    )}
                    <span className="text-xs">
                      {sourceType(document) === "spreadsheet"
                        ? `Excel · ${document.sheet_count ?? 0} hojas`
                        : `${sourceType(document) === "video" ? "Video" : "Audio"} · ${formatTime(document.duration_seconds)}`}
                    </span>
                  </div>
                )}
              </div>
              <div
                className={cn(
                  "min-w-0",
                  view === "grid"
                    ? "p-4"
                    : "grid flex-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]",
                )}
              >
                <h3
                  className={cn(
                    "truncate text-sm font-semibold",
                    view === "list" && "sm:col-start-1 sm:row-start-1",
                  )}
                  title={document.title}
                >
                  {document.title}
                </h3>
                <div
                  className={cn(
                    "flex flex-wrap items-center gap-2 text-xs text-muted-foreground",
                    view === "grid"
                      ? "mt-2 justify-between"
                      : "sm:col-start-1 sm:row-start-2",
                  )}
                >
                  <span>
                    {sourceType(document) === "pdf"
                      ? `${document.page_count} páginas`
                      : sourceType(document) === "spreadsheet"
                        ? `${document.sheet_count ?? 0} hojas`
                        : formatTime(document.duration_seconds)}{" "}
                    · {(document.file_size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <Badge
                    variant={
                      document.status === "READY" ? "secondary" : "outline"
                    }
                    className="text-[9px]"
                  >
                    {documentStatus(document.status)}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  className={cn(
                    "w-full",
                    view === "grid" ? "mt-4" : "sm:col-start-2 sm:row-start-1",
                  )}
                  aria-label={`Chatear con ${document.title}`}
                  disabled={openDocumentChat.isPending || workspaces.isPending}
                  onClick={() => openDocumentChat.mutate(document)}
                >
                  <MessageSquare size={15} />
                  {openDocumentChat.isPending &&
                  openDocumentChat.variables?.id === document.id
                    ? "Abriendo chat…"
                    : "Chatear con fuente"}
                </Button>
                <div
                  className={cn(
                    "flex min-w-0 items-center gap-2",
                    view === "grid" ? "mt-2" : "sm:col-start-2 sm:row-start-2",
                  )}
                >
                  <ChoiceSelect
                    label={`Agregar ${document.title} a workspace`}
                    placeholder="Añadir a proyecto…"
                    value=""
                    onValueChange={async (id) => {
                      try {
                        await WorkspacesService.attachDocument({
                          path: { workspace_id: id, document_id: document.id },
                        })
                        openWorkspace(id, document.id, true)
                      } catch (error) {
                        setError(errorMessage(error))
                      }
                    }}
                    options={(workspaces.data ?? []).map((workspace) => ({
                      value: workspace.id,
                      label: workspace.name,
                    }))}
                    disabled={!workspaces.data?.length}
                    size="sm"
                    className="flex-1 text-xs"
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Opciones de ${document.title}`}
                      >
                        <MoreHorizontal size={16} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          setName(document.title)
                          setRenaming(document)
                        }}
                      >
                        <Pencil size={14} /> Renombrar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onSelect={() => setDeleting(document)}
                      >
                        <Trash2 size={14} /> Eliminar documento
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </article>
          ))}
        </div>
        {!documents.isPending && !visibleDocuments.length && (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            {search
              ? "No hay documentos con ese título."
              : "Importa documentos, audios o videos para comenzar tu biblioteca."}
          </div>
        )}
      </section>
      <footer className="flex flex-wrap gap-3 border-t pt-4 text-[10px] text-muted-foreground">
        <span>Almacenamiento local persistente</span>
        <span>·</span>
        <span>Sin telemetría externa</span>
        <span>·</span>
        <span>
          {providers.data?.filter((provider) => provider.status === "AVAILABLE")
            .length ?? 0}{" "}
          proveedores disponibles
        </span>
      </footer>
      <NameDialog
        open={newWorkspace}
        onOpenChange={setNewWorkspace}
        title="Nueva investigación"
        label="Nombre del workspace"
        placeholder="Ej. Energía y sostenibilidad"
        value={name}
        onValueChange={setName}
        onSubmit={() => createWorkspace.mutate()}
        submitLabel="Crear workspace"
        pending={createWorkspace.isPending}
      />
      <NameDialog
        open={!!renaming}
        onOpenChange={(open) => {
          if (!open) setRenaming(undefined)
        }}
        title="Renombrar documento"
        label="Título del documento"
        value={name}
        onValueChange={setName}
        onSubmit={() => rename.mutate()}
        submitLabel="Guardar título"
        pending={rename.isPending}
      />
      <ConfirmationDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined)
        }}
        title="Eliminar documento"
        description={`Se eliminará ${deleting?.title ?? "esta fuente"}, sus índices y sus evidencias. Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar documento"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate(deleting.id)
        }}
      />
      <ModelSettings
        open={modelsOpen}
        onOpenChange={setModelsOpen}
        providers={providers.data ?? []}
      />
    </div>
  )
}
