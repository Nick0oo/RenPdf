import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Download,
  FlaskConical,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type { MessagePublic } from "@/client"
import { ChatService, ProvidersService, WorkspacesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProviderModelSelect } from "@/features/models/ProviderModelSelect"
import {
  apiRoot,
  errorMessage,
  modelSelection,
  modelValue,
} from "@/features/research/api"
import { ChoiceSelect } from "@/features/research/ChoiceSelect"
import { ConfirmationDialog } from "@/features/research/ConfirmationDialog"
import {
  downloadResearch,
  learningRequest,
  type ResearchEntry,
  type SourceAnswer,
} from "./api"
import { LearningGenerator } from "./LearningGenerator"
import { SourceAnswers } from "./SourceAnswers"

export type LabSection = "compare" | "questions" | "summaries"
const labels = {
  compare: "Comparación de fuentes",
  questions: "Preguntas de investigación",
  summaries: "Resúmenes guardados",
}
const descriptions = {
  compare:
    "Contrasta un mismo tema entre tus fuentes y conserva lo que respalda cada respuesta.",
  questions:
    "La IA prepara preguntas con respuestas y citas. El banco queda aquí y su mazo se repasa en Estudio.",
  summaries:
    "Prepara resúmenes con IA a partir de tus fuentes, revisa sus citas y guarda lo esencial para estudiar.",
}

export function LabDesk({ section = "compare" }: { section?: LabSection }) {
  const cache = useQueryClient()
  const [workspace, setWorkspace] = useState(
    () => new URLSearchParams(window.location.search).get("workspace") ?? "",
  )
  const [manualOpen, setManualOpen] = useState(section === "compare")
  const [ids, setIds] = useState<string[]>([])
  const [title, setTitle] = useState("")
  const [question, setQuestion] = useState("")
  const [notes, setNotes] = useState("")
  const [model, setModel] = useState("")
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [partial, setPartial] = useState("")
  const [answers, setAnswers] = useState<SourceAnswer[]>([])
  const [conversationId, setConversationId] = useState("")
  const [existingConversation, setExistingConversation] = useState("")
  const [selectedMessage, setSelectedMessage] = useState("")
  const [deleting, setDeleting] = useState<ResearchEntry>()
  const [editingEntry, setEditingEntry] = useState<ResearchEntry>()
  const [error, setError] = useState("")
  const abort = useRef<AbortController | null>(null)
  const pending = useRef<{ conversation: string; message: string } | null>(null)
  const spaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => (await WorkspacesService.listWorkspaces()).data,
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
  const documents = useQuery({
    queryKey: ["workspace-documents", workspace],
    queryFn: async () =>
      (
        await WorkspacesService.listWorkspaceDocuments({
          path: { workspace_id: workspace },
        })
      ).data,
    enabled: !!workspace,
  })
  const saved = useQuery({
    queryKey: ["learning", "research", workspace],
    queryFn: () =>
      learningRequest<ResearchEntry[]>(`/research?workspace_id=${workspace}`),
    enabled: !!workspace,
  })
  const conversations = useQuery({
    queryKey: ["conversations", workspace],
    queryFn: async () =>
      (await ChatService.conversations({ path: { workspace_id: workspace } }))
        .data,
    enabled: !!workspace,
  })
  const messages = useQuery({
    queryKey: ["messages", existingConversation],
    queryFn: async () =>
      (
        await ChatService.messages({
          path: { conversation_id: existingConversation },
        })
      ).data,
    enabled: !!existingConversation,
  })
  useEffect(() => {
    if (!workspace && spaces.data?.length) setWorkspace(spaces.data[0].id)
  }, [spaces.data, workspace])
  useEffect(
    () => () => {
      if (pending.current)
        void ChatService.cancelGeneration({
          path: {
            conversation_id: pending.current.conversation,
            message_id: pending.current.message,
          },
        }).catch(() => undefined)
      abort.current?.abort()
    },
    [],
  )
  const kind =
    section === "compare"
      ? "comparison"
      : section === "summaries"
        ? "summary"
        : "question"
  const selected =
    documents.data?.filter((document) => ids.includes(document.id)) ?? []
  const currentRoute =
    routing.data?.find(
      (row) =>
        row.task === "chat" && row.scope_key === `workspace:${workspace}`,
    ) ??
    routing.data?.find(
      (row) => row.task === "chat" && row.scope_key === "personal",
    )
  const effectiveModel =
    model ||
    (currentRoute ? modelValue(currentRoute.provider, currentRoute.model) : "")
  const eligibleMessages =
    messages.data?.filter(
      (message) =>
        message.role === "assistant" &&
        message.state === "COMPLETE" &&
        (message.citations?.length ?? 0) > 0,
    ) ?? []
  const adopted = eligibleMessages.find(
    (message) => message.id === selectedMessage,
  )
  const sources = adopted ? [toSource(adopted)] : answers
  const changeWorkspace = (value: string) => {
    setWorkspace(value)
    setIds([])
    setAnswers([])
    setExistingConversation("")
    setSelectedMessage("")
    setConversationId("")
    setEditingEntry(undefined)
    setError("")
  }

  async function generate() {
    if (!workspace || !selected.length || !effectiveModel || busy) return
    setBusy(true)
    setGenerating(true)
    setError("")
    setAnswers([])
    setSelectedMessage("")
    setPartial("")
    const controller = new AbortController()
    abort.current = controller
    const completed: SourceAnswer[] = []
    try {
      const { data: conversation } = await ChatService.createConversation({
        path: { workspace_id: workspace },
        body: {
          title: (title.trim() || labels[section]).slice(0, 200),
          ...modelSelection(effectiveModel),
        },
      })
      setConversationId(conversation.id)
      const groups = [ids]
      for (const group of groups) {
        if (controller.signal.aborted) break
        setPartial("")
        const response = await fetch(
          `${apiRoot}/conversations/${conversation.id}/messages`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question:
                section === "compare"
                  ? `Compara las fuentes seleccionadas y presenta una síntesis conjunta con diferencias, coincidencias y citas de cada documento. Tema: ${question.trim() || "puntos principales"}`
                  : question.trim() ||
                    "Resume los puntos principales con sus fuentes.",
              document_ids: group,
            }),
            signal: controller.signal,
          },
        )
        if (!response.ok || !response.body)
          throw new Error(
            "No se pudo iniciar la respuesta. Revisa el estado del chat.",
          )
        const reader = response.body.getReader(),
          decoder = new TextDecoder()
        let buffer = "",
          doneMessage = ""
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let boundary = buffer.indexOf("\n\n")
            while (boundary >= 0) {
              const packet = buffer.slice(0, boundary)
              buffer = buffer.slice(boundary + 2)
              const event = packet.match(/^event: (.+)$/m)?.[1]
              const data = JSON.parse(
                packet.match(/^data: (.+)$/m)?.[1] ?? "{}",
              )
              if (event === "start")
                pending.current = {
                  conversation: conversation.id,
                  message: data.message_id,
                }
              if (event === "token") setPartial((old) => old + data.text)
              if (event === "error")
                throw new Error(
                  data.message || "La respuesta no pudo completarse.",
                )
              if (event === "done") doneMessage = data.message_id
              boundary = buffer.indexOf("\n\n")
            }
          }
        } finally {
          reader.releaseLock()
        }
        if (!doneMessage)
          throw new Error(
            "La conexión terminó antes de confirmar la respuesta. Puedes verla en el workspace.",
          )
        const rows = (
          await ChatService.messages({
            path: { conversation_id: conversation.id },
          })
        ).data
        const message = rows.find((row) => row.id === doneMessage)
        if (message?.state !== "COMPLETE")
          throw new Error("La respuesta sigue pendiente en el chat.")
        if (!message.citations?.length)
          throw new Error(
            "Esta fuente no aportó evidencia citada. Ajusta el tema antes de guardar un informe.",
          )
        completed.push(toSource(message))
        setAnswers([...completed])
        pending.current = null
      }
    } catch (failure) {
      setError(
        controller.signal.aborted
          ? "Consulta cancelada. Las respuestas terminadas siguen disponibles en el chat."
          : errorMessage(failure),
      )
    } finally {
      setBusy(false)
      setGenerating(false)
      setPartial("")
      pending.current = null
      await cache.invalidateQueries({ queryKey: ["conversations", workspace] })
    }
  }

  async function save() {
    setBusy(true)
    setError("")
    try {
      await learningRequest(
        editingEntry ? `/research/${editingEntry.id}` : "/research",
        editingEntry ? "PATCH" : "POST",
        {
          workspace_id: workspace,
          kind,
          title:
            title.trim() || question.trim().slice(0, 200) || labels[section],
          question,
          notes,
          source_message_ids: sources.map((source) => source.message_id),
          document_ids: adopted
            ? [
                ...new Set(
                  (adopted.citations ?? []).map(
                    (citation) => citation.document_id,
                  ),
                ),
              ]
            : ids,
        },
      )
      await cache.invalidateQueries({
        queryKey: ["learning", "research", workspace],
      })
      toast.success("Investigación guardada")
      setTitle("")
      setNotes("")
      setAnswers([])
      setSelectedMessage("")
      setEditingEntry(undefined)
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const queryError =
    spaces.error ||
    documents.error ||
    saved.error ||
    providers.error ||
    routing.error ||
    conversations.error ||
    messages.error
  return (
    <div className="space-y-6">
      <header>
        <p className="mb-2 text-xs font-medium text-primary">
          LABORATORIO · PREPARA TU MATERIAL
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {labels[section]}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {descriptions[section]}
        </p>
        <a
          className="mt-3 inline-block text-sm font-medium text-primary underline underline-offset-4"
          href={`/study/decks${workspace ? `?workspace=${workspace}` : ""}`}
        >
          Ir a Estudio para repasar tus mazos →
        </a>
      </header>
      <div className="max-w-md">
        <Label className="mb-2 block">Workspace</Label>
        <ChoiceSelect
          label="Workspace de laboratorio"
          placeholder="Elige un workspace"
          value={workspace}
          onValueChange={changeWorkspace}
          disabled={busy}
          options={(spaces.data ?? []).map((space) => ({
            value: space.id,
            label: space.name,
          }))}
        />
      </div>
      {!spaces.isPending && !spaces.data?.length && (
        <p className="rounded-xl border border-dashed p-6 text-sm">
          Crea un workspace y añade tus fuentes para empezar.
        </p>
      )}
      {(error || queryError) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error || errorMessage(queryError)}
        </p>
      )}
      {workspace && section !== "compare" && (
        <LearningGenerator
          key={`${workspace}:${section}`}
          workspaceId={workspace}
          kind={section === "summaries" ? "summary" : "questions"}
          disabled={busy}
          onBusyChange={setBusy}
        />
      )}
      {workspace && (
        <div
          className={
            manualOpen
              ? "grid items-start gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]"
              : "grid gap-6"
          }
        >
          <details
            open={manualOpen}
            onToggle={(event) => setManualOpen(event.currentTarget.open)}
            className="min-w-0 rounded-2xl border"
          >
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium">
              {section === "compare"
                ? "Consulta y comparación guiada"
                : "Crear manualmente o usar un chat guardado"}
            </summary>
            <section
              className="min-w-0 space-y-5 border-t p-5 md:p-6"
              aria-label="Nueva investigación"
            >
              <h2 className="text-lg font-semibold">
                {editingEntry
                  ? "Editar investigación"
                  : section === "questions"
                    ? "Una pregunta para investigar"
                    : "Prepara tu consulta"}
              </h2>
              <div className="space-y-2">
                <Label htmlFor="research-title">Título</Label>
                <Input
                  id="research-title"
                  value={title}
                  maxLength={200}
                  disabled={busy}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Un nombre para volver a encontrarlo"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="research-question">
                  {section === "compare"
                    ? "Tema o pregunta para ambas fuentes"
                    : "Pregunta"}
                </Label>
                <textarea
                  id="research-question"
                  value={question}
                  maxLength={4000}
                  rows={3}
                  disabled={busy}
                  onChange={(event) => {
                    setQuestion(event.target.value)
                    setAnswers([])
                    setSelectedMessage("")
                  }}
                  className="w-full rounded-lg border bg-background p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder={
                    section === "summaries"
                      ? "Resume los puntos principales con sus fuentes."
                      : "¿Qué quieres comprobar en los documentos?"
                  }
                />
              </div>
              <fieldset className="space-y-3">
                <legend className="mb-3 text-sm font-medium">
                  Fuentes a consultar
                </legend>
                {(documents.data ?? []).map((document) => (
                  <label
                    key={document.id}
                    htmlFor={`lab-source-${document.id}`}
                    className="flex items-start gap-3 text-sm"
                  >
                    <Checkbox
                      id={`lab-source-${document.id}`}
                      checked={ids.includes(document.id)}
                      disabled={busy || !document.current_version_id}
                      onCheckedChange={(checked) => {
                        setAnswers([])
                        setIds(
                          checked
                            ? [...ids, document.id]
                            : ids.filter((id) => id !== document.id),
                        )
                      }}
                    />
                    <span className="min-w-0 break-words">
                      {document.title}
                      {!document.current_version_id && (
                        <span className="block text-xs text-muted-foreground">
                          Procesa el PDF desde el workspace
                        </span>
                      )}
                    </span>
                  </label>
                ))}
                {!documents.isPending && !documents.data?.length && (
                  <p className="text-sm text-muted-foreground">
                    Añade PDFs a este workspace para consultar sus fuentes.
                  </p>
                )}
              </fieldset>
              <div className="space-y-2">
                <Label>Modelo de consulta</Label>
                <ProviderModelSelect
                  providers={providers.data ?? []}
                  task="chat"
                  value={effectiveModel}
                  onValueChange={setModel}
                  label="Modelo de laboratorio"
                  disabled={busy}
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  La consulta usa el permiso de chat de cada PDF. Una
                  comparación consulta cada fuente por separado; puedes revisar
                  sus respuestas antes de guardar.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    busy ||
                    !effectiveModel ||
                    (section === "compare"
                      ? selected.length < 2 || !question.trim()
                      : !selected.length ||
                        (section === "questions" && !question.trim()))
                  }
                  onClick={() => void generate()}
                >
                  {busy ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <FlaskConical size={15} />
                  )}
                  {section === "compare"
                    ? "Consultar las fuentes"
                    : "Consultar con citas"}
                </Button>
                {generating && (
                  <Button
                    variant="outline"
                    onClick={async () => {
                      try {
                        if (pending.current)
                          await ChatService.cancelGeneration({
                            path: {
                              conversation_id: pending.current.conversation,
                              message_id: pending.current.message,
                            },
                          })
                        abort.current?.abort()
                      } catch (failure) {
                        setError(errorMessage(failure))
                      }
                    }}
                  >
                    Cancelar consulta
                  </Button>
                )}
              </div>
              {conversationId && (
                <a
                  className="block text-xs text-primary underline underline-offset-4"
                  href={`/workspaces/${workspace}`}
                >
                  La consulta también queda en el historial del workspace
                </a>
              )}
              {partial && (
                <p
                  role="status"
                  className="whitespace-pre-wrap break-words text-sm leading-7"
                >
                  {partial}
                </p>
              )}
              <SourceAnswers answers={answers} workspaceId={workspace} />
              <details className="border-t pt-4">
                <summary className="cursor-pointer text-sm font-medium">
                  Usar una respuesta que ya existe
                </summary>
                <div className="mt-3 space-y-3">
                  <ChoiceSelect
                    label="Chat de la investigación"
                    placeholder="Elige un chat"
                    value={existingConversation}
                    onValueChange={(value) => {
                      setExistingConversation(value)
                      setSelectedMessage("")
                    }}
                    disabled={busy}
                    options={(conversations.data ?? []).map((conversation) => ({
                      value: conversation.id,
                      label: conversation.title,
                    }))}
                  />
                  <ChoiceSelect
                    label="Respuesta con citas"
                    placeholder="Elige una respuesta citada"
                    value={selectedMessage}
                    onValueChange={setSelectedMessage}
                    disabled={busy}
                    options={eligibleMessages.map((message) => ({
                      value: message.id,
                      label: message.content.slice(0, 100),
                    }))}
                  />
                  {existingConversation &&
                    !messages.isPending &&
                    !eligibleMessages.length && (
                      <p className="text-xs text-muted-foreground">
                        Este chat aún no tiene respuestas terminadas con citas.
                      </p>
                    )}
                  <SourceAnswers
                    answers={adopted ? [toSource(adopted)] : []}
                    workspaceId={workspace}
                  />
                </div>
              </details>
              <div className="space-y-2">
                <Label htmlFor="research-notes">Notas de investigación</Label>
                <textarea
                  id="research-notes"
                  value={notes}
                  rows={3}
                  maxLength={10000}
                  disabled={busy}
                  onChange={(event) => setNotes(event.target.value)}
                  className="w-full rounded-lg border bg-background p-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="Tus observaciones, diferencias o próximos pasos"
                />
              </div>
              <Button
                variant="outline"
                disabled={
                  busy ||
                  (section === "questions" ? !question.trim() : !sources.length)
                }
                onClick={() => void save()}
              >
                <Plus size={15} />
                {editingEntry
                  ? "Guardar cambios"
                  : section === "questions" && !sources.length
                    ? "Guardar pregunta pendiente"
                    : "Guardar investigación"}
              </Button>
              {editingEntry && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEditingEntry(undefined)
                    setTitle("")
                    setQuestion("")
                    setNotes("")
                    setAnswers([])
                    setSelectedMessage("")
                    setError("")
                  }}
                >
                  Cancelar edición
                </Button>
              )}
            </section>
          </details>
          <section
            className="min-w-0 space-y-4"
            aria-label="Investigaciones guardadas"
          >
            <h2 className="text-lg font-semibold">
              {section === "questions"
                ? "Tus preguntas"
                : "Tu archivo de investigación"}
            </h2>
            {saved.isPending && (
              <p className="text-sm text-muted-foreground">
                Cargando investigaciones…
              </p>
            )}
            {saved.data
              ?.filter((entry) => entry.kind === kind)
              .map((entry) => (
                <article key={entry.id} className="rounded-xl border p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words font-semibold">
                        {entry.title}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(entry.created_at).toLocaleDateString()} ·{" "}
                        {entry.answers.some(
                          (answer) =>
                            answer.available && answer.citations.length,
                        )
                          ? "Con respuestas citadas"
                          : entry.answers.length
                            ? "Fuentes originales no disponibles"
                            : "Pregunta pendiente"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Editar ${entry.title}`}
                        disabled={busy}
                        onClick={() => {
                          setManualOpen(true)
                          setEditingEntry(entry)
                          setTitle(entry.title)
                          setQuestion(entry.question)
                          setNotes(entry.notes)
                          setAnswers(
                            entry.answers.filter(
                              (answer) =>
                                answer.available && answer.citations.length,
                            ),
                          )
                          setSelectedMessage("")
                          setIds(entry.document_ids)
                          setError("")
                        }}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Exportar ${entry.title}`}
                        onClick={() => downloadResearch(entry)}
                      >
                        <Download size={14} />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Eliminar ${entry.title}`}
                        onClick={() => setDeleting(entry)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6">
                    {entry.question}
                  </p>
                  {entry.notes && (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                      {entry.notes}
                    </p>
                  )}
                  <details className="mt-4">
                    <summary className="cursor-pointer text-sm text-primary">
                      Revisar evidencia y respuestas
                    </summary>
                    <div className="mt-4">
                      <SourceAnswers
                        answers={entry.answers}
                        workspaceId={workspace}
                      />
                      {!entry.answers.length && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setQuestion(entry.question)
                            setTitle(entry.title)
                            setNotes(entry.notes)
                            setIds(entry.document_ids)
                            setAnswers([])
                            setManualOpen(true)
                            setEditingEntry(entry)
                          }}
                        >
                          Consultar esta pregunta
                        </Button>
                      )}
                    </div>
                  </details>
                </article>
              ))}
            {!saved.isPending &&
              !saved.data?.some((entry) => entry.kind === kind) && (
                <div className="rounded-xl border border-dashed p-6 text-sm leading-6 text-muted-foreground">
                  {section === "questions"
                    ? "Guarda una pregunta para construir tu agenda de investigación."
                    : "Consulta tus fuentes o elige una respuesta citada. Los informes guardados aparecerán aquí."}
                </div>
              )}
          </section>
        </div>
      )}
      <ConfirmationDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined)
        }}
        title="Eliminar investigación"
        confirmLabel="Eliminar"
        description="Se eliminará este registro guardado. Sus PDFs y respuestas del chat seguirán disponibles."
        pending={busy}
        onConfirm={async () => {
          if (!deleting) return
          setBusy(true)
          try {
            await learningRequest(`/research/${deleting.id}`, "DELETE")
            if (editingEntry?.id === deleting.id) setEditingEntry(undefined)
            setDeleting(undefined)
            await cache.invalidateQueries({
              queryKey: ["learning", "research", workspace],
            })
          } catch (failure) {
            setError(errorMessage(failure))
          } finally {
            setBusy(false)
          }
        }}
      />
    </div>
  )
}

function toSource(message: MessagePublic): SourceAnswer {
  return {
    message_id: message.id,
    available: true,
    content: message.content,
    provider: message.provider,
    model: message.model,
    citations: message.citations ?? [],
    usage: message.usage ?? undefined,
  }
}
