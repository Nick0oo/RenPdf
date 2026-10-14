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
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  errorMessage,
  modelSelection,
  modelValue,
} from "@/features/research/api"
import { ProviderModelSelect } from "./ProviderModelSelect"

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
const descriptions = {
  chat: "Responde tus preguntas con fuentes.",
  embeddings: "Prepara la búsqueda por significado.",
  vision: "Analiza una región visual seleccionada.",
  questions: "Propone preguntas sobre el PDF.",
  summary: "Resume las evidencias del documento.",
  rerank: "Ordena los resultados recuperados.",
}

export function ModelSettings({ open, onOpenChange, providers }: Props) {
  const cache = useQueryClient()
  const [error, setError] = useState("")
  const [tab, setTab] = useState("modelos")
  const routing = useQuery({
    queryKey: ["routing"],
    queryFn: async () => (await ProvidersService.readRouting()).data,
    enabled: open,
  })
  const diagnostics = useQuery({
    queryKey: ["diagnostics"],
    queryFn: async () => (await ProvidersService.diagnostics()).data,
    enabled: open && tab === "conexiones",
  })
  const save = useMutation({
    mutationFn: (body: RoutingInput) => ProvidersService.saveRouting({ body }),
    onSuccess: () => {
      setError("")
      void cache.invalidateQueries({ queryKey: ["routing"] })
    },
    onError: (failure) => setError(errorMessage(failure)),
  })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Modelos y procesamiento</DialogTitle>
          <DialogDescription>
            Elige un modelo por tarea. Puedes usar proveedores locales o
            autorizar envíos a la nube por documento.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="modelos">Modelos por tarea</TabsTrigger>
            <TabsTrigger value="conexiones">Conexiones</TabsTrigger>
          </TabsList>
          <TabsContent value="modelos" className="space-y-5 pt-3">
            <div className="grid gap-x-5 gap-y-6 sm:grid-cols-2">
              {Object.entries(tasks).map(([task, title]) => {
                const current = routing.data?.find(
                  (row) => row.task === task && row.scope_key === "personal",
                )
                return (
                  <div key={task} className="space-y-2">
                    <Label>{title}</Label>
                    <p className="min-h-8 text-xs leading-relaxed text-muted-foreground">
                      {descriptions[task as keyof typeof descriptions]}
                    </p>
                    <ProviderModelSelect
                      providers={providers}
                      task={task as RoutingInput["task"]}
                      label={`Modelo para ${title}`}
                      value={
                        current
                          ? modelValue(current.provider, current.model)
                          : ""
                      }
                      disabled={save.isPending}
                      onValueChange={(value) =>
                        save.mutate({
                          ...modelSelection(value),
                          task: task as RoutingInput["task"],
                          scope_key: "personal",
                        })
                      }
                    />
                  </div>
                )
              })}
            </div>
            <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">
              Las preferencias se guardan para tu cuenta. El modelo de un chat
              abierto se cambia desde ese chat. Las claves se configuran en el
              servidor.
            </p>
          </TabsContent>
          <TabsContent value="conexiones" className="space-y-4 pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              {providers.map((provider) => (
                <div
                  key={provider.name}
                  className="space-y-2 rounded-xl border p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      {provider.is_cloud ? (
                        <Cloud size={15} />
                      ) : (
                        <Server size={15} />
                      )}
                      {provider.name}
                    </span>
                    <Badge
                      variant={
                        provider.status === "AVAILABLE"
                          ? "secondary"
                          : "outline"
                      }
                      className="text-[10px]"
                    >
                      {{
                        AVAILABLE: "Disponible",
                        UNAVAILABLE: "Sin conexión",
                        NOT_CONFIGURED: "Sin configurar",
                      }[provider.status] ?? provider.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {provider.is_cloud
                      ? "Proveedor en la nube"
                      : "Proveedor local"}
                  </p>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={provider.endpoint ?? undefined}
                  >
                    {provider.endpoint || "Endpoint pendiente"}
                  </p>
                  <p className="text-xs">
                    {provider.models?.length ?? 0} modelos detectados
                    {provider.error_code ? ` · ${provider.error_code}` : ""}
                  </p>
                </div>
              ))}
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
            <div className="rounded-xl border bg-muted/15 p-4">
              <h3 className="mb-3 text-sm font-semibold">
                Diagnóstico del servidor
              </h3>
              {diagnostics.isPending ? (
                <p className="text-xs text-muted-foreground">
                  Comprobando procesamiento…
                </p>
              ) : (
                <pre className="max-h-48 overflow-auto text-[11px] leading-5">
                  {JSON.stringify(diagnostics.data, null, 2)}
                </pre>
              )}
            </div>
          </TabsContent>
        </Tabs>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive"
          >
            {error}
          </p>
        )}
        {save.isSuccess && (
          <p
            role="status"
            className="flex items-center gap-2 text-xs text-primary"
          >
            <CheckCircle2 size={14} /> Preferencia guardada.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
