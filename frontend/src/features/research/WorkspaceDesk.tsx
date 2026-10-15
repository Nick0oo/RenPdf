import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  FilePlus2,
  FileText,
  MessageSquare,
  Plus,
  Settings2,
  Shield,
  StickyNote,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ChatPanel } from "@/features/chat/ChatPanel"
import { ProviderModelSelect } from "@/features/models/ProviderModelSelect"
import { PdfReader } from "@/features/pdf-viewer/PdfReader"
import {
  errorMessage,
  modelSelection,
  modelValue,
  type ProviderName,
} from "./api"
import { chatDate } from "./presentation"
import { WorkspaceContext } from "./WorkspaceContext"
import { WorkspaceProperties } from "./WorkspaceProperties"
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
  const [readerOpen, setReaderOpen] = useState(false)
  const [contextOpen, setContextOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
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
      setReaderOpen(false)
      return cache.invalidateQueries({
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
    if (
      !openChatOnLoad ||
      conversations.isPending ||
      routing.isPending ||
      openedChat.current
    )
      return
    openedChat.current = true
    if (!conversations.data?.length && !conversations.error)
      newConversation.mutate()
  }, [
    openChatOnLoad,
    conversations.isPending,
    conversations.data,
    conversations.error,
    routing.isPending,
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
    setReaderOpen(true)
  }
  const ask = (text: string, element?: ElementPublic, vision?: boolean) => {
    setDraft({ text, elementId: element?.id, vision, nonce: Date.now() })
    setReaderOpen(false)
    if (!conversation && !newConversation.isPending) newConversation.mutate()
  }
  const openPdf = (id: string) => {
    setDocumentId(id)
    setReaderOpen(true)
  }
  const context = (
    <WorkspaceContext
      workspaceId={workspace.id}
      documents={documents.data ?? []}
      library={library}
      activeDocument={activeDocument}
      selectedIds={selectedIds}
      onSelectionChange={setSelectedIds}
      onDocumentChange={(id) => {
        setDocumentId(id)
        setSource(undefined)
      }}
      onDocumentsChange={invalidateDocuments}
      onOpenPdf={openPdf}
      currentPage={currentPage}
      onSaveNote={(text) =>
        addNote.mutateAsync({ page: currentPage, kind: "note", text })
      }
      onCitation={citation}
    />
  )
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="shrink-0 border-b px-5 py-5 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onBack}
              className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft size={13} /> Workspaces
            </button>
            <h1
              className="line-clamp-2 text-xl font-semibold tracking-tight sm:truncate sm:text-2xl"
              title={workspace.name}
            >
              {workspace.name}
            </h1>
            <p className="mt-2 max-w-2xl truncate text-sm text-muted-foreground">
              {workspace.description ||
                "Tu investigación, tus conversaciones y las ideas que estás construyendo."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-label="Fuentes y permisos"
              onClick={() => manageSources()}
            >
              <Shield size={14} />{" "}
              <span className="hidden sm:inline">Fuentes y permisos</span>
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Configuración del workspace"
              onClick={() => setPropertiesOpen(true)}
            >
              <Settings2 size={16} />
            </Button>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText size={14} /> {activeDocs.length} de{" "}
            {documents.data?.length ?? 0} fuentes activas
          </span>
          <span className="hidden h-4 border-l sm:block" />
          {conversation && (
            <ProviderModelSelect
              providers={providers}
              task="chat"
              label="Modelo de conversación"
              value={modelValue(conversation.provider, conversation.model)}
              onValueChange={(value) => changeModel.mutate(value)}
              disabled={changeModel.isPending}
              size="sm"
              className="max-w-xs"
            />
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!activeDocument}
            onClick={() => {
              if (activeDocument) openPdf(activeDocument.id)
            }}
          >
            <BookOpen size={14} /> Abrir PDF
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto xl:hidden"
            onClick={() => setContextOpen(true)}
          >
            <StickyNote size={14} /> Fuentes y notas
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-5 md:px-8">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="max-w-[min(70%,26rem)] justify-start px-0"
                  aria-label="Historial de chats"
                >
                  <MessageSquare size={15} />
                  <span className="truncate">
                    {conversation?.title ?? "Conversaciones"}
                  </span>
                  <ChevronDown size={13} />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(24rem,calc(100vw-2rem))]">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Tus conversaciones</h2>
                  <span className="text-xs text-muted-foreground">
                    {conversations.data?.length ?? 0}
                  </span>
                </div>
                <div className="max-h-80 space-y-1 overflow-auto">
                  {conversations.data?.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={conversation?.id === item.id}
                      onClick={() => {
                        setConversationId(item.id)
                        setDraft(undefined)
                      }}
                      className={`block w-full rounded-lg px-3 py-3 text-left hover:bg-muted ${conversation?.id === item.id ? "bg-primary/5 text-primary" : ""}`}
                    >
                      <span className="block truncate text-sm font-medium">
                        {item.title}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {chatDate(item.created_at)}
                      </span>
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Nueva conversación"
              disabled={newConversation.isPending}
              onClick={() => {
                setDraft(undefined)
                newConversation.mutate()
              }}
            >
              <Plus size={14} /> Nuevo chat
            </Button>
          </div>
          {conversation ? (
            <ChatPanel
              embedded
              modelPending={changeModel.isPending || newConversation.isPending}
              key={conversation.id}
              conversation={conversation}
              documents={activeDocs}
              draft={draft}
              onCitation={citation}
              onManageSources={manageSources}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
              <MessageSquare size={32} className="mb-5 text-primary" />
              <h2 className="text-2xl font-semibold">
                Abre la conversación de tu investigación
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                Añade tus PDFs y pregunta sobre lo que necesitas comprender. Las
                respuestas citadas volverán a su página original.
              </p>
              <Button
                className="mt-6"
                disabled={newConversation.isPending || !activeDocument}
                onClick={() => newConversation.mutate()}
              >
                Iniciar conversación
              </Button>
              {!activeDocument && (
                <Button
                  variant="outline"
                  className="mt-3"
                  onClick={() => setContextOpen(true)}
                >
                  <FilePlus2 size={15} /> Importar PDFs
                </Button>
              )}
            </div>
          )}
        </div>
        <aside className="hidden min-h-0 overflow-y-auto border-l bg-muted/15 p-5 xl:block">
          {context}
        </aside>
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
      <WorkspaceProperties
        workspace={workspace}
        providers={providers}
        open={propertiesOpen}
        onOpenChange={setPropertiesOpen}
      />
      <Sheet open={contextOpen} onOpenChange={setContextOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-md">
          <SheetHeader className="border-b p-6">
            <SheetTitle>Fuentes y notas</SheetTitle>
            <SheetDescription>
              Los documentos y las ideas de este workspace.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">{context}</div>
        </SheetContent>
      </Sheet>
      <Sheet open={readerOpen} onOpenChange={setReaderOpen}>
        <SheetContent className="w-full gap-0 sm:max-w-[min(72rem,92vw)]">
          <SheetHeader className="border-b p-5 pr-12">
            <SheetTitle className="truncate">
              {activeDocument?.title ?? "Lector PDF"}
            </SheetTitle>
            <SheetDescription>
              Lee la evidencia y vuelve al chat al terminar.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 p-3 md:p-5">
            {activeDocument && (
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
            )}
          </div>
          {source?.text && (
            <div className="shrink-0 border-t bg-primary/5 px-5 py-3">
              <p className="text-xs font-medium">
                {source.document_title} · página {source.page_number}
              </p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {source.text}
              </p>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
