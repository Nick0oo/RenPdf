import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Cloud, Layers3, LoaderCircle, Server } from "lucide-react"
import { useState } from "react"
import type { DocumentPublic, ProviderConfig } from "@/client"
import { DocumentsService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ProviderModelSelect } from "@/features/models/ProviderModelSelect"
import { errorMessage, modelValue } from "@/features/research/api"
import { moduleRequest } from "@/features/trace/api"
import { sourceType } from "./location"

export function NativeMediaIndex({
  document,
  providers,
  onDocumentsChange,
}: {
  document: DocumentPublic
  providers: ProviderConfig[]
  onDocumentsChange: () => void
}) {
  const cache = useQueryClient()
  const [choice, setChoice] = useState(
    () => localStorage.getItem(`native-index-model:${document.id}`) ?? "",
  )
  const compatible = providers
    .filter(
      (provider) =>
        ["embeddinggemma", "gemini"].includes(provider.name) &&
        (provider.is_cloud || provider.status === "AVAILABLE"),
    )
    .map((provider) => ({
      ...provider,
      models: provider.models?.filter(
        (model) =>
          (provider.name === "embeddinggemma"
            ? model.id === "embeddinggemma-2-native"
            : model.id.startsWith("gemini-embedding-2")) &&
          ["declared", "verified"].includes(
            model.capabilities?.embeddings ?? "",
          ) &&
          ["declared", "verified"].includes(model.capabilities?.audio ?? "") &&
          (sourceType(document) !== "video" ||
            ["declared", "verified"].includes(model.capabilities?.video ?? "")),
      ),
    }))
    .filter((provider) => provider.models?.length)
  const preferred =
    compatible.find((provider) => !provider.is_cloud) ?? compatible[0]
  const value =
    choice ||
    (preferred?.models?.[0]
      ? modelValue(preferred.name, preferred.models[0].id)
      : "")
  const [providerName, ...modelParts] = value.split("|")
  const model = modelParts.join("|")
  const selectedProvider = compatible.find(
    (provider) => provider.name === providerName,
  )
  const available = !!selectedProvider?.models?.some(
    (item) => item.id === model,
  )
  const cloud = selectedProvider?.is_cloud === true
  const jobs = useQuery({
    queryKey: ["jobs", document.id],
    queryFn: async () =>
      (
        await DocumentsService.documentJobs({
          path: { document_id: document.id },
        })
      ).data,
  })
  const busy =
    jobs.data?.some((job) => ["QUEUED", "RUNNING"].includes(job.state)) ?? false
  const consents = useQuery({
    queryKey: ["consents", document.id],
    queryFn: async () =>
      (await DocumentsService.consents({ path: { document_id: document.id } }))
        .data,
    enabled: cloud,
  })
  const hasConsent = (scope: string) =>
    consents.data?.some(
      (row) =>
        row.provider === "gemini" &&
        row.scope === scope &&
        !row.revoked_at &&
        Date.parse(row.expires_at) > Date.now(),
    ) ?? false
  const scopes = ["embeddings", "multimodal_embeddings", "chat"] as const
  const authorized = scopes.every(hasConsent)
  const prepare = useMutation({
    mutationFn: async () => {
      if (cloud)
        for (const scope of scopes) {
          if (!hasConsent(scope))
            await DocumentsService.grantConsent({
              path: { document_id: document.id },
              body: { provider: "gemini", scope, expires_in_days: 30 },
            })
        }
      return moduleRequest(`/documents/${document.id}/prepare-native`, {
        provider: providerName,
        model,
        dimensions: 768,
        modality: "multimodal",
      })
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["jobs", document.id] })
      void cache.invalidateQueries({
        queryKey: ["document-coverage", document.id],
      })
      onDocumentsChange()
    },
    onSettled: () => {
      if (cloud)
        void cache.invalidateQueries({ queryKey: ["consents", document.id] })
    },
  })
  return (
    <section
      aria-label="Indexación multimedia nativa"
      className="flex flex-col gap-3 rounded-lg border bg-background p-3"
    >
      <div className="flex items-center gap-2">
        <Layers3 size={16} className="text-primary" />
        <h3 className="text-sm font-semibold">
          Indexar audio y video directamente
        </h3>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Genera embeddings desde los segmentos originales. La transcripción no es
        un requisito; el chat recupera y lee el audio o video que corresponde a
        tu pregunta. Para leer clips originales elige un modelo de chat
        compatible con audio o video.
      </p>
      <ProviderModelSelect
        providers={compatible}
        task="embeddings"
        label="Modelo de embeddings multimedia nativos"
        value={value}
        onValueChange={(next) => {
          setChoice(next)
          localStorage.setItem(`native-index-model:${document.id}`, next)
        }}
        disabled={prepare.isPending || busy}
        size="sm"
      />
      {!available && (
        <p role="status" className="text-xs leading-5 text-muted-foreground">
          No hay un modelo nativo disponible para esta fuente. Configura
          EmbeddingGemma local o Gemini y actualiza el catálogo.
          <Button
            size="sm"
            variant="link"
            className="h-auto p-0"
            onClick={() =>
              void cache.invalidateQueries({ queryKey: ["providers"] })
            }
          >
            Actualizar modelos
          </Button>
        </p>
      )}
      {available && (
        <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
          {cloud ? (
            <Cloud size={14} className="mt-0.5 shrink-0" />
          ) : (
            <Server size={14} className="mt-0.5 shrink-0" />
          )}
          <span>
            {cloud
              ? "Gemini recibirá los segmentos para crear embeddings y los recuperados para el chat. Autorizarás embeddings, embeddings multimodales y chat sólo para esta fuente durante 30 días."
              : "La indexación nativa se ejecuta en tu equipo. El chat usa el modelo de conversación elegido y sus permisos."}
          </span>
        </p>
      )}
      <Button
        className="h-auto min-h-9 whitespace-normal py-2 text-center leading-5"
        disabled={
          !available ||
          prepare.isPending ||
          busy ||
          jobs.isPending ||
          jobs.isError ||
          (cloud && (consents.isPending || consents.isError)) ||
          ["UPLOADED", "PROCESSING"].includes(document.status)
        }
        onClick={() => prepare.mutate()}
      >
        {prepare.isPending ? (
          <LoaderCircle data-icon="inline-start" className="animate-spin" />
        ) : (
          <Layers3 data-icon="inline-start" />
        )}
        {prepare.isPending
          ? "Solicitando indexación…"
          : cloud
            ? authorized
              ? "Indexar nativamente con Gemini"
              : "Autorizar embeddings, embeddings multimodales y chat con Gemini"
            : "Indexar nativamente en local"}
      </Button>
      {prepare.isSuccess && (
        <p role="status" className="text-xs text-primary">
          Indexación nativa solicitada. Puedes seguir usando el workspace.
        </p>
      )}
      {(prepare.error || jobs.error || (cloud && consents.error)) && (
        <Alert variant="destructive">
          <AlertTitle>No se pudo preparar la indexación</AlertTitle>
          <AlertDescription>
            {errorMessage(prepare.error || jobs.error || consents.error)}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void jobs.refetch()
                if (cloud) void consents.refetch()
              }}
            >
              Revisar estado y permisos
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}
