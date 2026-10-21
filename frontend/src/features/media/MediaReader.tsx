import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Headphones,
  LoaderCircle,
  Play,
  ShieldCheck,
  Video,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { DocumentPublic, EvidencePublic, ProviderConfig } from "@/client"
import { DocumentsService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ProviderModelSelect } from "@/features/models/ProviderModelSelect"
import {
  apiRoot,
  errorMessage,
  modelSelection,
  modelValue,
} from "@/features/research/api"
import { processingLabel } from "@/features/research/presentation"
import { moduleRequest } from "@/features/trace/api"
import { formatTime, sourceLocation, sourceType } from "./location"
import { NativeMediaIndex } from "./NativeMediaIndex"

type Segment = {
  id: string
  chunk_id: string
  source_type: "audio" | "video"
  start_seconds: number
  end_seconds: number
  text: string
}
type Segments = {
  data: Segment[]
  total: number
  offset: number
  limit: number
}

export function MediaReader({
  document,
  citation,
  initialTime,
  providers,
  onDocumentsChange,
}: {
  document: DocumentPublic
  citation?: EvidencePublic
  initialTime?: number
  providers: ProviderConfig[]
  onDocumentsChange: () => void
}) {
  const cache = useQueryClient()
  const player = useRef<HTMLMediaElement | null>(null)
  const [offset, setOffset] = useState(0)
  const [playbackError, setPlaybackError] = useState(false)
  const [position, setPosition] = useState(
    citation?.start_seconds ?? initialTime ?? 0,
  )
  const [model, setModel] = useState("")
  const gemini = providers
    .filter((provider) => provider.name === "gemini")
    .map((provider) => ({
      ...provider,
      models: provider.models?.filter(
        (item) =>
          item.capabilities?.audio !== "unsupported" &&
          (sourceType(document) !== "video" ||
            item.capabilities?.video !== "unsupported"),
      ),
    }))
  const defaultModel =
    gemini
      .flatMap((provider) => provider.models ?? [])
      .find((item) => item.id === "gemini-2.5-flash")?.id ??
    gemini
      .flatMap((provider) => provider.models ?? [])
      .find((item) => item.capabilities?.text !== "unsupported")?.id ??
    ""
  const modelChoice =
    model || (defaultModel ? modelValue("gemini", defaultModel) : "")
  const isVideo = sourceType(document) === "video"
  const playbackReady =
    [
      "MEDIA_READY",
      "ANALYSIS_QUEUED",
      "ANALYZING",
      "ANALYSIS_FAILED",
      "NATIVE_QUEUED",
      "NATIVE_PREPARING",
      "INDEXING",
    ].includes(document.status) || !!document.current_version_id
  const jobs = useQuery({
    queryKey: ["jobs", document.id],
    queryFn: async () =>
      (
        await DocumentsService.documentJobs({
          path: { document_id: document.id },
        })
      ).data,
    refetchInterval: (query) =>
      query.state.data?.some((job) => ["QUEUED", "RUNNING"].includes(job.state))
        ? 2000
        : false,
  })
  const consents = useQuery({
    queryKey: ["consents", document.id],
    queryFn: async () =>
      (await DocumentsService.consents({ path: { document_id: document.id } }))
        .data,
  })
  const segments = useQuery({
    queryKey: [
      "media-segments",
      document.id,
      document.current_version_id,
      offset,
    ],
    queryFn: () =>
      moduleRequest<Segments>(
        `/documents/${document.id}/segments?offset=${offset}&limit=30`,
      ),
    enabled: !!document.current_version_id,
  })
  const activeJob = jobs.data?.find((job) =>
    ["QUEUED", "RUNNING"].includes(job.state),
  )
  const preparationJob = jobs.data?.find((job) =>
    ["media_analysis", "native_prepare", "index"].includes(
      job.kind.toLowerCase(),
    ),
  )
  const latestJob = jobs.data?.[0]
  const failedJob =
    latestJob && ["FAILED", "CANCELLED"].includes(latestJob.state)
      ? latestJob
      : undefined
  const hasConsent = (scope: string) =>
    consents.data?.some(
      (consent) =>
        consent.provider === "gemini" &&
        consent.scope === scope &&
        !consent.revoked_at &&
        Date.parse(consent.expires_at) > Date.now(),
    ) ?? false
  const authorized = hasConsent("media_analysis") && hasConsent("chat")
  const analyze = useMutation({
    mutationFn: async () => {
      // These grants are only made from the explicit, purpose-labelled action below.
      for (const scope of ["media_analysis", "chat"] as const) {
        if (!hasConsent(scope))
          await DocumentsService.grantConsent({
            path: { document_id: document.id },
            body: { provider: "gemini", scope, expires_in_days: 30 },
          })
      }
      return moduleRequest(
        `/documents/${document.id}/analyze`,
        modelSelection(modelChoice),
      )
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["jobs", document.id] })
      onDocumentsChange()
      toast.success("Análisis solicitado; puedes seguir usando el chat")
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSettled: () =>
      cache.invalidateQueries({ queryKey: ["consents", document.id] }),
  })
  const previousState = useRef<string | undefined>(undefined)
  useEffect(() => {
    const state = preparationJob?.state
    if (
      previousState.current &&
      previousState.current !== state &&
      state === "SUCCEEDED"
    ) {
      onDocumentsChange()
      void cache.invalidateQueries({
        queryKey: ["media-segments", document.id],
      })
      void cache.invalidateQueries({
        queryKey: ["document-coverage", document.id],
      })
    }
    previousState.current = state
  }, [preparationJob?.state, cache, document.id, onDocumentsChange])
  const seek = (seconds: number) => {
    setPosition(seconds)
    if (player.current && player.current.readyState > 0)
      player.current.currentTime = seconds
  }
  useEffect(() => {
    const seconds = citation?.start_seconds ?? initialTime
    if (seconds != null) {
      setPosition(seconds)
      if (player.current && player.current.readyState > 0)
        player.current.currentTime = seconds
    }
  }, [citation, initialTime])
  const mediaProps = {
    src: `${apiRoot}/documents/${document.id}/playback`,
    controls: true,
    preload: "metadata" as const,
    crossOrigin: "use-credentials" as const,
    onLoadedMetadata: () => {
      setPlaybackError(false)
      if (player.current) player.current.currentTime = position
    },
    onError: () => setPlaybackError(true),
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3">
      <div className="shrink-0 rounded-lg border bg-background p-3">
        <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
          {isVideo ? <Video size={15} /> : <Headphones size={15} />}
          {isVideo ? "Video" : "Audio"} ·{" "}
          {formatTime(document.duration_seconds)}
          <span className="ml-auto">Inicio: {formatTime(position)}</span>
        </p>
        {!playbackReady ? (
          <p role="status" className="text-xs text-muted-foreground">
            Preparando el reproductor local…
          </p>
        ) : isVideo ? (
          <video
            ref={(node) => {
              player.current = node
            }}
            {...mediaProps}
            aria-label={`Video ${document.title}`}
            className="max-h-[38vh] w-full rounded-md bg-black"
          />
        ) : (
          <audio
            ref={(node) => {
              player.current = node
            }}
            {...mediaProps}
            aria-label={`Audio ${document.title}`}
            className="w-full"
          />
        )}
        {playbackError && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            No se pudo reproducir esta fuente. Comprueba su procesamiento y
            vuelve a abrirla.
          </p>
        )}
      </div>
      <NativeMediaIndex
        document={document}
        providers={providers}
        onDocumentsChange={onDocumentsChange}
      />
      {!activeJob && (
        <details className="rounded-lg border bg-background p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Transcripción completa (opcional)
          </summary>
          <Alert className="mt-3">
            <ShieldCheck />
            <AlertTitle>Transcripción con Gemini</AlertTitle>
            <AlertDescription>
              <p>
                Esta opción crea una transcripción legible, por separado de la
                indexación nativa. Gemini recibe los segmentos de{" "}
                {isVideo ? "video y audio" : "audio"} para transcribirlos y
                analizarlos. El chat enviará fragmentos recuperados. Estas
                autorizaciones duran 30 días y se aplican sólo a esta fuente.
              </p>
              <div className="mt-2 flex w-full flex-col gap-3">
                <ProviderModelSelect
                  providers={gemini}
                  task="chat"
                  label="Modelo para analizar audio y video"
                  value={modelChoice}
                  onValueChange={setModel}
                  disabled={analyze.isPending}
                  size="sm"
                />
                <Button
                  className="h-auto min-h-9 whitespace-normal py-2 text-center leading-5"
                  disabled={
                    !modelChoice ||
                    analyze.isPending ||
                    consents.isPending ||
                    consents.isError ||
                    jobs.isPending ||
                    jobs.isError ||
                    ["UPLOADED", "PROCESSING"].includes(document.status)
                  }
                  onClick={() => analyze.mutate()}
                >
                  {analyze.isPending ? (
                    <LoaderCircle
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                  ) : (
                    <ShieldCheck data-icon="inline-start" />
                  )}
                  {analyze.isPending
                    ? "Solicitando…"
                    : authorized
                      ? "Analizar fuente"
                      : "Autorizar análisis y chat con Gemini"}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        </details>
      )}
      {document.warning && (
        <p className="text-xs leading-5 text-muted-foreground">
          {document.warning.replace(
            "Autoriza el análisis de segmentos para consultar su contenido.",
            "Prepara la indexación nativa para consultar su contenido.",
          )}
        </p>
      )}
      {analyze.error && (
        <Alert variant="destructive">
          <AlertTitle>No se pudo iniciar el análisis</AlertTitle>
          <AlertDescription>{errorMessage(analyze.error)}</AlertDescription>
        </Alert>
      )}
      {(consents.isError || jobs.isError) && (
        <Alert variant="destructive">
          <AlertTitle>No se pudo consultar el procesamiento</AlertTitle>
          <AlertDescription>
            {errorMessage(consents.error || jobs.error)}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void consents.refetch()
                void jobs.refetch()
              }}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {(activeJob || failedJob) &&
        (() => {
          const job = activeJob ?? failedJob!
          return (
            <div
              role="status"
              className="flex flex-col gap-2 rounded-lg border bg-background p-3 text-xs"
            >
              <div className="flex justify-between gap-3">
                <span>{processingLabel(job.kind, job.state)}</span>
                <span>{job.progress}%</span>
              </div>
              <progress
                className="h-1.5 w-full accent-primary"
                value={job.progress}
                max={100}
                aria-label={
                  job.kind === "media_analysis"
                    ? "Progreso del análisis multimedia"
                    : "Progreso de indexación multimedia nativa"
                }
              />
              {job.error_message && (
                <p className="text-destructive">{job.error_message}</p>
              )}
              {["FAILED", "CANCELLED"].includes(job.state) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await DocumentsService.retryJob({
                        path: { document_id: document.id, job_id: job.id },
                      })
                      await jobs.refetch()
                      onDocumentsChange()
                    } catch (error) {
                      toast.error(errorMessage(error))
                    }
                  }}
                >
                  Reintentar procesamiento
                </Button>
              )}
            </div>
          )
        })()}
      <section
        aria-label="Segmentos de la fuente"
        className="flex min-h-0 flex-col gap-3"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Segmentos y evidencia</h3>
          <span className="text-xs text-muted-foreground">
            {segments.data?.total ?? 0}{" "}
            {segments.data?.total === 1 ? "segmento" : "segmentos"}
          </span>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Cada cita abre el segundo inicial del segmento original. El contenido
          puede consultarse directamente, sin transcripción previa.
        </p>
        {segments.isLoading && (
          <p role="status" className="text-xs text-muted-foreground">
            Cargando segmentos…
          </p>
        )}
        {segments.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {errorMessage(segments.error)}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void segments.refetch()}
              >
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {segments.data?.data.map((segment) => (
          <button
            key={segment.id}
            type="button"
            data-testid="media-segment"
            className="flex gap-3 rounded-lg border bg-background p-3 text-left hover:bg-muted"
            onClick={() => seek(segment.start_seconds)}
          >
            <Play size={14} className="mt-1 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="mb-1 block text-xs font-semibold text-primary">
                {sourceLocation(segment)}
              </span>
              <span className="whitespace-pre-wrap text-sm leading-6">
                {segment.text ||
                  "Segmento original disponible para recuperación nativa."}
              </span>
            </span>
          </button>
        ))}
        {!segments.isLoading && !segments.data?.data.length && (
          <p className="text-xs leading-5 text-muted-foreground">
            Los segmentos con su minuto aparecerán al prepararlos. Indexa la
            fuente nativamente y selecciona una cita para ir a ese instante.
          </p>
        )}
        {!!segments.data?.total && (
          <div className="flex items-center justify-between gap-2 pb-3">
            <Button
              size="sm"
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - 30))}
            >
              Anteriores
            </Button>
            <span className="text-xs text-muted-foreground">
              {offset + 1}–{Math.min(offset + 30, segments.data.total)} de{" "}
              {segments.data.total}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={offset + 30 >= segments.data.total}
              onClick={() => setOffset((value) => value + 30)}
            >
              Siguientes
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
