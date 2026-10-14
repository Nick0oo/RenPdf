import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Cloud, Server } from "lucide-react"
import { useState } from "react"
import {
  type ProviderConfig,
  ProvidersService,
  type RoutingInput,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  errorMessage,
  modelSelection,
  modelValue,
} from "@/features/research/api"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  providers: ProviderConfig[]
}
const tasks = {
  chat: "Conversación",
  embeddings: "Embeddings",
  vision: "Visión",
  questions: "Preguntas sugeridas",
  summary: "Resúmenes",
  rerank: "Reranking",
} as const

export function ModelSettings({ open, onOpenChange, providers }: Props) {
  const cache = useQueryClient()
  const [error, setError] = useState("")
  const routing = useQuery({
    queryKey: ["routing"],
    queryFn: async () => (await ProvidersService.readRouting()).data,
    enabled: open,
  })
  const diagnostics = useQuery({
    queryKey: ["diagnostics"],
    queryFn: async () => (await ProvidersService.diagnostics()).data,
    enabled: open,
  })
  const save = useMutation({
    mutationFn: (body: RoutingInput) => ProvidersService.saveRouting({ body }),
    onSuccess: () => {
      setError("")
      void cache.invalidateQueries({ queryKey: ["routing"] })
    },
    onError: (e) => setError(errorMessage(e)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modelos y procesamiento</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Las credenciales y endpoints se configuran en el servidor. Las
          capacidades del catálogo son declaradas; cada operación valida su
          resultado.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {providers.map((provider) => (
            <div key={provider.name} className="rounded-lg border p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 font-medium">
                  {provider.is_cloud ? (
                    <Cloud size={16} />
                  ) : (
                    <Server size={16} />
                  )}
                  {provider.name}
                </span>
                <Badge
                  variant={
                    provider.status === "AVAILABLE" ? "secondary" : "outline"
                  }
                >
                  {provider.status}
                </Badge>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {provider.endpoint || "Endpoint pendiente"}
              </p>
              <p className="mt-2 text-xs">
                {(provider.models ?? []).length} modelos detectados{" "}
                {provider.error_code && `· ${provider.error_code}`}
              </p>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {Object.entries(tasks).map(([task, title]) => {
            const current = routing.data?.find(
              (row) => row.task === task && row.scope_key === "personal",
            )
            const options = providers.flatMap((provider) =>
              (provider.models ?? [])
                .filter((model) =>
                  task === "embeddings"
                    ? model.capabilities?.embeddings !== "unsupported"
                    : task === "vision"
                      ? model.capabilities?.vision !== "unsupported" &&
                        model.capabilities?.text !== "unsupported"
                      : task === "rerank"
                        ? model.capabilities?.reranking === "declared"
                        : model.capabilities?.text !== "unsupported",
                )
                .map((model) => ({ ...model, name: provider.name })),
            )
            return (
              <label
                key={task}
                className="grid gap-1 text-sm sm:grid-cols-[180px_1fr] sm:items-center"
              >
                <span>{title}</span>
                <select
                  aria-label={`Modelo para ${title}`}
                  className="h-10 min-w-0 rounded-md border bg-background px-3"
                  value={
                    current ? modelValue(current.provider, current.model) : ""
                  }
                  onChange={(e) => {
                    if (e.target.value)
                      save.mutate({
                        ...modelSelection(e.target.value),
                        task: task as RoutingInput["task"],
                        scope_key: "personal",
                      })
                  }}
                >
                  <option value="">
                    {options.length
                      ? "Seleccionar modelo…"
                      : "Sin modelo compatible"}
                  </option>
                  {options.map((model) => (
                    <option
                      key={modelValue(model.name, model.id)}
                      value={modelValue(model.name, model.id)}
                    >
                      {model.name} · {model.id}
                    </option>
                  ))}
                </select>
              </label>
            )
          })}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {save.isSuccess && (
          <p className="flex items-center gap-2 text-xs text-primary">
            <CheckCircle2 size={14} /> Preferencia guardada en el servidor.
          </p>
        )}
        <div className="rounded-lg bg-muted p-4">
          <h3 className="mb-2 text-sm font-semibold">Diagnóstico</h3>
          <pre className="overflow-auto text-xs">
            {JSON.stringify(diagnostics.data, null, 2)}
          </pre>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void cache.invalidateQueries({ queryKey: ["providers"] })
            void diagnostics.refetch()
          }}
        >
          Comprobar conexiones
        </Button>
      </DialogContent>
    </Dialog>
  )
}
