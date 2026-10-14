import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, FileText, Plus, Shield, StickyNote } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import type {
  BBox,
  DocumentPublic,
  ElementPublic,
  EvidencePublic,
  ProviderConfig,
  WorkspacePublic,
} from "@/client"
import {
  ChatService,
  DocumentsService,
  ProvidersService,
  WorkspacesService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChatPanel } from "@/features/chat/ChatPanel"
import { PdfReader } from "@/features/pdf-viewer/PdfReader"
import {
  errorMessage,
  modelSelection,
  modelValue,
  type ProviderName,
} from "./api"
import { PrivacyPanel } from "./PrivacyPanel"

export function WorkspaceDesk({
  workspace,
  library,
  providers,
  onBack,
}: {
  workspace: WorkspacePublic
  library: DocumentPublic[]
  providers: ProviderConfig[]
  onBack: () => void
}) {
  const cache = useQueryClient()
  const documents = useQuery({
    queryKey: ["workspace-documents", workspace.id],
    queryFn: async () =>
      (
        await WorkspacesService.listWorkspaceDocuments({
          path: { workspace_id: workspace.id },
        })
      ).data,
    refetchInterval: 2500,
  })
  const conversations = useQuery({
    queryKey: ["conversations", workspace.id],
    queryFn: async () =>
      (
        await ChatService.conversations({
          path: { workspace_id: workspace.id },
        })
      ).data,
  })
  const routing = useQuery({
    queryKey: ["routing"],
    queryFn: async () => (await ProvidersService.readRouting()).data,
  })
  const annotations = useQuery({
    queryKey: ["annotations", workspace.id],
    queryFn: async () =>
      (
        await WorkspacesService.listAnnotations({
          path: { workspace_id: workspace.id },
        })
      ).data,
  })
  const [documentId, setDocumentId] = useState(
    localStorage.getItem(`workspace-document:${workspace.id}`) ?? "",
  )
  const [conversationId, setConversationId] = useState(
    localStorage.getItem(`workspace-conversation:${workspace.id}`) ?? "",
  )
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [source, setSource] = useState<EvidencePublic>()
  const [mobilePanel, setMobilePanel] = useState("pdf")
  const [controls, setControls] = useState(false)
  const [note, setNote] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const [draft, setDraft] = useState<{
    text: string
    elementId?: string
    vision?: boolean
    nonce: number
  }>()
  const [privacyProvider, setPrivacyProvider] = useState<ProviderName>("gemini")
  const [split, setSplit] = useState(55)
  const [embeddingDimensions, setEmbeddingDimensions] = useState(768)
  const [multimodalIndex, setMultimodalIndex] = useState(false)
  const activeDocument =
    documents.data?.find((document) => document.id === documentId) ??
    documents.data?.[0]
  const conversation =
    conversations.data?.find((item) => item.id === conversationId) ??
    conversations.data?.[0]
  const activeDocs =
    documents.data?.filter(
      (document) => !selectedIds.length || selectedIds.includes(document.id),
    ) ?? []
  const modelOptions = providers.flatMap((provider) =>
    (provider.models ?? [])
      .filter((model) => model.capabilities?.text !== "unsupported")
      .map((model) => ({ ...model, name: provider.name })),
  )
  const invalidateDocuments = () => {
    void cache.invalidateQueries({
      queryKey: ["workspace-documents", workspace.id],
    })
    void cache.invalidateQueries({ queryKey: ["documents"] })
  }
  const fail = (error: unknown) => toast.error(errorMessage(error))
  const attach = useMutation({
    mutationFn: (document_id: string) =>
      WorkspacesService.attachDocument({
        path: { workspace_id: workspace.id, document_id },
      }),
    onSuccess: invalidateDocuments,
    onError: fail,
  })
  const newConversation = useMutation({
    mutationFn: () => {
      const preferred =
        routing.data?.find(
          (row) =>
            row.task === "chat" &&
            row.scope_key === `workspace:${workspace.id}`,
        ) ??
        routing.data?.find(
          (row) => row.task === "chat" && row.scope_key === "personal",
        )
      const defaultModel =
        modelOptions.find(
          (model) => model.name === "gemini" && model.id === "gemini-2.5-flash",
        ) ?? modelOptions[0]
      return ChatService.createConversation({
        path: { workspace_id: workspace.id },
        body: {
          title: "Nueva investigación",
          provider: (preferred?.provider ??
            defaultModel?.name ??
            "gemini") as ProviderName,
          model: preferred?.model ?? defaultModel?.id ?? "",
        },
      })
    },
    onSuccess: (response) => {
      setConversationId(response.data.id)
      void cache.invalidateQueries({
        queryKey: ["conversations", workspace.id],
      })
    },
    onError: fail,
  })
  const changeModel = useMutation({
    mutationFn: (value: string) =>
      ChatService.selectConversationModel({
        path: { conversation_id: conversation?.id ?? "" },
        body: modelSelection(value),
      }),
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: ["conversations", workspace.id] }),
    onError: fail,
  })
  const addNote = useMutation({
    mutationFn: ({
      page,
      kind,
      text,
      bbox,
    }: {
      page: number
      kind: "note" | "bookmark" | "highlight"
      text: string
      bbox?: BBox
    }) =>
      WorkspacesService.createAnnotation({
        path: { workspace_id: workspace.id },
        body: {
          document_id: activeDocument?.id ?? "",
          page_number: page,
          text,
          kind,
          bbox,
        },
      }),
    onSuccess: () => {
      setNote("")
      void cache.invalidateQueries({ queryKey: ["annotations", workspace.id] })
      toast.success("Anotación guardada")
    },
    onError: fail,
  })
  const embedding =
    routing.data?.find(
      (row) =>
        row.task === "embeddings" &&
        row.scope_key === `workspace:${workspace.id}`,
    ) ??
    routing.data?.find(
      (row) => row.task === "embeddings" && row.scope_key === "personal",
    )
  const index = useMutation({
    mutationFn: () =>
      DocumentsService.reindex({
        path: { document_id: activeDocument?.id ?? "" },
        body: {
          provider: (embedding?.provider ?? "gemini") as ProviderName,
          model: embedding?.model ?? "gemini-embedding-2",
          dimensions: embeddingDimensions,
          modality: multimodalIndex ? "multimodal" : "text",
        },
      }),
    onSuccess: () => {
      invalidateDocuments()
      toast.success("Indexación solicitada; consulta el progreso")
    },
    onError: fail,
  })
  const enrich = useMutation({
    mutationFn: (purpose: "questions" | "summary") =>
      DocumentsService.generateEnrichment({
        path: { document_id: activeDocument?.id ?? "" },
        body: { purpose },
      }),
    onSuccess: () =>
      toast.success("Generación solicitada; se guardará al terminar"),
    onError: fail,
  })
  const enrichment = useQuery({
    queryKey: ["enrichment", activeDocument?.id],
    queryFn: async () =>
      (
        await DocumentsService.readEnrichment({
          path: { document_id: activeDocument?.id ?? "" },
        })
      ).data,
    enabled: !!activeDocument && controls,
    refetchInterval: 5000,
  })
  const jobs = useQuery({
    queryKey: ["jobs", activeDocument?.id],
    queryFn: async () =>
      (
        await DocumentsService.documentJobs({
          path: { document_id: activeDocument?.id ?? "" },
        })
      ).data,
    enabled: !!activeDocument,
    refetchInterval: 2000,
  })
  const onPage = useCallback((page: number) => setCurrentPage(page), [])
  useEffect(() => {
    if (activeDocument)
      localStorage.setItem(
        `workspace-document:${workspace.id}`,
        activeDocument.id,
      )
  }, [activeDocument, workspace.id])
  useEffect(() => {
    if (conversation)
      localStorage.setItem(
        `workspace-conversation:${workspace.id}`,
        conversation.id,
      )
  }, [conversation, workspace.id])
  const citation = (evidence: EvidencePublic) => {
    setDocumentId(evidence.document_id)
    setSource(evidence)
    setMobilePanel("pdf")
  }
  const ask = (text: string, element?: ElementPublic, vision?: boolean) => {
    setDraft({ text, elementId: element?.id, vision, nonce: Date.now() })
    setMobilePanel("chat")
  }
  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Volver a biblioteca"
          onClick={onBack}
        >
          <ArrowLeft size={18} />
        </Button>
        <div className="mr-auto">
          <p className="text-[10px] uppercase tracking-[0.2em] text-primary">
            Workspace
          </p>
          <h1 className="text-xl font-semibold">{workspace.name}</h1>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setControls(!controls)}
        >
          <Shield size={14} /> Fuentes y permisos
        </Button>
        <select
          aria-label="Conversación"
          className="h-9 max-w-40 rounded-md border bg-background px-2 text-xs"
          value={conversation?.id ?? ""}
          onChange={(e) => setConversationId(e.target.value)}
        >
          <option value="">Conversaciones</option>
          {conversations.data?.map((item) => (
            <option key={item.id} value={item.id}>
              {item.title}
            </option>
          ))}
        </select>
        <Button
          size="icon"
          variant="outline"
          aria-label="Nueva conversación"
          disabled={newConversation.isPending}
          onClick={() => newConversation.mutate()}
        >
          <Plus size={16} />
        </Button>
        {conversation && (
          <select
            aria-label="Modelo de conversación"
            className="h-9 max-w-56 rounded-md border bg-background px-2 text-xs"
            value={modelValue(conversation.provider, conversation.model)}
            onChange={(e) => changeModel.mutate(e.target.value)}
          >
            {!modelOptions.some(
              (model) =>
                modelValue(model.name, model.id) ===
                modelValue(conversation.provider, conversation.model),
            ) && (
              <option
                value={modelValue(conversation.provider, conversation.model)}
              >
                {conversation.model || "Seleccionar modelo"}
              </option>
            )}
            {modelOptions.map((model) => (
              <option
                key={modelValue(model.name, model.id)}
                value={modelValue(model.name, model.id)}
              >
                {model.name} · {model.id}
              </option>
            ))}
          </select>
        )}
      </header>
      <div className="flex flex-wrap gap-2">
        {documents.data?.map((document) => (
          <button
            type="button"
            key={document.id}
            onClick={() => {
              setDocumentId(document.id)
              setSource(undefined)
            }}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${document.id === activeDocument?.id ? "border-primary bg-primary/5 text-primary" : "bg-background"}`}
          >
            <FileText size={14} />
            {document.title}
            <span className="opacity-60">{document.status}</span>
          </button>
        ))}
        <select
          aria-label="Añadir documento al workspace"
          className="max-w-56 rounded-lg border bg-background px-3 py-2 text-xs"
          value=""
          onChange={(e) => {
            if (e.target.value) attach.mutate(e.target.value)
          }}
        >
          <option value="">+ Añadir fuente</option>
          {library
            .filter(
              (document) =>
                !documents.data?.some((item) => item.id === document.id),
            )
            .map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
        </select>
      </div>
      {controls && (
        <section className="grid gap-4 rounded-xl border bg-muted/20 p-4 md:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-sm font-medium">Documentos consultados</h2>
            <p className="text-xs text-muted-foreground">
              Sin selección se consultan todas las fuentes del workspace.
            </p>
            {documents.data?.map((document) => (
              <div
                key={document.id}
                className="flex items-center gap-2 text-xs"
              >
                <input
                  type="checkbox"
                  aria-label={`Consultar ${document.title}`}
                  checked={selectedIds.includes(document.id)}
                  onChange={(e) =>
                    setSelectedIds((ids) =>
                      e.target.checked
                        ? [...ids, document.id]
                        : ids.filter((id) => id !== document.id),
                    )
                  }
                />
                {document.title}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await WorkspacesService.detachDocument({
                      path: {
                        workspace_id: workspace.id,
                        document_id: document.id,
                      },
                    })
                    invalidateDocuments()
                  }}
                >
                  Quitar
                </Button>
              </div>
            ))}
            {activeDocument && (
              <>
                <p className="text-xs text-muted-foreground">
                  {activeDocument.warning}
                </p>
                <label
                  htmlFor="embedding-dimensions"
                  className="flex items-center gap-2 text-xs"
                >
                  Dimensiones del embedding
                  <Input
                    aria-label="Dimensiones del embedding"
                    id="embedding-dimensions"
                    type="number"
                    min={1}
                    max={2000}
                    className="h-8 w-24"
                    value={embeddingDimensions}
                    onChange={(event) =>
                      setEmbeddingDimensions(Number(event.target.value) || 768)
                    }
                  />
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={multimodalIndex}
                    onChange={(event) =>
                      setMultimodalIndex(event.target.checked)
                    }
                  />{" "}
                  Indexar también imágenes con Gemini Embedding 2
                </label>
                <Button
                  size="sm"
                  disabled={
                    index.isPending || !activeDocument.current_version_id
                  }
                  onClick={() => index.mutate()}
                >
                  Crear / renovar índice · {embedding?.provider ?? "gemini"}
                </Button>
                {jobs.data?.slice(0, 3).map((job) => (
                  <div key={job.id} className="rounded-lg border p-2 text-xs">
                    <div className="flex justify-between">
                      <span>
                        {job.kind} · {job.state}
                      </span>
                      <span>{job.progress}%</span>
                    </div>
                    <progress
                      className="mt-1 h-1 w-full"
                      value={job.progress}
                      max={100}
                    />
                    <p className="mt-1 text-destructive">{job.error_message}</p>
                    {["FAILED", "CANCELLED"].includes(job.state) ? (
                      <button
                        type="button"
                        className="underline"
                        onClick={async () => {
                          try {
                            await DocumentsService.retryJob({
                              path: {
                                document_id: activeDocument?.id ?? "",
                                job_id: job.id,
                              },
                            })
                            await jobs.refetch()
                          } catch (e) {
                            fail(e)
                          }
                        }}
                      >
                        Reintentar desde checkpoint
                      </button>
                    ) : (
                      !["SUCCEEDED"].includes(job.state) && (
                        <button
                          type="button"
                          className="underline"
                          onClick={async () => {
                            await DocumentsService.cancelJob({
                              path: {
                                document_id: activeDocument.id,
                                job_id: job.id,
                              },
                            })
                            await jobs.refetch()
                          }}
                        >
                          Cancelar trabajo
                        </button>
                      )
                    )}
                  </div>
                ))}
              </>
            )}
            <h3 className="pt-2 text-sm font-medium">Notas y marcadores</h3>
            <Input
              aria-label="Nota personal"
              placeholder="Una idea para recordar…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!note || !activeDocument}
              onClick={() =>
                addNote.mutate({ page: currentPage, kind: "note", text: note })
              }
            >
              <StickyNote size={14} /> Guardar nota · p. {currentPage}
            </Button>
            {annotations.data?.map((annotation) => (
              <div
                key={annotation.id}
                className="flex items-center gap-2 rounded-lg border p-2 text-xs"
              >
                <button
                  type="button"
                  className="mr-auto text-left"
                  onClick={() => {
                    setDocumentId(annotation.document_id)
                    setSource({
                      document_id: annotation.document_id,
                      page_number: annotation.page_number,
                      version_id: annotation.version_id,
                      bbox: annotation.bbox,
                      document_title: "Marcador",
                      chunk_id: "",
                      element_id: "",
                      text: annotation.text,
                      rotation: 0,
                    })
                  }}
                >
                  p. {annotation.page_number} · {annotation.text || "Marcador"}
                </button>
                <button
                  type="button"
                  aria-label="Eliminar anotación"
                  onClick={async () => {
                    await WorkspacesService.deleteAnnotation({
                      path: {
                        workspace_id: workspace.id,
                        annotation_id: annotation.id,
                      },
                    })
                    await annotations.refetch()
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <select
              aria-label="Proveedor para autorizaciones"
              className="h-9 rounded-md border bg-background px-3 text-sm"
              value={privacyProvider}
              onChange={(e) =>
                setPrivacyProvider(e.target.value as ProviderName)
              }
            >
              {providers.map((provider) => (
                <option key={provider.name} value={provider.name}>
                  {provider.name}
                </option>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={enrich.isPending}
                  onClick={() => enrich.mutate("questions")}
                >
                  Generar 5 preguntas
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={enrich.isPending}
                  onClick={() => enrich.mutate("summary")}
                >
                  Resumir evidencia
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await DocumentsService.reprocess({
                        path: { document_id: activeDocument?.id ?? "" },
                      })
                      await jobs.refetch()
                    } catch (error) {
                      fail(error)
                    }
                  }}
                >
                  Reprocesar PDF
                </Button>
              </div>
              {enrichment.data?.summary && (
                <details className="rounded-lg border p-3 text-xs">
                  <summary>
                    Resumen de evidencias · {enrichment.data.model}
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap">
                    {enrichment.data.summary}
                  </p>
                </details>
              )}
            </select>
            {activeDocument && (
              <PrivacyPanel
                document={activeDocument}
                provider={privacyProvider}
              />
            )}
          </div>
        </section>
      )}
      <div className="flex gap-2 md:hidden">
        <Button
          variant={mobilePanel === "pdf" ? "default" : "outline"}
          onClick={() => setMobilePanel("pdf")}
        >
          Documento
        </Button>
        <Button
          variant={mobilePanel === "chat" ? "default" : "outline"}
          onClick={() => setMobilePanel("chat")}
        >
          Chat
        </Button>
      </div>
      {!activeDocument ? (
        <div className="rounded-xl border border-dashed p-16 text-center text-sm text-muted-foreground">
          Añade tu primer documento para comenzar.
        </div>
      ) : (
        <div
          className="research-split grid gap-3"
          style={{ "--pdf-width": `${split}%` } as React.CSSProperties}
        >
          <div
            className={`h-[72vh] min-h-[500px] min-w-0 ${mobilePanel !== "pdf" ? "hidden md:block" : ""}`}
          >
            <PdfReader
              document={activeDocument}
              citation={
                source?.document_id === activeDocument.id ? source : undefined
              }
              onAsk={ask}
              onPage={onPage}
              onHighlight={(page, bbox, text) =>
                addNote.mutate({ page, bbox, text, kind: "highlight" })
              }
              onBookmark={(page) =>
                addNote.mutate({ page, kind: "bookmark", text: "" })
              }
            />
          </div>
          <div className="hidden w-2 cursor-col-resize items-center justify-center md:flex">
            <input
              aria-label="Ajustar ancho del visor"
              type="range"
              min={35}
              max={65}
              value={split}
              onChange={(e) => setSplit(Number(e.target.value))}
              className="h-24 w-2 [writing-mode:vertical-lr]"
            />
          </div>
          <div
            className={`h-[72vh] min-h-[500px] min-w-0 ${mobilePanel !== "chat" ? "hidden md:block" : ""}`}
          >
            {conversation ? (
              <ChatPanel
                key={conversation.id}
                conversation={conversation}
                documents={activeDocs}
                draft={draft}
                onCitation={citation}
              />
            ) : (
              <div className="grid h-full place-content-center rounded-xl border bg-muted/10 text-center">
                <p className="mb-3 text-sm text-muted-foreground">
                  Tu PDF está listo para leer.
                </p>
                <Button
                  disabled={newConversation.isPending}
                  onClick={() => newConversation.mutate()}
                >
                  Iniciar conversación
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
      {source?.text && (
        <aside className="rounded-lg border-l-2 border-primary bg-primary/5 px-4 py-3 text-xs">
          <strong>
            {source.document_title} · página {source.page_number}
          </strong>
          <p className="mt-1 line-clamp-3 text-muted-foreground">
            {source.text}
          </p>
        </aside>
      )}
    </div>
  )
}
