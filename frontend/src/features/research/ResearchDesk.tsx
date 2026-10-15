import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  ArrowUpRight,
  BookOpen,
  FilePlus2,
  FolderPlus,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Search,
  Settings2,
  Trash2,
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
import { ModelSettings } from "@/features/models/ModelSettings"
import { apiRoot, errorMessage } from "./api"
import { ChoiceSelect } from "./ChoiceSelect"
import { ConfirmationDialog } from "./ConfirmationDialog"
import { NameDialog } from "./NameDialog"
import { documentStatus } from "./presentation"

export function ResearchDesk() {
  const cache = useQueryClient()
  const [search, setSearch] = useState("")
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
        "PDF importado. Se está preparando el texto para tus preguntas.",
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
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-5 py-7 md:px-9 md:py-9">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            Tu biblioteca
          </h1>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
            Abre un chat con tus PDFs o reúne varias fuentes en un proyecto. Tú
            decides cuándo compartir contenido con un modelo.
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
          <h2 className="font-semibold">Importa un PDF</h2>
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
          <h2 className="font-semibold">Agrupa tus fuentes</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Agrupa documentos, compara resultados y guarda tus conversaciones y
            notas.
          </p>
          <Button
            variant="outline"
            className="mt-5"
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
                    {documentStatus(document.status)}
                  </Badge>
                </div>
                <Button
                  className="mt-4 w-full"
                  aria-label={`Chatear con ${document.title}`}
                  disabled={openDocumentChat.isPending || workspaces.isPending}
                  onClick={() => openDocumentChat.mutate(document)}
                >
                  <MessageSquare size={15} />
                  {openDocumentChat.isPending &&
                  openDocumentChat.variables?.id === document.id
                    ? "Abriendo chat…"
                    : "Chatear con PDF"}
                </Button>
                <div className="mt-2 flex flex-wrap items-center gap-2">
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
        description={`Se eliminará ${deleting?.title ?? "este PDF"}, sus índices y sus evidencias. Esta acción no se puede deshacer.`}
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
