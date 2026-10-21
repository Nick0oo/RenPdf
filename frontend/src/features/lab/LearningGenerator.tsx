import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowRight,
  CheckCheck,
  FileText,
  Layers3,
  Lightbulb,
  LoaderCircle,
  Sparkles,
} from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { ProvidersService, WorkspacesService } from "@/client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { sourceType } from "@/features/media/location"
import { ProviderModelSelect } from "@/features/models/ProviderModelSelect"
import {
  errorMessage,
  modelSelection,
  modelValue,
  type ProviderName,
} from "@/features/research/api"
import { ChoiceSelect } from "@/features/research/ChoiceSelect"
import { PrivacyPanel } from "@/features/research/PrivacyPanel"
import { type Generation, type GenerationKind, learningRequest } from "./api"
import { LearningTrace } from "./LearningTrace"
import { SourceAnswers } from "./SourceAnswers"
import { SourceReferences } from "./SourceReferences"

const labels = {
  summary: {
    title: "Genera un resumen con fuentes",
    action: "Generar resumen",
    description:
      "Ideas principales, conceptos y conclusiones para volver a estudiar. Se guarda en Laboratorio con sus citas.",
    icon: FileText,
  },
  questions: {
    title: "Prepara preguntas para repasar",
    action: "Generar preguntas y mazo",
    description:
      "Un banco de preguntas con respuestas y evidencia. También se crea un mazo listo para practicar en Estudio.",
    icon: Lightbulb,
  },
  deck: {
    title: "Crea fichas con IA",
    action: "Generar mazo",
    description:
      "Preguntas concretas, respuestas breves y citas comprobables. El material queda guardado y listo para repasar.",
    icon: Layers3,
  },
}

function failureCode(error: unknown): string {
  const body = (
    error as {
      response?: { data?: { code?: string; detail?: { code?: string } } }
    }
  )?.response?.data
  return (
    body?.code ??
    (typeof body?.detail === "object" ? body.detail.code : undefined) ??
    ""
  )
}

export function LearningGenerator({
  workspaceId,
  kind,
  deckId,
  disabled = false,
  onBusyChange,
  onGenerated,
}: {
  workspaceId: string
  kind: GenerationKind
  deckId?: string
  disabled?: boolean
  onBusyChange?: (value: boolean) => void
  onGenerated?: (result: Generation) => void
}) {
  const cache = useQueryClient()
  const sourceId = useId()
  const [ids, setIds] = useState<string[] | null>(null)
  const [title, setTitle] = useState("")
  const [focus, setFocus] = useState("")
  const [count, setCount] = useState("8")
  const [model, setModel] = useState("")
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  const [permissionSource, setPermissionSource] = useState("")
  const documents = useQuery({
    queryKey: ["workspace-documents", workspaceId],
    queryFn: async () =>
      (
        await WorkspacesService.listWorkspaceDocuments({
          path: { workspace_id: workspaceId },
        })
      ).data,
    refetchInterval: (query) =>
      query.state.data?.some((document) => !document.current_version_id)
        ? 5000
        : false,
  })
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: async () => (await ProvidersService.providerCatalog()).data,
    staleTime: 60000,
  })
  const routing = useQuery({
    queryKey: ["routing"],
    queryFn: async () => (await ProvidersService.readRouting()).data,
  })
  const currentRoute =
    routing.data?.find(
      (item) =>
        item.task === "chat" && item.scope_key === `workspace:${workspaceId}`,
    ) ??
    routing.data?.find(
      (item) => item.task === "chat" && item.scope_key === "personal",
    )
  const fallback =
    providers.data?.flatMap((provider) =>
      (provider.models ?? [])
        .filter((item) => item.capabilities?.text !== "unsupported")
        .map((item) => modelValue(provider.name, item.id)),
    )[0] ?? ""
  const effectiveModel =
    model ||
    (currentRoute
      ? modelValue(currentRoute.provider, currentRoute.model)
      : fallback)
  const selected = (documents.data ?? []).filter((document) =>
    ids === null ? !!document.current_version_id : ids.includes(document.id),
  )
  const ready = (documents.data ?? []).filter(
    (document) => !!document.current_version_id,
  )
  const config = labels[kind]
  const Icon = config.icon
  const generation = useMutation({
    mutationFn: () =>
      learningRequest<Generation>("/generate", "POST", {
        workspace_id: workspaceId,
        kind,
        document_ids: selected.map((document) => document.id),
        ...modelSelection(effectiveModel),
        title: title.trim() || undefined,
        focus: focus.trim() || undefined,
        count: kind === "summary" ? undefined : Number(count),
        deck_id: kind === "deck" ? deckId || undefined : undefined,
      }),
    onMutate: () => onBusyChange?.(true),
    onSuccess: async (result) => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["learning"] }),
        cache.invalidateQueries({ queryKey: ["conversations", workspaceId] }),
      ])
      onGenerated?.(result)
    },
    onError: (error) => {
      if (failureCode(error) === "CONSENT_REQUIRED") {
        setPermissionSource(selected[0]?.id ?? "")
        setPermissionsOpen(true)
      }
    },
    onSettled: () => onBusyChange?.(false),
  })
  const previousDeck = useRef(deckId)
  useEffect(() => {
    if (generation.isPending || previousDeck.current === deckId) return
    previousDeck.current = deckId
    if (generation.data?.deck?.id !== deckId) {
      setIds(null)
      generation.reset()
    }
  }, [
    deckId,
    generation.isPending,
    generation.data?.deck?.id,
    generation.reset,
  ])
  const pending = generation.isPending
  const blocked = disabled || pending
  const selectionValid =
    selected.length > 0 &&
    selected.every((document) => !!document.current_version_id)
  const countValid =
    kind === "summary" ||
    (Number.isInteger(Number(count)) &&
      Number(count) >= 3 &&
      Number(count) <= 20)
  const queryError = documents.error || providers.error || routing.error
  const result = generation.data
  const providerName = effectiveModel.split("|")[0] as ProviderName
  const permissionDocument =
    selected.find((document) => document.id === permissionSource) ?? selected[0]
  return (
    <section
      aria-label="Generar material con IA"
      className="overflow-hidden rounded-2xl border bg-background"
    >
      <header className="border-b bg-primary/5 p-5 md:p-6">
        <p className="mb-3 flex items-center gap-2 text-xs font-medium text-primary">
          <Sparkles size={14} />
          Generado desde tus fuentes
        </p>
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Icon size={20} />
          {kind === "deck" && deckId
            ? "Añade fichas con IA a este mazo"
            : config.title}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {config.description}
        </p>
      </header>
      <div className="grid gap-6 p-5 md:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <fieldset className="min-w-0 space-y-3" disabled={blocked}>
          <legend className="mb-3 text-sm font-semibold">
            1. Elige las fuentes
          </legend>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={blocked || !ready.length}
              onClick={() => setIds(ids !== null && !ids.length ? null : [])}
            >
              {ids !== null && !ids.length
                ? "Seleccionar listas"
                : "Desmarcar todas"}
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {selected.length} seleccionadas de {documents.data?.length ?? 0}.
            PDF, hojas de cálculo, audio y video preparados en este workspace.
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {documents.data?.map((document) => (
              <label
                key={document.id}
                htmlFor={`${sourceId}-${document.id}`}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${selected.some((item) => item.id === document.id) ? "border-primary/25 bg-primary/5" : "bg-background"}`}
              >
                <Checkbox
                  id={`${sourceId}-${document.id}`}
                  aria-label={`Usar ${document.title} para generar`}
                  disabled={blocked || !document.current_version_id}
                  checked={selected.some((item) => item.id === document.id)}
                  onCheckedChange={(checked) =>
                    setIds(
                      checked
                        ? [
                            ...new Set([
                              ...selected.map((item) => item.id),
                              document.id,
                            ]),
                          ]
                        : selected
                            .filter((item) => item.id !== document.id)
                            .map((item) => item.id),
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium">
                    {document.title}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {sourceType(document) === "spreadsheet"
                      ? "Hoja de cálculo"
                      : sourceType(document).toUpperCase()}{" "}
                    ·{" "}
                    {document.current_version_id
                      ? document.status === "INDEXING" &&
                        !document.active_index_id
                        ? "Texto disponible; índice semántico en preparación"
                        : "Lista para consultar"
                      : "Preparando contenido; disponible al terminar"}
                  </span>
                </span>
              </label>
            ))}
            {documents.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                Cargando fuentes…
              </p>
            )}
            {!documents.isPending && !documents.data?.length && (
              <p className="rounded-lg border border-dashed p-4 text-sm leading-6 text-muted-foreground">
                Añade fuentes a este workspace para crear tu material.{" "}
                <a
                  href={`/workspaces/${workspaceId}`}
                  className="text-primary underline"
                >
                  Abrir workspace
                </a>
              </p>
            )}
          </div>
        </fieldset>
        <div className="min-w-0 space-y-4">
          <h3 className="text-sm font-semibold">2. Prepara el material</h3>
          <div className="space-y-2">
            <Label htmlFor={`generate-title-${kind}`}>
              Nombre del material (opcional)
            </Label>
            <Input
              id={`generate-title-${kind}`}
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={blocked}
              placeholder="Tema para el próximo examen"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`generate-focus-${kind}`}>
              Enfoque o temas que quieres practicar
            </Label>
            <textarea
              id={`generate-focus-${kind}`}
              rows={3}
              maxLength={2000}
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
              disabled={blocked}
              placeholder="Conceptos esenciales, diferencias, fórmulas, fechas o dudas concretas…"
              className="w-full rounded-lg border bg-background p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          {kind !== "summary" && (
            <div className="space-y-2">
              <Label htmlFor={`generate-count-${kind}`}>
                Cantidad de preguntas
              </Label>
              <Input
                className="max-w-28"
                id={`generate-count-${kind}`}
                type="number"
                min={3}
                max={20}
                step={1}
                value={count}
                onChange={(event) => setCount(event.target.value)}
                disabled={blocked}
              />
              <p className="text-xs text-muted-foreground">
                Entre 3 y 20. Cada pregunta incluye respuesta y evidencia.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label>Modelo de generación</Label>
            <ProviderModelSelect
              providers={providers.data ?? []}
              task="chat"
              value={effectiveModel}
              onValueChange={setModel}
              label="Modelo para generar material"
              disabled={blocked}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              Usa los permisos de estas fuentes. No se autoriza ningún envío
              automáticamente. Los clips originales necesitan un modelo
              compatible con audio/video.
            </p>
          </div>
          <Button
            type="button"
            className="h-auto min-h-10 w-full whitespace-normal py-2"
            disabled={
              blocked ||
              !selectionValid ||
              !countValid ||
              !effectiveModel ||
              !!queryError
            }
            onClick={() => generation.mutate()}
          >
            {pending ? (
              <LoaderCircle data-icon="inline-start" className="animate-spin" />
            ) : (
              <Sparkles data-icon="inline-start" />
            )}
            {pending
              ? "Preparando material con tus fuentes…"
              : kind === "deck" && deckId
                ? "Generar y añadir fichas"
                : config.action}
          </Button>
          {pending && (
            <p
              role="status"
              className="text-xs leading-5 text-muted-foreground"
            >
              Recuperando evidencia y preparando las respuestas. Al terminar se
              guardará automáticamente; esta consulta puede tardar hasta tres
              minutos.
            </p>
          )}
        </div>
      </div>
      {(generation.error || queryError) && (
        <Alert variant="destructive" className="mx-5 mb-5 w-auto md:mx-6">
          <AlertTitle>No se pudo generar el material</AlertTitle>
          <AlertDescription>
            {errorMessage(generation.error || queryError)}
            {failureCode(generation.error) === "CONSENT_REQUIRED" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setPermissionsOpen(true)}
              >
                Revisar permisos
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {result && (
        <section
          aria-label="Material generado"
          className="space-y-4 border-t bg-primary/5 p-5 md:p-6"
        >
          <div>
            <h3 className="flex items-center gap-2 font-semibold">
              <CheckCheck size={18} className="text-primary" />
              Material guardado
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {result.research.length > 0
                ? `${result.research.length} ${result.research.length === 1 ? "registro en Laboratorio" : "registros en Laboratorio"}. `
                : ""}
              {result.deck
                ? `${result.cards.length} fichas en «${result.deck.name}», listas para repasar.`
                : "El resumen y sus citas ya están en tu archivo."}
            </p>
            {result.coverage.partial === true && (
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                El material se basa en fragmentos de tus fuentes y puede dejar
                contenido fuera. Revisa sus citas al repasar.
              </p>
            )}
            {Array.isArray(result.coverage.without_evidence) &&
              result.coverage.without_evidence.length > 0 && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {result.coverage.without_evidence.length}{" "}
                  {result.coverage.without_evidence.length === 1
                    ? "fuente no aportó evidencia a este material."
                    : "fuentes no aportaron evidencia a este material."}
                </p>
              )}
          </div>
          <div className="flex flex-wrap gap-2">
            {result.deck && (
              <Button asChild>
                <a
                  href={`/study/review?workspace=${workspaceId}&deck=${result.deck.id}`}
                >
                  Repasar mazo
                  <ArrowRight data-icon="inline-end" />
                </a>
              </Button>
            )}
            <LearningTrace messageId={result.message_id} />
            <Button asChild variant="outline">
              <a href={`/workspaces/${workspaceId}`}>Abrir workspace</a>
            </Button>
          </div>
          {kind === "summary" && result.research[0] && (
            <SourceAnswers
              answers={result.research[0].answers}
              workspaceId={workspaceId}
              showTrace={false}
            />
          )}
          {result.cards.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Vista previa de las fichas
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {result.cards.slice(0, 4).map((card) => (
                  <article
                    key={card.id}
                    className="space-y-3 rounded-lg border bg-background p-4"
                  >
                    <h4 className="text-sm font-semibold leading-6">
                      {card.question}
                    </h4>
                    <p className="text-sm leading-6 text-muted-foreground">
                      {card.answer}
                    </p>
                    <SourceReferences
                      citations={
                        card.evidences?.length
                          ? card.evidences
                          : card.evidence
                            ? [card.evidence]
                            : []
                      }
                      workspaceId={workspaceId}
                    />
                  </article>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                El mazo conserva las {result.cards.length} fichas. Abre Estudio
                para revisarlas y editarlas.
              </p>
            </details>
          )}
        </section>
      )}
      <Dialog open={permissionsOpen} onOpenChange={setPermissionsOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Permisos para generar material</DialogTitle>
            <DialogDescription>
              Revisa cada fuente y autoriza sólo los envíos que decidas. El
              material y la configuración de generación se conservan para que
              puedas reintentar.
            </DialogDescription>
          </DialogHeader>
          <ChoiceSelect
            label="Fuente para autorizar generación"
            value={permissionDocument?.id ?? ""}
            onValueChange={setPermissionSource}
            placeholder="Elige una fuente"
            options={selected.map((document) => ({
              value: document.id,
              label: document.title,
            }))}
          />
          {permissionDocument && (
            <PrivacyPanel
              document={permissionDocument}
              provider={providerName}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
