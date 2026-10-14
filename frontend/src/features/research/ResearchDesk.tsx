import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowUpRight,
  BookOpen,
  FilePlus2,
  FolderPlus,
  Search,
  Settings2,
  Trash2,
} from "lucide-react"
import { lazy, Suspense, useRef, useState } from "react"
import { toast } from "sonner"
import { DocumentsService, ProvidersService, WorkspacesService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ModelSettings } from "@/features/models/ModelSettings"
import { apiRoot, errorMessage } from "./api"

const WorkspaceDesk = lazy(() =>
  import("./WorkspaceDesk").then((module) => ({
    default: module.WorkspaceDesk,
  })),
)

export function ResearchDesk() {
  const cache = useQueryClient()
  const [search, setSearch] = useState("")
  const [workspaceId, setWorkspaceId] = useState(
    localStorage.getItem("renpdf_workspace") ?? "",
  )
  const [newWorkspace, setNewWorkspace] = useState(false)
  const [name, setName] = useState("")
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
      toast.success("PDF guardado. La extracción continúa en el worker.")
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
    onSuccess: () => cache.invalidateQueries({ queryKey: ["documents"] }),
    onError: (e) => setError(errorMessage(e)),
  })
  function openWorkspace(id: string) {
    setWorkspaceId(id)
    localStorage.setItem("renpdf_workspace", id)
  }
  const active = workspaces.data?.find(
    (workspace) => workspace.id === workspaceId,
  )
  if (active)
    return (
      <Suspense
        fallback={
          <div className="animate-pulse rounded-xl border p-16">
            Abriendo investigación…
          </div>
        }
      >
        <WorkspaceDesk
          key={active.id}
          workspace={active}
          library={documents.data ?? []}
          providers={providers.data ?? []}
          onBack={() => openWorkspace("")}
        />
      </Suspense>
    )
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.22em] text-primary">
            Tu biblioteca de investigación
          </p>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Tus fuentes. Tus respuestas.
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Lee, conecta ideas y vuelve a la evidencia. Tus documentos
            permanecen aquí; tú decides cuándo compartir contenido con un
            modelo.
          </p>
        </div>
        <Button variant="outline" onClick={() => setModelsOpen(true)}>
          <Settings2 size={16} /> Modelos
        </Button>
      </header>
      <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]">
        <section
          aria-label="Importar documentos"
          className={`relative overflow-hidden rounded-2xl border border-dashed p-7 transition-colors ${dragging ? "border-primary bg-primary/10" : "bg-primary/[0.03]"}`}
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
          <FilePlus2 className="mb-4 text-primary" size={27} />
          <h2 className="font-semibold">Una nueva fuente, una nueva idea</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Arrastra tus PDFs aquí. Hasta 50 MB y 500 páginas por archivo, con
            procesamiento progresivo.
          </p>
          <Button
            className="mt-5"
            disabled={upload.isPending}
            onClick={() => uploadInput.current?.click()}
          >
            {upload.isPending ? "Guardando archivo…" : "Importar PDF"}
            <ArrowUpRight size={16} />
          </Button>
          <input
            ref={uploadInput}
            data-testid="pdf-upload"
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length)
                upload.mutate(Array.from(e.target.files))
              e.target.value = ""
            }}
          />
        </section>
        <section className="rounded-2xl border p-7">
          <BookOpen size={27} className="mb-4 text-primary" />
          <h2 className="font-semibold">Investiga con varias fuentes</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Agrupa documentos, compara resultados y guarda tus conversaciones y
            notas.
          </p>
          <Button
            variant="outline"
            className="mt-5"
            onClick={() => setNewWorkspace(true)}
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Workspaces</h2>
          <span className="text-xs text-muted-foreground">
            {workspaces.data?.length ?? 0} colecciones
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.data?.map((workspace) => (
            <button
              type="button"
              key={workspace.id}
              onClick={() => openWorkspace(workspace.id)}
              className="group flex items-center gap-4 rounded-xl border p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <div className="grid size-10 place-content-center rounded-lg bg-primary/10 text-primary">
                <BookOpen size={19} />
              </div>
              <div className="mr-auto min-w-0">
                <h3 className="truncate text-sm font-medium">
                  {workspace.name}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Abrir investigación
                </p>
              </div>
              <ArrowUpRight
                size={16}
                className="text-muted-foreground group-hover:text-primary"
              />
            </button>
          ))}
        </div>
        {!workspaces.isPending && !workspaces.data?.length && (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            Crea un workspace para reunir tus fuentes y empezar una
            conversación.
          </p>
        )}
      </section>
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
        {documents.isPending && (
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((index) => (
              <div
                key={index}
                className="h-52 animate-pulse rounded-xl bg-muted"
              />
            ))}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {documents.data?.map((document) => (
            <article
              key={document.id}
              className="overflow-hidden rounded-xl border bg-background"
            >
              <div className="flex h-36 items-center justify-center border-b bg-muted/35 p-3">
                <img
                  src={`${apiRoot}/documents/${document.id}/thumbnail`}
                  alt={`Miniatura de ${document.title}`}
                  className="max-h-full max-w-full shadow-sm"
                  loading="lazy"
                />
              </div>
              <div className="p-4">
                <h3
                  className="truncate text-sm font-semibold"
                  title={document.title}
                >
                  {document.title}
                </h3>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {document.page_count} páginas ·{" "}
                    {(document.file_size / 1024 / 1024).toFixed(1)} MB
                  </span>
                  <Badge
                    variant={
                      document.status === "READY" ? "secondary" : "outline"
                    }
                    className="text-[9px]"
                  >
                    {document.status}
                  </Badge>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Agregar ${document.title} a workspace`}
                    value=""
                    className="mr-auto h-8 max-w-40 rounded border bg-background px-2 text-xs"
                    onChange={async (e) => {
                      if (!e.target.value) return
                      try {
                        await WorkspacesService.attachDocument({
                          path: {
                            workspace_id: e.target.value,
                            document_id: document.id,
                          },
                        })
                        openWorkspace(e.target.value)
                      } catch (error) {
                        setError(errorMessage(error))
                      }
                    }}
                  >
                    <option value="">Abrir en workspace…</option>
                    {workspaces.data?.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Renombrar ${document.title}`}
                    onClick={async () => {
                      const title = window.prompt(
                        "Nuevo título",
                        document.title,
                      )
                      if (title?.trim()) {
                        await DocumentsService.renameDocument({
                          path: { document_id: document.id },
                          body: { title },
                        })
                        await documents.refetch()
                      }
                    }}
                  >
                    ✎
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Eliminar ${document.title}`}
                    onClick={() => {
                      if (
                        window.confirm(
                          "¿Eliminar este documento y sus evidencias? Esta acción no se puede deshacer.",
                        )
                      )
                        remove.mutate(document.id)
                    }}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
        {!documents.isPending && !documents.data?.length && (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            {search
              ? "No hay documentos con ese título."
              : "Tu biblioteca empieza con un PDF. Importa una fuente para comenzar."}
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
      <Dialog open={newWorkspace} onOpenChange={setNewWorkspace}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva investigación</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              createWorkspace.mutate()
            }}
          >
            <Input
              autoFocus
              aria-label="Nombre del workspace"
              placeholder="Ej. Energía y sostenibilidad"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
            <Button
              type="submit"
              disabled={!name.trim() || createWorkspace.isPending}
            >
              Crear workspace
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <ModelSettings
        open={modelsOpen}
        onOpenChange={setModelsOpen}
        providers={providers.data ?? []}
      />
    </div>
  )
}
