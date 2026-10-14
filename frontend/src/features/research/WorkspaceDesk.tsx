import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  ChevronDown,
  FileText,
  MessageSquare,
  Plus,
  Shield,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import type {
  BBox,
  DocumentPublic,
  ElementPublic,
  EvidencePublic,
  ProviderConfig,
  WorkspacePublic,
} from "@/client"
import { ChatService, ProvidersService, WorkspacesService } from "@/client"
import { Button } from "@/components/ui/button"
import { ChatPanel } from "@/features/chat/ChatPanel"
import { ProviderModelSelect } from "@/features/models/ProviderModelSelect"
import { PdfReader } from "@/features/pdf-viewer/PdfReader"
import {
  errorMessage,
  modelSelection,
  modelValue,
  type ProviderName,
} from "./api"
import { ChoiceSelect } from "./ChoiceSelect"
import { chatDate, documentStatus } from "./presentation"
import { type SettingsTab, WorkspaceSettings } from "./WorkspaceSettings"

export function WorkspaceDesk({
  workspace,
  library,
  providers,
  entryDocumentId,
  openChatOnLoad = false,
  onBack,
}: {
  workspace: WorkspacePublic
  library: DocumentPublic[]
  providers: ProviderConfig[]
  entryDocumentId?: string
  openChatOnLoad?: boolean
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
  const [documentId, setDocumentId] = useState(
    entryDocumentId ??
      localStorage.getItem(`workspace-document:${workspace.id}`) ??
      "",
  )
  const [conversationId, setConversationId] = useState(
    localStorage.getItem(`workspace-conversation:${workspace.id}`) ?? "",
  )
  const [selectedIds, setSelectedIds] = useState<string[] | null>(
    entryDocumentId ? [entryDocumentId] : null,
  )
  const [source, setSource] = useState<EvidencePublic>()
  const [mobilePanel, setMobilePanel] = useState("chat")
  const [allChats, setAllChats] = useState(false)
  const openedChat = useRef(false)
  const [controls, setControls] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("fuentes")
  const [currentPage, setCurrentPage] = useState(1)
  const [draft, setDraft] = useState<{
    text: string
    elementId?: string
    vision?: boolean
    nonce: number
  }>()
  const [privacyProvider, setPrivacyProvider] = useState<ProviderName>("gemini")
  const [split, setSplit] = useState(45)
  const activeDocument =
    documents.data?.find((document) => document.id === documentId) ??
    documents.data?.[0]
  const conversation =
    conversations.data?.find((item) => item.id === conversationId) ??
    conversations.data?.[0]
  const activeDocs =
    documents.data?.filter(
      (document) => selectedIds === null || selectedIds.includes(document.id),
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
    onSuccess: (_response, document_id) => {
      invalidateDocuments()
      setSelectedIds((ids) =>
        ids === null ? null : [...new Set([...ids, document_id])],
      )
    },
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
          title:
            `Chat ${(conversations.data?.length ?? 0) + 1} · ${activeDocument?.title ?? workspace.name}`.slice(
              0,
              120,
            ),
          provider: (preferred?.provider ??
            defaultModel?.name ??
            "gemini") as ProviderName,
          model: preferred?.model ?? defaultModel?.id ?? "",
        },
      })
    },
    onSuccess: (response) => {
      setConversationId(response.data.id)
      setMobilePanel("chat")
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
      void cache.invalidateQueries({ queryKey: ["annotations", workspace.id] })
      toast.success("Anotación guardada")
    },
    onError: fail,
  })
  const onPage = useCallback((page: number) => setCurrentPage(page), [])
  useEffect(() => {
    if (!openChatOnLoad || conversations.isPending || openedChat.current) return
    openedChat.current = true
    if (!conversations.data?.length && !conversations.error)
      newConversation.mutate()
  }, [
    openChatOnLoad,
    conversations.isPending,
    conversations.data,
    conversations.error,
    newConversation,
  ])
  const manageSources = (reason?: string) => {
    setSettingsTab(reason === "CONSENT_REQUIRED" ? "privacidad" : "fuentes")
    setControls(true)
    setPrivacyProvider((conversation?.provider ?? "gemini") as ProviderName)
  }
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
    if (!conversation && !newConversation.isPending) newConversation.mutate()
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
        <div className="mr-auto min-w-0 flex-1 basis-[calc(100%_-_3.25rem)] md:basis-auto">
          <h1 className="truncate text-xl font-semibold" title={workspace.name}>
            {workspace.name}
          </h1>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSettingsTab("fuentes")
            setControls(true)
          }}
        >
          <Shield size={14} /> Fuentes y permisos
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-label="Nueva conversación"
          disabled={newConversation.isPending}
          onClick={() => {
            setDraft(undefined)
            newConversation.mutate()
          }}
        >
          <Plus size={16} /> Nuevo chat
        </Button>
        {conversation && (
          <ProviderModelSelect
            providers={providers}
            task="chat"
            label="Modelo de conversación"
            value={modelValue(conversation.provider, conversation.model)}
            onValueChange={(value) => changeModel.mutate(value)}
            disabled={changeModel.isPending}
            size="sm"
            className="max-w-64"
          />
        )}
      </header>
      {!!conversations.data?.length && (
        <section
          aria-label="Historial de chats"
          className="rounded-xl border bg-muted/20 p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-xs font-medium">
              <MessageSquare size={14} /> Tus conversaciones
            </h2>
            {
              <button
                type="button"
                className={`items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${conversations.data.length > 3 || allChats ? "flex" : "flex sm:hidden"}`}
                onClick={() => setAllChats(!allChats)}
              >
                {allChats
                  ? "Ocultar historial"
                  : `Cambiar chat (${conversations.data.length})`}{" "}
                <ChevronDown size={13} />
              </button>
            }
          </div>
          <div
            className={`${allChats ? "grid" : "hidden sm:grid"} max-h-48 gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3`}
          >
            {(allChats
              ? conversations.data
              : conversations.data.slice(0, 3)
            ).map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={conversation?.id === item.id}
                onClick={() => {
                  setConversationId(item.id)
                  setMobilePanel("chat")
                  setDraft(undefined)
                }}
                className={`min-w-0 rounded-lg border px-3 py-2 text-left transition-colors ${conversation?.id === item.id ? "border-primary/50 bg-primary/5" : "border-transparent bg-background hover:border-primary/30"}`}
              >
                <span className="block truncate text-sm font-medium">
                  {item.title}
                </span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {chatDate(item.created_at)} ·{" "}
                  {conversation?.id === item.id
                    ? "Chat abierto"
                    : "Continuar chat"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          {documents.data?.map((document) => (
            <button
              type="button"
              key={document.id}
              onClick={() => {
                setDocumentId(document.id)
                setSource(undefined)
              }}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs ${document.id === activeDocument?.id ? "border-primary bg-primary/5 text-primary" : "bg-background"}`}
            >
              <FileText size={14} />
              <span className="max-w-48 truncate" title={document.title}>
                {document.title}
              </span>
              <span className="opacity-60">
                {documentStatus(document.status)}
              </span>
            </button>
          ))}
        </div>
        <ChoiceSelect
          label="Añadir documento al workspace"
          placeholder="+ Añadir fuente"
          value=""
          onValueChange={(id) => attach.mutate(id)}
          disabled={attach.isPending}
          options={library
            .filter(
              (document) =>
                !documents.data?.some((item) => item.id === document.id),
            )
            .map((document) => ({ value: document.id, label: document.title }))}
          size="sm"
          className="w-36 shrink-0 md:w-48"
        />
      </div>
      <WorkspaceSettings
        open={controls}
        onOpenChange={setControls}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        workspaceId={workspace.id}
        documents={documents.data ?? []}
        activeDocument={activeDocument}
        onDocumentChange={(id) => {
          setDocumentId(id)
          setSource(undefined)
        }}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        onDocumentsChange={invalidateDocuments}
        providers={providers}
        privacyProvider={privacyProvider}
        onPrivacyProviderChange={setPrivacyProvider}
        currentPage={currentPage}
        onSaveNote={(text) =>
          addNote.mutateAsync({ page: currentPage, kind: "note", text })
        }
        onCitation={citation}
      />
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
            className={`h-[72vh] min-h-[520px] min-w-0 ${mobilePanel !== "chat" ? "hidden md:block" : ""}`}
          >
            {conversation ? (
              <ChatPanel
                key={conversation.id}
                conversation={conversation}
                documents={activeDocs}
                draft={draft}
                onCitation={citation}
                onManageSources={manageSources}
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
