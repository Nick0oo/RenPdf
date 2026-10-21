import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { DocumentsService, ProvidersService, WorkspacesService } from "@/client"
import { errorMessage } from "@/features/research/api"
import { WorkspaceDesk } from "@/features/research/WorkspaceDesk"
export const Route = createFileRoute("/_layout/workspaces/$workspaceId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    document?: string
    start?: boolean
    time?: number
    sheet?: string
    cell?: string
  } => ({
    document: typeof search.document === "string" ? search.document : undefined,
    start: search.start === true || search.start === "true" ? true : undefined,
    sheet:
      typeof search.sheet === "string" ? search.sheet.slice(0, 100) : undefined,
    cell:
      typeof search.cell === "string" &&
      /^\$?[A-Za-z]+\$?[1-9]\d*(?::\$?[A-Za-z]+\$?[1-9]\d*)?$/.test(search.cell)
        ? search.cell
        : undefined,
    time:
      search.time !== undefined &&
      Number.isFinite(Number(search.time)) &&
      Number(search.time) >= 0
        ? Number(search.time)
        : undefined,
  }),
  component: WorkspacePage,
})
function WorkspacePage() {
  const navigate = useNavigate()
  const { workspaceId } = Route.useParams()
  const search = Route.useSearch()
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => (await WorkspacesService.listWorkspaces()).data,
  })
  const library = useQuery({
    queryKey: ["documents", ""],
    queryFn: async () => (await DocumentsService.listDocuments()).data,
    refetchInterval: 4000,
  })
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: async () => (await ProvidersService.providerCatalog()).data,
    staleTime: 60000,
  })
  const workspace = workspaces.data?.find((item) => item.id === workspaceId)
  if (workspaces.isPending)
    return (
      <div className="p-8 text-sm text-muted-foreground">
        Abriendo workspace…
      </div>
    )
  if (!workspace)
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold">Workspace no disponible</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {workspaces.error
            ? errorMessage(workspaces.error)
            : "Vuelve a tus espacios para abrir otra investigación."}
        </p>
        <Link to="/" className="mt-4 inline-block text-primary">
          Volver a workspaces
        </Link>
      </div>
    )
  return (
    <WorkspaceDesk
      key={workspaceId}
      workspace={workspace}
      library={library.data ?? []}
      providers={providers.data ?? []}
      entryDocumentId={search.document}
      entryTime={search.time}
      entrySheet={search.sheet}
      entryCell={search.cell}
      openChatOnLoad={search.start}
      onBack={() => void navigate({ to: "/" })}
    />
  )
}
