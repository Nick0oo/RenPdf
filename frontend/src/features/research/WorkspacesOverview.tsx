import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { ArrowUpRight, FolderOpen, Plus, Search } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { ChatService, WorkspacesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { errorMessage } from "./api"
import { NameDialog } from "./NameDialog"
import { chatDate } from "./presentation"

export function WorkspacesOverview() {
  const cache = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState("")
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => (await WorkspacesService.listWorkspaces()).data,
  })
  const details = useQuery({
    queryKey: [
      "workspace-overview",
      workspaces.data?.map((row) => row.id).join(","),
    ],
    enabled: !!workspaces.data?.length,
    queryFn: async () =>
      Promise.all(
        (workspaces.data ?? []).map(async (workspace) => {
          const [documents, conversations] = await Promise.all([
            WorkspacesService.listWorkspaceDocuments({
              path: { workspace_id: workspace.id },
            }),
            ChatService.conversations({ path: { workspace_id: workspace.id } }),
          ])
          return {
            id: workspace.id,
            documents: documents.data,
            conversations: conversations.data,
          }
        }),
      ),
  })
  const create = useMutation({
    mutationFn: () =>
      WorkspacesService.createWorkspace({ body: { name: name.trim() } }),
    onSuccess: (response) => {
      void cache.invalidateQueries({ queryKey: ["workspaces"] })
      setCreating(false)
      void navigate({
        to: "/workspaces/$workspaceId",
        params: { workspaceId: response.data.id },
        search: { document: undefined, start: undefined },
      })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const visible =
    workspaces.data?.filter((workspace) =>
      `${workspace.name} ${workspace.description}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? []
  return (
    <div className="mx-auto max-w-6xl space-y-8 px-5 py-7 md:px-9 md:py-9">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            Tus workspaces
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Un espacio para cada investigación. Reúne tus PDFs, conversa con las
            fuentes y conserva las ideas que quieres seguir.
          </p>
        </div>
        <Button
          onClick={() => {
            setName("")
            setCreating(true)
          }}
        >
          <Plus size={16} /> Nuevo workspace
        </Button>
      </header>
      <div className="flex items-center justify-between gap-4 border-b pb-4">
        <p className="text-sm text-muted-foreground">
          {workspaces.data?.length ?? 0} espacios de investigación
        </p>
        <div className="relative max-w-xs">
          <Search
            size={15}
            className="absolute left-3 top-3 text-muted-foreground"
          />
          <Input
            aria-label="Buscar workspaces"
            placeholder="Buscar workspace…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
      </div>
      {workspaces.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(workspaces.error)}
        </p>
      )}
      {details.error && (
        <p role="alert" className="text-sm text-destructive">
          No se pudieron cargar las fuentes y conversaciones.{" "}
          {errorMessage(details.error)}
        </p>
      )}
      {workspaces.isPending && (
        <p className="text-sm text-muted-foreground">Cargando tus espacios…</p>
      )}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((workspace) => {
          const info = details.data?.find((row) => row.id === workspace.id)
          return (
            <Link
              key={workspace.id}
              to="/workspaces/$workspaceId"
              params={{ workspaceId: workspace.id }}
              search={{ document: undefined, start: undefined }}
              className="group flex min-h-56 flex-col rounded-2xl border bg-background p-6 transition-colors hover:border-primary/50"
            >
              <div className="mb-5 flex items-center justify-between">
                <FolderOpen size={23} className="text-primary" />
                <ArrowUpRight size={16} className="text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold leading-snug">
                {workspace.name}
              </h2>
              <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted-foreground">
                {workspace.description ||
                  (info?.documents.length
                    ? info.documents
                        .slice(0, 2)
                        .map((document) => document.title)
                        .join(", ")
                    : "Añade fuentes y empieza una nueva conversación.")}
              </p>
              <div className="mt-auto flex items-center justify-between gap-2 pt-6 text-xs text-muted-foreground">
                <span>
                  {info
                    ? `${info.documents.length} PDFs · ${info.conversations.length} chats`
                    : details.error
                      ? "Fuentes no disponibles"
                      : "Cargando fuentes…"}
                </span>
                <span>
                  {chatDate(
                    info?.conversations[0]?.created_at ?? workspace.created_at,
                  )}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
      {!workspaces.isPending && !visible.length && (
        <div className="py-14 text-center">
          <FolderOpen
            className="mx-auto mb-4 text-muted-foreground"
            size={36}
          />
          <h2 className="text-lg font-semibold">
            {search
              ? "No encontramos ese workspace"
              : "Empieza tu primera investigación"}
          </h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
            {search
              ? "Prueba con otro nombre."
              : "Crea un workspace y añade los PDFs sobre los que quieres conversar."}
          </p>
          {!search && (
            <Button className="mt-5" onClick={() => setCreating(true)}>
              Crear workspace
            </Button>
          )}
        </div>
      )}
      <NameDialog
        open={creating}
        onOpenChange={setCreating}
        title="Nuevo workspace"
        label="Nombre del workspace"
        value={name}
        onValueChange={setName}
        onSubmit={() => create.mutate()}
        submitLabel="Crear workspace"
        pending={create.isPending}
      />
    </div>
  )
}
