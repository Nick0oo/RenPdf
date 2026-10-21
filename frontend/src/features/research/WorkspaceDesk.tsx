import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  FilePlus2,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Shield,
  StickyNote,
  Table2,
  X,
} from "lucide-react"
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react"
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
import { sourceLocation, sourceType } from "@/features/media/location"
import { MediaReader } from "@/features/media/MediaReader"
import { ProviderModelSelect } from "@/features/models/ProviderModelSelect"
import { SpreadsheetReader } from "@/features/spreadsheet/SpreadsheetReader"
import { cn } from "@/lib/utils"
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

const PdfReader = lazy(() =>
  import("@/features/pdf-viewer/PdfReader").then((module) => ({
    default: module.PdfReader,
  })),
)

export function WorkspaceDesk({
  workspace,
  library,
  providers,
  entryDocumentId,
  entryTime,
  entrySheet,
  entryCell,
  openChatOnLoad = false,
  onBack,
}: {
  workspace: WorkspacePublic
  library: DocumentPublic[]
  providers: ProviderConfig[]
  entryDocumentId?: string
  entryTime?: number
  entrySheet?: string
  entryCell?: string
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
  const [selectedIds, setSelectedIds] = useState<string[] | null>(() => {
    if (entryDocumentId) return [entryDocumentId]
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem(`workspace-sources:${workspace.id}`) ?? "null",
      )
      return Array.isArray(saved) && saved.every((id) => typeof id === "string")
        ? saved
        : null
    } catch {
      return null
    }
  })
  useEffect(() => {
    localStorage.setItem(
      `workspace-sources:${workspace.id}`,
      JSON.stringify(selectedIds),
    )
  }, [selectedIds, workspace.id])
  const [source, setSource] = useState<EvidencePublic>()
  const [readerOpen, setReaderOpen] = useState(
    () => localStorage.getItem(`workspace-reader:${workspace.id}`) === "open",
  )
  const [sourcesOpen, setSourcesOpen] = useState(
    () =>
      localStorage.getItem(`workspace-sidebar:${workspace.id}`) !== "closed",
  )
  useEffect(() => {
    localStorage.setItem(
      `workspace-reader:${workspace.id}`,
      readerOpen ? "open" : "closed",
    )
  }, [readerOpen, workspace.id])
  useEffect(() => {
    localStorage.setItem(
      `workspace-sidebar:${workspace.id}`,
      sourcesOpen ? "open" : "closed",
    )
  }, [sourcesOpen, workspace.id])
  const [contextOpen, setContextOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  useEffect(() => {
    if (entryDocumentId) {
      setDocumentId(entryDocumentId)
      setSelectedIds((ids) =>
        ids === null ? null : [...new Set([...ids, entryDocumentId])],
      )
      setSource(undefined)
      if (entryTime !== undefined || !openChatOnLoad) setReaderOpen(true)
    }
  }, [entryDocumentId, entryTime, openChatOnLoad])
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
  const showReader = readerOpen && !!activeDocument
  useEffect(() => {
    if (documents.isSuccess && !documents.data.length) setReaderOpen(false)
  }, [documents.isSuccess, documents.data])
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
    if (!conversation && !newConversation.isPending) newConversation.mutate()
  }
  const openPdf = (id: string) => {
    setDocumentId(id)
    setSource(undefined)
    setContextOpen(false)
    setCurrentPage(1)
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
      onDocumentChange={openPdf}
      onDocumentsChange={invalidateDocuments}
      onOpenPdf={openPdf}
      onPrepareSource={(id) => {
        setDocumentId(id)
        if (
          ["audio", "video"].includes(
            sourceType(documents.data?.find((document) => document.id === id)),
          )
        )
          openPdf(id)
        else manageSources()
      }}
      currentPage={currentPage}
      onSaveNote={(text) =>
        addNote.mutateAsync({ page: currentPage, kind: "note", text })
      }
      onCitation={citation}
    />
  )
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header
        data-testid="workspace-toolbar"
        className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2"
      >
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Volver a workspaces"
          onClick={onBack}
        >
          <ArrowLeft data-icon="inline-start" />
        </Button>
        <div className="min-w-0 flex-1 md:max-w-[25rem]">
          <h1 className="truncate text-sm font-semibold" title={workspace.name}>
            {workspace.name}
          </h1>
          <p className="text-[11px] text-muted-foreground">
            {activeDocs.length} de {documents.data?.length ?? 0} fuentes activas
          </p>
        </div>
        {conversation && (
          <ProviderModelSelect
            providers={providers}
            task="chat"
            label="Modelo de conversación"
            value={modelValue(conversation.provider, conversation.model)}
            onValueChange={(value) => changeModel.mutate(value)}
            disabled={changeModel.isPending}
            size="sm"
            className="order-last max-w-full basis-full sm:order-none sm:ml-auto sm:max-w-56 sm:basis-auto"
          />
        )}
        <Button
          size="sm"
          variant="outline"
          aria-label="Fuentes y permisos"
          onClick={() => manageSources()}
        >
          <Shield data-icon="inline-start" />
          <span className="hidden sm:inline">Permisos</span>
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Configuración del workspace"
          onClick={() => setPropertiesOpen(true)}
        >
          <Settings2 data-icon="inline-start" />
        </Button>
      </header>
      <div
        data-testid="workspace-panels"
        className={cn(
          "grid min-h-0 flex-1 grid-cols-1 overflow-hidden",
          showReader
            ? "grid-rows-[minmax(16rem,1fr)_minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:grid-rows-1"
            : "grid-rows-1",
          sourcesOpen &&
            (showReader
              ? "xl:grid-cols-[15.5rem_minmax(0,1fr)_minmax(0,1.1fr)]"
              : "xl:grid-cols-[15.5rem_minmax(0,1fr)]"),
        )}
      >
        <aside
          aria-label="Fuentes y notas persistentes"
          className={cn(
            "hidden min-h-0 overflow-y-auto border-r bg-muted/15 p-3",
            sourcesOpen && "xl:block",
          )}
        >
          {context}
        </aside>
        <div
          data-testid="workspace-chat"
          className="flex min-h-0 min-w-0 flex-col"
        >
          <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-3">
            <Button
              size="icon-sm"
              variant="ghost"
              className="hidden xl:inline-flex"
              aria-label={
                sourcesOpen
                  ? "Ocultar fuentes y notas"
                  : "Mostrar fuentes y notas"
              }
              onClick={() => setSourcesOpen((value) => !value)}
            >
              {sourcesOpen ? (
                <PanelLeftClose data-icon="inline-start" />
              ) : (
                <PanelLeftOpen data-icon="inline-start" />
              )}
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="xl:hidden"
              aria-label="Fuentes y notas"
              onClick={() => setContextOpen(true)}
            >
              <StickyNote data-icon="inline-start" />
            </Button>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mr-auto min-w-0 max-w-[min(60%,26rem)] shrink justify-start px-0"
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
            {!showReader && activeDocument && (
              <Button
                size="sm"
                variant="ghost"
                aria-label="Abrir visor de fuente"
                onClick={() => openPdf(activeDocument.id)}
              >
                <BookOpen data-icon="inline-start" />
                <span className="hidden sm:inline">Ver fuente</span>
              </Button>
            )}
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
                Añade documentos, hojas de cálculo, audios o videos y consulta
                varias fuentes a la vez. Las citas abren la página, celda o
                minuto que respalda la respuesta.
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
                  <FilePlus2 size={15} /> Importar fuentes
                </Button>
              )}
            </div>
          )}
        </div>
        {readerOpen && activeDocument && (
          <section
            aria-label="Visor de fuentes"
            data-testid="workspace-reader"
            className="flex min-h-0 min-w-0 flex-col border-t bg-muted/15 md:border-l md:border-t-0"
          >
            <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
              {sourceType(activeDocument) === "spreadsheet" ? (
                <Table2 data-icon="inline-start" />
              ) : (
                <BookOpen data-icon="inline-start" />
              )}
              <h2
                className="min-w-0 flex-1 truncate text-sm font-medium"
                title={activeDocument.title}
              >
                {activeDocument.title}
              </h2>
              <span className="text-xs text-muted-foreground">
                {sourceType(activeDocument) === "pdf"
                  ? `p. ${currentPage}`
                  : sourceType(activeDocument) === "video"
                    ? "Video"
                    : sourceType(activeDocument) === "spreadsheet"
                      ? "Excel"
                      : "Audio"}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Cerrar visor de fuente"
                onClick={() => setReaderOpen(false)}
              >
                <X data-icon="inline-start" />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              {sourceType(activeDocument) === "pdf" ? (
                <div className="h-full p-2">
                  <Suspense
                    fallback={
                      <p
                        role="status"
                        className="p-4 text-sm text-muted-foreground"
                      >
                        Abriendo PDF…
                      </p>
                    }
                  >
                    <PdfReader
                      document={activeDocument}
                      citation={
                        source?.document_id === activeDocument.id
                          ? source
                          : undefined
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
                  </Suspense>
                </div>
              ) : sourceType(activeDocument) === "spreadsheet" ? (
                <SpreadsheetReader
                  key={activeDocument.id}
                  document={activeDocument}
                  citation={
                    source?.document_id === activeDocument.id
                      ? source
                      : undefined
                  }
                  initialSheet={
                    entryDocumentId === activeDocument.id
                      ? entrySheet
                      : undefined
                  }
                  initialCell={
                    entryDocumentId === activeDocument.id
                      ? entryCell
                      : undefined
                  }
                />
              ) : (
                <MediaReader
                  key={activeDocument.id}
                  document={activeDocument}
                  citation={
                    source?.document_id === activeDocument.id
                      ? source
                      : undefined
                  }
                  initialTime={
                    entryDocumentId === activeDocument.id
                      ? entryTime
                      : undefined
                  }
                  providers={providers}
                  onDocumentsChange={invalidateDocuments}
                />
              )}
            </div>
            {source?.text && source.document_id === activeDocument.id && (
              <div className="shrink-0 border-t px-3 py-2 text-xs text-muted-foreground">
                <p className="font-medium">
                  {source.document_title} · {sourceLocation(source)}
                </p>
                <p className="mt-1 line-clamp-2">{source.text}</p>
              </div>
            )}
          </section>
        )}
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
    </div>
  )
}
