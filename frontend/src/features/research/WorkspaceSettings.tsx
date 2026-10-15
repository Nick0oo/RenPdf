import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Shield, StickyNote, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import type { DocumentPublic, EvidencePublic, ProviderConfig } from "@/client"
import { DocumentsService, ProvidersService, WorkspacesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { errorMessage, type ProviderName } from "./api"
import { ChoiceSelect } from "./ChoiceSelect"
import { PrivacyPanel } from "./PrivacyPanel"
import { documentStatus, processingLabel } from "./presentation"

export type SettingsTab = "fuentes" | "privacidad" | "notas"
type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  workspaceId: string
  documents: DocumentPublic[]
  activeDocument?: DocumentPublic
  onDocumentChange: (id: string) => void
  selectedIds: string[] | null
  onSelectionChange: (ids: string[] | null) => void
  onDocumentsChange: () => void
  providers: ProviderConfig[]
  privacyProvider: ProviderName
  onPrivacyProviderChange: (provider: ProviderName) => void
  currentPage: number
  onSaveNote: (text: string) => Promise<unknown>
  onCitation: (source: EvidencePublic) => void
}

export function WorkspaceSettings({
  open,
  onOpenChange,
  tab,
  onTabChange,
  workspaceId,
  documents,
  activeDocument,
  onDocumentChange,
  selectedIds,
  onSelectionChange,
  onDocumentsChange,
  providers,
  privacyProvider,
  onPrivacyProviderChange,
  currentPage,
  onSaveNote,
  onCitation,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b p-6">
          <SheetTitle>Fuentes y permisos</SheetTitle>
          <SheetDescription>
            Elige qué consultar, prepara tus documentos y controla los envíos a
            modelos.
          </SheetDescription>
        </SheetHeader>
        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value as SettingsTab)}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="border-b px-6 py-3">
            <TabsList className="w-full">
              <TabsTrigger value="fuentes">
                <FileText size={14} /> Fuentes
              </TabsTrigger>
              <TabsTrigger value="privacidad">
                <Shield size={14} /> Privacidad
              </TabsTrigger>
              <TabsTrigger value="notas">
                <StickyNote size={14} /> Notas
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <TabsContent value="fuentes" className="space-y-6">
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    Fuentes de esta conversación
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSelectionChange(null)}
                  >
                    Todas
                  </Button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Solo se consultarán los PDFs marcados. Puedes dejar fuera los
                  que todavía se están procesando.
                </p>
                {documents.map((document) => (
                  <div
                    key={document.id}
                    className="flex items-center gap-3 rounded-xl border p-3"
                  >
                    <Checkbox
                      aria-label={`Consultar ${document.title}`}
                      checked={
                        selectedIds === null ||
                        selectedIds.includes(document.id)
                      }
                      onCheckedChange={(checked) => {
                        const current =
                          selectedIds ?? documents.map((item) => item.id)
                        onSelectionChange(
                          checked
                            ? [...new Set([...current, document.id])]
                            : current.filter((id) => id !== document.id),
                        )
                      }}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => onDocumentChange(document.id)}
                    >
                      <span className="block truncate text-sm font-medium">
                        {document.title}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {documentStatus(document.status)}
                      </span>
                    </button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Quitar ${document.title} del proyecto`}
                      onClick={async () => {
                        try {
                          await WorkspacesService.detachDocument({
                            path: {
                              workspace_id: workspaceId,
                              document_id: document.id,
                            },
                          })
                          if (selectedIds)
                            onSelectionChange(
                              selectedIds.filter((id) => id !== document.id),
                            )
                          onDocumentsChange()
                        } catch (error) {
                          toast.error(errorMessage(error))
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                {!documents.length && (
                  <p className="text-sm text-muted-foreground">
                    Añade un PDF desde el botón Añadir fuente.
                  </p>
                )}
              </section>
              {activeDocument && (
                <>
                  <section className="space-y-2 border-t pt-5">
                    <Label>Documento que configuras</Label>
                    <ChoiceSelect
                      label="Documento que configuras"
                      placeholder="Selecciona un PDF"
                      value={activeDocument.id}
                      onValueChange={onDocumentChange}
                      options={documents.map((document) => ({
                        value: document.id,
                        label: document.title,
                      }))}
                    />
                  </section>
                  <DocumentTools
                    key={activeDocument.id}
                    document={activeDocument}
                    workspaceId={workspaceId}
                    onDocumentsChange={onDocumentsChange}
                  />
                </>
              )}
            </TabsContent>
            <TabsContent value="privacidad" className="space-y-4">
              <div className="space-y-2">
                <Label>Proveedor al que autorizas</Label>
                <ChoiceSelect
                  label="Proveedor para autorizaciones"
                  placeholder="Seleccionar proveedor"
                  value={privacyProvider}
                  onValueChange={(value) =>
                    onPrivacyProviderChange(value as ProviderName)
                  }
                  options={providers.map((provider) => ({
                    value: provider.name,
                    label: `${provider.name} · ${provider.is_cloud ? "Nube" : "Local"}`,
                  }))}
                />
              </div>
              {activeDocument && (
                <>
                  <div className="space-y-2">
                    <Label>Documento al que aplica el permiso</Label>
                    <ChoiceSelect
                      label="Documento para autorizaciones"
                      placeholder="Selecciona un PDF"
                      value={activeDocument.id}
                      onValueChange={onDocumentChange}
                      options={documents.map((document) => ({
                        value: document.id,
                        label: document.title,
                      }))}
                    />
                  </div>
                  {providers.find(
                    (provider) => provider.name === privacyProvider,
                  )?.is_cloud === false ? (
                    <div className="rounded-xl border bg-primary/5 p-4 text-sm">
                      <p className="font-medium">Procesamiento local</p>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        Este endpoint procesa los fragmentos en el equipo. La
                        consulta local no necesita autorización de envío a la
                        nube.
                      </p>
                    </div>
                  ) : (
                    <PrivacyPanel
                      document={activeDocument}
                      provider={privacyProvider}
                    />
                  )}
                </>
              )}
              {!activeDocument && (
                <p className="text-sm text-muted-foreground">
                  Añade un PDF para administrar sus permisos.
                </p>
              )}
            </TabsContent>
            <TabsContent value="notas">
              <WorkspaceNotes
                workspaceId={workspaceId}
                activeDocument={activeDocument}
                currentPage={currentPage}
                onSaveNote={onSaveNote}
                onCitation={(source) => {
                  onCitation(source)
                  onOpenChange(false)
                }}
              />
            </TabsContent>
          </div>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}

function DocumentTools({
  document,
  workspaceId,
  onDocumentsChange,
}: {
  document: DocumentPublic
  workspaceId: string
  onDocumentsChange: () => void
}) {
  const [dimensions, setDimensions] = useState(768)
  const [multimodal, setMultimodal] = useState(false)
  const routing = useQuery({
    queryKey: ["routing"],
    queryFn: async () => (await ProvidersService.readRouting()).data,
  })
  const embedding =
    routing.data?.find(
      (row) =>
        row.task === "embeddings" &&
        row.scope_key === `workspace:${workspaceId}`,
    ) ??
    routing.data?.find(
      (row) => row.task === "embeddings" && row.scope_key === "personal",
    )
  const supportsMultimodal =
    (embedding?.provider ?? "gemini") === "gemini" &&
    (embedding?.model ?? "gemini-embedding-2").startsWith("gemini-embedding-2")
  const jobs = useQuery({
    queryKey: ["jobs", document.id],
    queryFn: async () =>
      (
        await DocumentsService.documentJobs({
          path: { document_id: document.id },
        })
      ).data,
    refetchInterval: 2000,
  })
  const enrichment = useQuery({
    queryKey: ["enrichment", document.id],
    queryFn: async () =>
      (
        await DocumentsService.readEnrichment({
          path: { document_id: document.id },
        })
      ).data,
    refetchInterval: 5000,
  })
  const fail = (error: unknown) => toast.error(errorMessage(error))
  const index = useMutation({
    mutationFn: () =>
      DocumentsService.reindex({
        path: { document_id: document.id },
        body: {
          provider: (embedding?.provider ?? "gemini") as ProviderName,
          model: embedding?.model ?? "gemini-embedding-2",
          dimensions,
          modality: supportsMultimodal && multimodal ? "multimodal" : "text",
        },
      }),
    onSuccess: () => {
      onDocumentsChange()
      toast.success("Índice solicitado; consulta su progreso")
    },
    onError: fail,
  })
  const enrich = useMutation({
    mutationFn: (purpose: "questions" | "summary") =>
      DocumentsService.generateEnrichment({
        path: { document_id: document.id },
        body: { purpose },
      }),
    onSuccess: () =>
      toast.success("Generación solicitada; se guardará al terminar"),
    onError: fail,
  })
  return (
    <div className="space-y-6">
      {document.warning && (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed">
          {document.warning}
        </p>
      )}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Búsqueda en tu PDF</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          El texto extraído ya permite hacer preguntas. Crear un índice mejora
          la búsqueda por significado y requiere permiso si eliges un proveedor
          en la nube.
        </p>
        <div className="grid grid-cols-2 gap-4 rounded-xl border bg-muted/15 p-4">
          <div className="space-y-2">
            <Label htmlFor="embedding-dimensions">Dimensiones</Label>
            <Input
              id="embedding-dimensions"
              aria-label="Dimensiones del embedding"
              type="number"
              min={1}
              max={2000}
              value={dimensions}
              onChange={(event) =>
                setDimensions(Number(event.target.value) || 768)
              }
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium">Proveedor</p>
            <p className="break-words text-sm">
              {embedding?.provider ?? "gemini"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {embedding?.model ?? "gemini-embedding-2"}
            </p>
          </div>
          <div className="col-span-2 flex items-start gap-3">
            <Checkbox
              id="multimodal-index"
              checked={supportsMultimodal && multimodal}
              disabled={!supportsMultimodal}
              onCheckedChange={(checked) => setMultimodal(checked === true)}
            />
            <Label
              htmlFor="multimodal-index"
              className="text-xs leading-relaxed"
            >
              Incluir imágenes{" "}
              {supportsMultimodal ? "" : "(requiere Gemini Embedding 2)"}
            </Label>
          </div>
        </div>
        <Button
          className="w-full"
          disabled={index.isPending || !document.current_version_id}
          onClick={() => index.mutate()}
        >
          {index.isPending ? "Solicitando…" : "Crear / renovar índice"}
        </Button>
      </section>
      <section className="space-y-3 border-t pt-5">
        <h3 className="text-sm font-semibold">Herramientas del documento</h3>
        <div className="grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={enrich.isPending || !document.current_version_id}
            onClick={() => enrich.mutate("questions")}
          >
            Generar 5 preguntas
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={enrich.isPending || !document.current_version_id}
            onClick={() => enrich.mutate("summary")}
          >
            Resumir evidencia
          </Button>
        </div>
        {enrichment.data?.summary && (
          <div className="rounded-xl border p-4 text-sm">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Resumen de evidencias · {enrichment.data.model}
            </p>
            <p className="whitespace-pre-wrap leading-relaxed">
              {enrichment.data.summary}
            </p>
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={async () => {
            try {
              await DocumentsService.reprocess({
                path: { document_id: document.id },
              })
              await jobs.refetch()
            } catch (error) {
              fail(error)
            }
          }}
        >
          Reprocesar PDF
        </Button>
      </section>
      <section className="space-y-3 border-t pt-5">
        <h3 className="text-sm font-semibold">Procesamiento reciente</h3>
        {jobs.data?.slice(0, 3).map((job) => (
          <div key={job.id} className="space-y-2 rounded-xl border p-3 text-xs">
            <div className="flex items-center justify-between">
              <span>{processingLabel(job.kind, job.state)}</span>
              <span>{job.progress}%</span>
            </div>
            <progress
              className="h-1.5 w-full accent-primary"
              aria-label={`Progreso de ${job.kind}`}
              value={job.progress}
              max={100}
            />
            {job.error_message && (
              <p className="leading-relaxed text-destructive">
                {job.error_message}
              </p>
            )}
            {["FAILED", "CANCELLED"].includes(job.state) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    await DocumentsService.retryJob({
                      path: { document_id: document.id, job_id: job.id },
                    })
                    await jobs.refetch()
                  } catch (error) {
                    fail(error)
                  }
                }}
              >
                Reintentar procesamiento
              </Button>
            ) : (
              job.state !== "SUCCEEDED" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await DocumentsService.cancelJob({
                        path: { document_id: document.id, job_id: job.id },
                      })
                      await jobs.refetch()
                    } catch (error) {
                      fail(error)
                    }
                  }}
                >
                  Cancelar trabajo
                </Button>
              )
            )}
          </div>
        ))}
      </section>
    </div>
  )
}

function WorkspaceNotes({
  workspaceId,
  activeDocument,
  currentPage,
  onSaveNote,
  onCitation,
}: Pick<
  Props,
  "workspaceId" | "activeDocument" | "currentPage" | "onSaveNote" | "onCitation"
>) {
  const cache = useQueryClient()
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const annotations = useQuery({
    queryKey: ["annotations", workspaceId],
    queryFn: async () =>
      (
        await WorkspacesService.listAnnotations({
          path: { workspace_id: workspaceId },
        })
      ).data,
  })
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Notas y marcadores</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {activeDocument
            ? `${activeDocument.title} · página ${currentPage}`
            : "Abre un PDF para guardar una nota."}
        </p>
        <Label htmlFor="workspace-note">Nota personal</Label>
        <Input
          id="workspace-note"
          placeholder="Una idea para recordar…"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        <Button
          disabled={!note.trim() || !activeDocument || saving}
          onClick={async () => {
            setSaving(true)
            try {
              await onSaveNote(note)
              setNote("")
            } catch (error) {
              toast.error(errorMessage(error))
            } finally {
              setSaving(false)
            }
          }}
        >
          <StickyNote size={14} /> Guardar nota · p. {currentPage}
        </Button>
      </div>
      <div className="space-y-2 border-t pt-5">
        {annotations.data?.map((annotation) => (
          <div
            key={annotation.id}
            className="flex items-center gap-3 rounded-xl border p-3"
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left text-sm"
              onClick={() =>
                onCitation({
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
              }
            >
              <span className="block text-xs text-primary">
                p. {annotation.page_number}
              </span>
              <span className="mt-1 block truncate">
                {annotation.text || "Marcador"}
              </span>
            </button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Eliminar anotación"
              onClick={async () => {
                try {
                  await WorkspacesService.deleteAnnotation({
                    path: {
                      workspace_id: workspaceId,
                      annotation_id: annotation.id,
                    },
                  })
                  await cache.invalidateQueries({
                    queryKey: ["annotations", workspaceId],
                  })
                } catch (error) {
                  toast.error(errorMessage(error))
                }
              }}
            >
              <Trash2 size={14} />
            </Button>
          </div>
        ))}
        {!annotations.isPending && !annotations.data?.length && (
          <p className="text-sm text-muted-foreground">
            Tus notas aparecerán aquí.
          </p>
        )}
      </div>
    </div>
  )
}
