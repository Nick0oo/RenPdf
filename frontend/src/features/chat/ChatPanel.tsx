import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  FileText,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Shield,
  Sparkles,
  Square,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import rehypeKatex from "rehype-katex"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import "katex/dist/katex.min.css"
import type {
  ConversationPublic,
  DocumentPublic,
  EvidencePublic,
  QuestionInput,
} from "@/client"
import { ChatService, DocumentsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { apiRoot, errorMessage } from "@/features/research/api"
import { chatDate } from "@/features/research/presentation"

type Props = {
  conversation: ConversationPublic
  documents: DocumentPublic[]
  draft?: { text: string; elementId?: string; vision?: boolean; nonce: number }
  onCitation: (source: EvidencePublic) => void
  embedded?: boolean
  modelPending?: boolean
  onManageSources: (reason?: string) => void
}

export function ChatPanel({
  conversation,
  documents,
  draft,
  onCitation,
  onManageSources,
  embedded = false,
  modelPending = false,
}: Props) {
  const cache = useQueryClient()
  const [question, setQuestion] = useState("")
  const [selection, setSelection] = useState<{
    elementId?: string
    vision?: boolean
  }>()
  const [streaming, setStreaming] = useState(false)
  const [partial, setPartial] = useState("")
  const [pendingQuestion, setPendingQuestion] = useState("")
  const [error, setError] = useState("")
  const [errorCode, setErrorCode] = useState("")
  const [copied, setCopied] = useState("")
  const [messageId, setMessageId] = useState("")
  const abort = useRef<AbortController | null>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const stickToBottom = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const messages = useQuery({
    queryKey: ["messages", conversation.id],
    queryFn: async () =>
      (
        await ChatService.messages({
          path: { conversation_id: conversation.id },
        })
      ).data,
    refetchInterval: (query) =>
      query.state.data?.some((message) => message.state === "GENERATING")
        ? 2000
        : false,
  })
  const suggestions = useQuery({
    queryKey: ["enrichment", documents[0]?.id],
    queryFn: async () =>
      (
        await DocumentsService.readEnrichment({
          path: { document_id: documents[0]?.id ?? "" },
        })
      ).data,
    enabled: !!documents[0],
    refetchInterval: 5000,
  })
  useEffect(() => {
    if (draft) {
      setQuestion(
        draft.vision
          ? "Describe esta región visual y su información."
          : `Explica esta selección: ${draft.text}`.slice(0, 4000),
      )
      setSelection({ elementId: draft.elementId, vision: draft.vision })
      input.current?.focus()
    }
  }, [draft])
  useEffect(() => {
    if (
      (messages.data?.length || partial || streaming) &&
      stickToBottom.current &&
      viewport.current
    )
      viewport.current.scrollTop = viewport.current.scrollHeight
  }, [messages.data, partial, streaming])
  useEffect(() => () => abort.current?.abort(), [])

  const send = async () => {
    if (!question.trim() || generating || !searchable || modelPending) return
    const submitted = question.trim()
    setError("")
    setErrorCode("")
    setPartial("")
    setMessageId("")
    setPendingQuestion(submitted)
    setStreaming(true)
    setQuestion("")
    stickToBottom.current = true
    const controller = new AbortController()
    abort.current = controller
    const body: QuestionInput = {
      question: submitted,
      document_ids: documents.map((document) => document.id),
      selected_element_id: selection?.vision ? undefined : selection?.elementId,
      vision_element_id: selection?.vision ? selection.elementId : undefined,
    }
    try {
      // Fetch is used solely for SSE; body DTOs and persisted results are OpenAPI-generated.
      const response = await fetch(
        `${apiRoot}/conversations/${conversation.id}/messages`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      )
      if (!response.ok || !response.body) {
        const detail = await response.json().catch(() => null)
        throw new Error(
          typeof detail?.detail === "string"
            ? detail.detail
            : "No se pudo iniciar la respuesta. Verifica tu sesión.",
        )
      }
      const reader = response.body.getReader(),
        decoder = new TextDecoder()
      let buffer = "",
        doneEvent = false
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let boundary = buffer.indexOf("\n\n")
        while (boundary >= 0) {
          const packet = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const event = packet.match(/^event: (.+)$/m)?.[1]
          const data = JSON.parse(packet.match(/^data: (.+)$/m)?.[1] ?? "{}")
          if (event === "start") setMessageId(data.message_id)
          if (event === "token") setPartial((previous) => previous + data.text)
          if (event === "done") {
            doneEvent = true
            setPartial("")
          }
          if (event === "error") {
            doneEvent = true
            setError(data.message)
            setErrorCode(data.code ?? "")
            setPartial("")
          }
          boundary = buffer.indexOf("\n\n")
        }
      }
      if (!doneEvent)
        setError(
          "La conexión terminó antes de confirmar la respuesta. Consulta el estado del mensaje.",
        )
    } catch (error) {
      if (!controller.signal.aborted) setError(errorMessage(error))
    } finally {
      setStreaming(false)
      setPendingQuestion("")
      setSelection(undefined)
      await cache.invalidateQueries({ queryKey: ["messages", conversation.id] })
    }
  }
  const cancel = async () => {
    const id =
      messageId ||
      messages.data?.find((message) => message.state === "GENERATING")?.id
    try {
      if (id)
        await ChatService.cancelGeneration({
          path: { conversation_id: conversation.id, message_id: id },
        })
    } catch (failure) {
      setError(errorMessage(failure))
      return
    }
    abort.current?.abort()
    setStreaming(false)
    await messages.refetch()
  }
  const fillQuestion = (text: string) => {
    setQuestion(text)
    input.current?.focus()
  }
  const generating =
    streaming ||
    messages.data?.some((message) => message.state === "GENERATING")
  const searchable =
    documents.length > 0 &&
    documents.every(
      (document) =>
        !!document.current_version_id &&
        !(document.status === "INDEXING" && !document.active_index_id),
    )
  const indexing = documents.filter(
    (document) => document.status === "INDEXING" && !document.active_index_id,
  )
  const processing = documents.filter(
    (document) => !document.current_version_id,
  )
  const exportChat = async (format: "json" | "markdown") => {
    const response = await fetch(
      `${apiRoot}/conversations/${conversation.id}/export?format=${format}`,
      { credentials: "include" },
    )
    if (!response.ok) {
      setError("No se pudo exportar la conversación.")
      return
    }
    const url = URL.createObjectURL(await response.blob()),
      link = document.createElement("a")
    link.href = url
    link.download = `investigacion.${format === "json" ? "json" : "md"}`
    link.click()
    URL.revokeObjectURL(url)
  }
  return (
    <section
      aria-label="Chat con tus documentos"
      className={
        embedded
          ? "relative flex h-full min-h-0 flex-col overflow-hidden bg-background"
          : "relative flex h-full min-h-[360px] flex-col overflow-hidden rounded-2xl border bg-background shadow-sm"
      }
    >
      {!embedded && (
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <MessageSquare size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              className="truncate text-sm font-semibold"
              title={conversation.title}
            >
              {conversation.title}
            </h2>
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              {documents.length}{" "}
              {documents.length === 1
                ? "PDF en esta conversación"
                : "PDFs en esta conversación"}{" "}
              · {conversation.provider}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Exportar Markdown"
            title="Exportar conversación en Markdown"
            onClick={() => void exportChat("markdown")}
          >
            <Download size={16} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Exportar JSON"
            className="px-2 text-xs"
            onClick={() => void exportChat("json")}
          >
            JSON
          </Button>
        </header>
      )}
      {!embedded && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-muted/20 px-4 py-2.5">
          <FileText size={13} className="shrink-0 text-primary" />
          <p
            className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
            title={documents.map((document) => document.title).join(", ")}
          >
            {documents.map((document) => document.title).join(" · ") ||
              "Añade un PDF para preguntar"}
          </p>
          <button
            type="button"
            className="shrink-0 text-xs font-medium text-primary hover:underline"
            onClick={() => onManageSources()}
          >
            Gestionar fuentes
          </button>
        </div>
      )}
      {processing.length > 0 && (
        <div
          role="status"
          className="flex shrink-0 items-start gap-2 bg-amber-500/5 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground"
        >
          <LoaderCircle size={14} className="mt-0.5 shrink-0" />
          <span>
            {`${processing.length} ${processing.length === 1 ? "PDF todavía no tiene" : "PDFs todavía no tienen"} texto disponible. Espera a que termine la extracción o elige las fuentes ya extraídas en Fuentes y permisos.`}
          </span>
        </div>
      )}
      {indexing.length > 0 && (
        <div
          role="status"
          className="flex shrink-0 items-start gap-2 bg-primary/5 px-4 py-2.5 text-xs leading-relaxed text-muted-foreground"
        >
          <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin" />
          <span>
            Preparando la búsqueda por significado de todas las páginas de{" "}
            {indexing.length} PDF. Puedes escribir tu pregunta; podrás enviarla
            al terminar.
          </span>
        </div>
      )}
      <div
        ref={viewport}
        className="min-h-0 flex-1 space-y-7 overflow-y-auto overscroll-contain px-5 py-7 md:px-10"
        data-testid="chat-messages"
        onScroll={(event) => {
          const area = event.currentTarget
          const near =
            area.scrollHeight - area.scrollTop - area.clientHeight < 100
          stickToBottom.current = near
          setAtBottom(near)
        }}
      >
        {messages.isPending && (
          <div
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <LoaderCircle size={15} className="animate-spin" /> Cargando
            conversación…
          </div>
        )}
        {messages.error && (
          <div
            role="alert"
            className="rounded-xl border border-destructive/25 p-4 text-sm text-destructive"
          >
            No se pudo cargar el historial.{" "}
            <button
              type="button"
              className="underline"
              onClick={() => void messages.refetch()}
            >
              Volver a intentar
            </button>
          </div>
        )}
        {!messages.isPending && !messages.data?.length && !streaming && (
          <div className="mx-auto max-w-md py-2">
            <h3 className="text-lg font-semibold tracking-tight">
              ¿Qué quieres saber del PDF?
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Pregunta por un dato o una idea. Las citas te llevan a la página
              original.
            </p>
            <div className="mt-4 grid gap-2 text-left sm:grid-cols-2">
              {[
                "¿Cuál es el tema principal del documento?",
                "¿Qué conclusiones presenta?",
                documents.length > 1
                  ? "¿En qué se diferencian estos documentos?"
                  : "Resume los puntos principales con sus fuentes.",
              ].map((example) => (
                <button
                  key={example}
                  type="button"
                  className="group flex w-full items-center justify-between gap-3 rounded-lg border bg-muted/15 px-3 py-2.5 text-left text-xs leading-relaxed transition-colors hover:border-primary/40 hover:bg-primary/5 sm:last:col-span-2"
                  onClick={() => fillQuestion(example)}
                >
                  {example}
                  <ArrowUp
                    size={14}
                    className="shrink-0 rotate-45 text-muted-foreground group-hover:text-primary"
                  />
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.data?.map((message, index) => (
          <article
            key={message.id}
            className={
              message.role === "user"
                ? "ml-auto max-w-[70ch] rounded-2xl rounded-tr-sm border border-primary/10 bg-primary/[0.07] px-4 py-3"
                : "mx-auto w-full max-w-[70ch] min-w-0"
            }
          >
            <div className="mb-2 flex items-center gap-2">
              {message.role === "assistant" && (
                <span className="grid size-6 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Sparkles size={12} />
                </span>
              )}
              <span className="text-[11px] font-semibold text-muted-foreground">
                {message.role === "user" ? "Tú" : "RenPDF"}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {chatDate(message.created_at)}
              </span>
            </div>
            <div className="research-markdown break-words text-sm sm:text-[15px]">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[
                  [rehypeKatex, { trust: false, maxExpand: 100, maxSize: 6 }],
                ]}
                components={{
                  img: ({ alt }) => (
                    <span>{alt || "Imagen externa omitida"}</span>
                  ),
                  a: ({ children, href }) => {
                    const source = message.citations?.find(
                      (item) => href === `#source-${item.label}`,
                    )
                    return source ? (
                      <button
                        type="button"
                        className="inline rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary hover:bg-primary/20"
                        onClick={() => onCitation(source)}
                      >
                        {children}
                      </button>
                    ) : (
                      <span className="underline">{children}</span>
                    )
                  },
                }}
              >
                {message.content.replace(/\[Fuente (\d+)\]/g, (text, label) =>
                  message.citations?.some(
                    (item) => item.label === Number(label),
                  )
                    ? `${text}(#source-${label})`
                    : text,
                )}
              </ReactMarkdown>
              {message.state === "GENERATING" && !message.content && (
                <p className="flex items-center gap-2 text-muted-foreground">
                  <LoaderCircle size={14} className="animate-spin" /> Preparando
                  respuesta…
                </p>
              )}
            </div>
            {!!message.citations?.length && (
              <div className="mt-4 rounded-xl border bg-muted/20 p-3">
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  Fuentes de esta respuesta
                </p>
                <div className="flex flex-wrap gap-2">
                  {message.citations.map((source) => (
                    <button
                      type="button"
                      key={`${source.label}-${source.element_id}`}
                      className="min-w-0 rounded-lg border bg-background px-3 py-2 text-left text-xs transition-colors hover:border-primary/50 hover:bg-primary/5"
                      onClick={() => onCitation(source)}
                    >
                      <span className="block font-semibold text-primary">
                        Fuente {source.label}{" "}
                        <span className="font-normal">
                          · p. {source.page_number}
                        </span>
                      </span>
                      <span className="mt-1 block max-w-40 truncate text-[11px] text-muted-foreground">
                        {source.document_title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {message.role === "assistant" && (
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <span>
                  {message.state === "COMPLETE"
                    ? message.citations?.length
                      ? `${message.citations.length} fuentes citadas`
                      : "Sin evidencia citada"
                    : ({
                        FAILED: "No se pudo responder",
                        INTERRUPTED: "Respuesta interrumpida",
                        CANCELLED: "Respuesta detenida",
                        GENERATING: "Respuesta en curso",
                      }[message.state] ?? message.state)}
                </span>
                {message.content && (
                  <button
                    type="button"
                    className="ml-auto flex items-center gap-1 rounded px-2 py-1 hover:bg-muted"
                    aria-label="Copiar respuesta"
                    onClick={async () => {
                      await navigator.clipboard.writeText(message.content)
                      setCopied(message.id)
                    }}
                  >
                    {copied === message.id ? (
                      <Check size={13} />
                    ) : (
                      <Copy size={13} />
                    )}
                    {copied === message.id ? "Copiado" : "Copiar"}
                  </button>
                )}
                {["FAILED", "INTERRUPTED", "CANCELLED"].includes(
                  message.state,
                ) && (
                  <button
                    type="button"
                    className="rounded px-2 py-1 text-primary hover:bg-primary/5"
                    onClick={() =>
                      fillQuestion(
                        messages.data
                          .slice(0, index)
                          .filter((previous) => previous.role === "user")
                          .slice(-1)[0]?.content ?? "",
                      )
                    }
                  >
                    Editar y reintentar
                  </button>
                )}
                {message.state === "FAILED" &&
                  /autoriza|permiso|extracci[oó]n/i.test(message.content) && (
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded px-2 py-1 text-primary hover:bg-primary/5"
                      onClick={() =>
                        onManageSources(
                          /autoriza|permiso/i.test(message.content)
                            ? "CONSENT_REQUIRED"
                            : "DOCUMENT_NOT_READY",
                        )
                      }
                    >
                      <Shield size={12} /> Revisar fuentes y permisos
                    </button>
                  )}
                {message.model && (
                  <details className="w-full">
                    <summary className="cursor-pointer text-[10px]">
                      Detalles de respuesta
                    </summary>
                    <p className="mt-1 text-[10px]">
                      {message.model} ·{" "}
                      {message.retrieval_mode === "hybrid"
                        ? "Búsqueda semántica y en texto"
                        : "Búsqueda en texto"}
                    </p>
                  </details>
                )}
              </div>
            )}
          </article>
        ))}
        {streaming && (
          <>
            <article className="ml-auto max-w-[94%] rounded-2xl rounded-tr-sm border border-primary/10 bg-primary/[0.07] px-4 py-3 text-sm">
              <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
                Tú
              </p>
              <p className="whitespace-pre-wrap break-words">
                {pendingQuestion}
              </p>
            </article>
            <div role="status" className="min-w-0 text-sm leading-7">
              <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-primary">
                <LoaderCircle size={13} className="animate-spin" /> RenPDF
              </p>
              <p className="whitespace-pre-wrap break-words">
                {partial || "Buscando información en tus documentos…"}
              </p>
              <p className="mt-3 text-xs text-muted-foreground">
                Validando las fuentes de la respuesta.
              </p>
            </div>
          </>
        )}
        {error &&
          !messages.data?.some(
            (message) =>
              message.state === "FAILED" && message.content === error,
          ) && (
            <div
              role="alert"
              className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive"
            >
              <p>{error}</p>
              {[
                "CONSENT_REQUIRED",
                "DOCUMENT_NOT_READY",
                "DOCUMENT_HAS_NO_TEXT",
                "NO_DOCUMENTS_SELECTED",
              ].includes(errorCode) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3 text-foreground"
                  onClick={() => onManageSources(errorCode)}
                >
                  <Shield size={13} /> Abrir fuentes y permisos
                </Button>
              )}
            </div>
          )}
      </div>
      {!atBottom && (
        <button
          type="button"
          className="absolute bottom-44 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background px-3 py-2 text-xs shadow-md"
          onClick={() => {
            stickToBottom.current = true
            if (viewport.current)
              viewport.current.scrollTop = viewport.current.scrollHeight
          }}
        >
          <ArrowDown size={13} /> Ir al final
        </button>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
        className="mx-auto w-full max-w-[min(100%,54rem)] shrink-0 bg-background px-4 pb-5 pt-3 md:px-8"
      >
        {!!suggestions.data?.questions?.length && !messages.data?.length && (
          <div className="mb-3 max-h-24 space-y-1 overflow-y-auto">
            <p className="mb-1 text-xs text-muted-foreground">
              Preguntas de tu documento
            </p>
            {suggestions.data.questions.map((item) => (
              <button
                type="button"
                key={item.question}
                className="block w-full rounded-lg border bg-background px-3 py-2 text-left text-xs hover:bg-primary/5"
                onClick={() => fillQuestion(item.question)}
              >
                {item.question}
              </button>
            ))}
          </div>
        )}
        {selection?.elementId && (
          <div className="mb-2 flex items-center justify-between rounded-lg bg-primary/5 px-3 py-2 text-xs text-primary">
            <span>
              {selection.vision
                ? "Pregunta sobre la región visual seleccionada"
                : "Pregunta sobre la selección del PDF"}
            </span>
            <button
              type="button"
              aria-label="Quitar selección del PDF"
              onClick={() => setSelection(undefined)}
            >
              <X size={14} />
            </button>
          </div>
        )}
        <div className="rounded-xl border bg-background p-2 shadow-sm transition-shadow focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10">
          <textarea
            ref={input}
            aria-label="Pregunta sobre tus documentos"
            placeholder={
              indexing.length
                ? "Escribe tu pregunta mientras preparamos la búsqueda…"
                : searchable
                  ? "Escribe tu pregunta sobre el PDF…"
                  : "Tu pregunta, cuando el PDF tenga texto disponible…"
            }
            value={question}
            rows={2}
            maxLength={4000}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault()
                if (searchable) void send()
              }
            }}
            className="max-h-36 min-h-16 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-6 outline-none"
          />
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="text-[10px] text-muted-foreground">
              Enter para enviar · Shift + Enter para nueva línea
            </span>
            {generating ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="rounded-lg"
                onClick={() => void cancel()}
              >
                <Square size={13} /> Detener
              </Button>
            ) : (
              <Button
                size="sm"
                className="rounded-lg"
                disabled={!question.trim() || !searchable || modelPending}
              >
                <ArrowUp size={15} /> Preguntar
              </Button>
            )}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="flex-1 text-center text-[10px] leading-4 text-muted-foreground">
            {searchable &&
            documents.some(
              (document) =>
                !document.active_index_id && document.current_version_id,
            )
              ? "Puedes consultar el texto extraído. Un índice mejora la búsqueda por significado."
              : "Abre las citas para comprobar cada respuesta en tu PDF."}
          </p>
          {embedded && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Acciones de la conversación"
                >
                  <MoreHorizontal size={15} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void exportChat("markdown")}>
                  <Download size={14} /> Exportar Markdown
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportChat("json")}>
                  <Download size={14} /> Exportar JSON
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </form>
    </section>
  )
}
