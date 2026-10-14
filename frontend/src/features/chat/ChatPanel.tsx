import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, Download, Send, Square } from "lucide-react"
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
import { apiRoot, errorMessage } from "@/features/research/api"

type Props = {
  conversation: ConversationPublic
  documents: DocumentPublic[]
  draft?: { text: string; elementId?: string; vision?: boolean; nonce: number }
  onCitation: (source: EvidencePublic) => void
}

export function ChatPanel({
  conversation,
  documents,
  draft,
  onCitation,
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
  const [copied, setCopied] = useState("")
  const [messageId, setMessageId] = useState("")
  const abort = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const messages = useQuery({
    queryKey: ["messages", conversation.id],
    queryFn: async () =>
      (
        await ChatService.messages({
          path: { conversation_id: conversation.id },
        })
      ).data,
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
          : `Explica esta selección: ${draft.text}`,
      )
      setSelection({ elementId: draft.elementId, vision: draft.vision })
    }
  }, [draft])
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" })
  }, [])
  useEffect(() => () => abort.current?.abort(), [])

  const send = async () => {
    if (!question.trim() || streaming) return
    const submitted = question.trim()
    setError("")
    setPartial("")
    setPendingQuestion(submitted)
    setStreaming(true)
    setQuestion("")
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
      if (!response.ok || !response.body)
        throw new Error("No se pudo iniciar la respuesta. Verifica tu sesión.")
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
    if (id)
      await ChatService.cancelGeneration({
        path: { conversation_id: conversation.id, message_id: id },
      })
    abort.current?.abort()
    setStreaming(false)
    await messages.refetch()
  }
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
    <div className="flex h-full min-h-[500px] flex-col rounded-xl border bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Tu investigación</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {documents.length} fuentes activas · {conversation.provider}
          </p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Exportar Markdown"
          onClick={() => void exportChat("markdown")}
        >
          <Download size={16} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void exportChat("json")}
        >
          JSON
        </Button>
      </div>
      <div
        className="min-h-0 flex-1 space-y-5 overflow-auto p-4"
        data-testid="chat-messages"
      >
        {!messages.data?.length && !streaming && (
          <div className="py-12 text-center">
            <div className="mx-auto mb-4 grid size-12 place-content-center rounded-full bg-primary/10 text-xl text-primary">
              ↗
            </div>
            <h3 className="font-medium">Encuentra respuestas en tus fuentes</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Pregunta por un dato, compara documentos o selecciona una región
              del PDF. Cada fuente validada te lleva a su origen.
            </p>
          </div>
        )}
        {messages.data?.map((message) => (
          <article
            key={message.id}
            className={
              message.role === "user"
                ? "ml-7 rounded-xl bg-muted px-4 py-3"
                : "mr-2"
            }
          >
            <div className="research-markdown text-sm">
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
                        className="rounded bg-primary/10 px-1 font-medium text-primary"
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
            </div>
            {(message.citations ?? []).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(message.citations ?? []).map((source) => (
                  <button
                    type="button"
                    key={`${source.label}-${source.element_id}`}
                    className="rounded-md border bg-primary/5 px-2 py-1.5 text-left text-xs text-primary hover:bg-primary/15"
                    onClick={() => onCitation(source)}
                  >
                    <strong>Fuente {source.label}</strong>
                    <span className="ml-2">
                      p. {source.page_number} ·{" "}
                      {source.document_title.slice(0, 22)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {message.role === "assistant" && (
              <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>
                  {message.model || "Sin inferencia"} ·{" "}
                  {message.retrieval_mode === "hybrid"
                    ? "Recuperación híbrida"
                    : "Recuperación léxica"}{" "}
                  · {message.state}
                </span>
                <button
                  type="button"
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
                </button>
                {["FAILED", "INTERRUPTED", "CANCELLED"].includes(
                  message.state,
                ) && (
                  <button
                    type="button"
                    className="underline"
                    onClick={() =>
                      setQuestion(
                        messages.data
                          ?.filter((previous) => previous.role === "user")
                          .slice(-1)[0]?.content ?? "",
                      )
                    }
                  >
                    Editar y reintentar
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
        {streaming && (
          <>
            <div className="ml-7 rounded-xl bg-muted p-3 text-sm">
              {pendingQuestion}
            </div>
            <div className="text-sm">{partial || "Buscando evidencia…"}</div>
            <p className="text-[10px] text-muted-foreground">
              Respuesta en curso. Las citas se validan al terminar.
            </p>
          </>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
        className="border-t p-3"
      >
        {!!suggestions.data?.questions?.length && (
          <div className="mb-3 space-y-1">
            <p className="text-[10px] text-muted-foreground">
              Preguntas basadas en fuentes · {suggestions.data.model}
            </p>
            {suggestions.data.questions.map((item) => (
              <button
                type="button"
                key={item.question}
                className="block w-full rounded border px-2 py-1.5 text-left text-xs hover:bg-muted"
                onClick={() => setQuestion(item.question)}
              >
                {item.question}
              </button>
            ))}
          </div>
        )}
        <textarea
          aria-label="Pregunta sobre tus documentos"
          placeholder="Pregunta sobre tus documentos…"
          value={question}
          rows={3}
          maxLength={4000}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          className="w-full resize-none rounded-lg border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            Las fuentes se verifican con IDs y geometría.
          </span>
          {streaming ||
          messages.data?.some((message) => message.state === "GENERATING") ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void cancel()}
            >
              <Square size={14} /> Detener
            </Button>
          ) : (
            <Button size="sm" disabled={!question.trim() || !documents.length}>
              <Send size={14} /> Preguntar
            </Button>
          )}
        </div>
      </form>
    </div>
  )
}
