import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BookOpen,
  FilePlus2,
  FileText,
  Headphones,
  Plus,
  Table2,
  Trash2,
  Video,
} from "lucide-react"
import { useId, useRef, useState } from "react"
import { toast } from "sonner"
import type { DocumentPublic, EvidencePublic } from "@/client"
import { DocumentsService, WorkspacesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { formatTime, sourceType } from "@/features/media/location"
import { cn } from "@/lib/utils"
import { errorMessage } from "./api"
import { DocumentCoverage } from "./DocumentCoverage"
import { documentStatus } from "./presentation"

type Props = {
  workspaceId: string
  documents: DocumentPublic[]
  library: DocumentPublic[]
  activeDocument?: DocumentPublic
  selectedIds: string[] | null
  onSelectionChange: (ids: string[] | null) => void
  onDocumentChange: (id: string) => void
  onDocumentsChange: () => void
  onOpenPdf: (id: string) => void
  onPrepareSource?: (id: string) => void
  currentPage: number
  onSaveNote: (text: string) => Promise<unknown>
  onCitation: (source: EvidencePublic) => void
}

export function WorkspaceContext({
  workspaceId,
  documents,
  library,
  activeDocument,
  selectedIds,
  onSelectionChange,
  onDocumentChange,
  onDocumentsChange,
  onOpenPdf,
  onPrepareSource,
  currentPage,
  onSaveNote,
  onCitation,
}: Props) {
  const noteId = useId()
  const cache = useQueryClient()
  const upload = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
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
  const addDocument = async (id: string) => {
    await WorkspacesService.attachDocument({
      path: { workspace_id: workspaceId, document_id: id },
    })
    onSelectionChange(
      selectedIds === null ? null : [...new Set([...selectedIds, id])],
    )
    onDocumentsChange()
  }
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Fuentes del workspace"
        className="flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FileText size={15} /> Fuentes{" "}
            <span className="font-normal text-muted-foreground">
              {documents.length}
            </span>
          </h2>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Añadir fuentes al workspace"
              >
                <Plus size={16} />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <h3 className="text-sm font-semibold">Añadir fuentes</h3>
              <Button
                className="mt-4 w-full"
                disabled={uploading}
                onClick={() => upload.current?.click()}
              >
                <FilePlus2 size={15} /> Importar fuentes
              </Button>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                PDF, Excel, CSV, TSV, MP3, WAV, M4A, FLAC, OGG, MP4, WEBM y MOV.
                Hasta 50 MB por archivo; audio y video hasta 30 minutos.
              </p>
              <p className="mt-4 text-xs text-muted-foreground">
                Desde tu biblioteca
              </p>
              <div className="mt-2 max-h-56 space-y-1 overflow-auto">
                {library
                  .filter(
                    (document) =>
                      !documents.some((item) => item.id === document.id),
                  )
                  .map((document) => (
                    <Button
                      key={document.id}
                      variant="ghost"
                      className="h-auto w-full justify-start whitespace-normal px-2 py-2 text-left text-xs"
                      onClick={async () => {
                        try {
                          await addDocument(document.id)
                        } catch (error) {
                          toast.error(errorMessage(error))
                        }
                      }}
                    >
                      <FileText size={13} className="shrink-0" />
                      {document.title}
                    </Button>
                  ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Marca las fuentes del chat. Haz clic para leer o reproducir.
        </p>
        {documents.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Consultar todas"
              onClick={() => onSelectionChange(null)}
            >
              Todas
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Desmarcar todas"
              onClick={() => onSelectionChange([])}
            >
              Ninguna
            </Button>
          </div>
        )}
        <input
          ref={upload}
          type="file"
          multiple
          accept="application/pdf,audio/*,video/*,.pdf,.xlsx,.xlsm,.xls,.csv,.tsv,.mp3,.wav,.m4a,.flac,.ogg,.mp4,.webm,.mov"
          data-testid="workspace-pdf-upload"
          className="hidden"
          onChange={async (event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ""
            if (!files.length) return
            const added: string[] = []
            setUploading(true)
            try {
              for (const file of files) {
                const response = await DocumentsService.uploadDocument({
                  body: { file },
                  query: { workspace_id: workspaceId },
                })
                await WorkspacesService.attachDocument({
                  path: {
                    workspace_id: workspaceId,
                    document_id: response.data.id,
                  },
                })
                added.push(response.data.id)
              }
              toast.success(`${added.length} fuentes añadidas al workspace`)
            } catch (error) {
              toast.error(errorMessage(error))
            } finally {
              if (added.length) {
                onSelectionChange(
                  selectedIds === null
                    ? null
                    : [...new Set([...selectedIds, ...added])],
                )
                onDocumentsChange()
              }
              setUploading(false)
            }
          }}
        />
        {uploading && (
          <p role="status" className="text-xs text-primary">
            Guardando tus fuentes…
          </p>
        )}
        <div className="space-y-2">
          {documents.map((document) => (
            <div
              key={document.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border p-2.5",
                activeDocument?.id === document.id
                  ? "border-primary/30 bg-primary/5"
                  : "bg-background",
              )}
            >
              <Checkbox
                aria-label={`Consultar ${document.title}`}
                checked={
                  selectedIds === null || selectedIds.includes(document.id)
                }
                onCheckedChange={(checked) => {
                  const ids = selectedIds ?? documents.map((item) => item.id)
                  onSelectionChange(
                    checked
                      ? [...new Set([...ids, document.id])]
                      : ids.filter((id) => id !== document.id),
                  )
                }}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  title={document.title}
                  className="line-clamp-2 w-full text-left text-xs font-medium leading-5"
                  onClick={() => onDocumentChange(document.id)}
                >
                  {document.title}
                </button>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {sourceType(document) === "pdf"
                    ? `${document.page_count} páginas`
                    : sourceType(document) === "spreadsheet"
                      ? `${document.sheet_count ?? 0} hojas · Excel`
                      : `${sourceType(document) === "video" ? "Video" : "Audio"} ${formatTime(document.duration_seconds)}`}{" "}
                  · {documentStatus(document.status)}
                </p>
                <DocumentCoverage
                  document={document}
                  onPrepare={() => onPrepareSource?.(document.id)}
                />
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Abrir fuente ${document.title}`}
                onClick={() => onOpenPdf(document.id)}
              >
                {sourceType(document) === "spreadsheet" ? (
                  <Table2 data-icon="inline-start" />
                ) : sourceType(document) === "video" ? (
                  <Video data-icon="inline-start" />
                ) : sourceType(document) === "audio" ? (
                  <Headphones data-icon="inline-start" />
                ) : (
                  <BookOpen data-icon="inline-start" />
                )}
              </Button>
            </div>
          ))}
        </div>
        {!documents.length && (
          <div className="rounded-xl border border-dashed p-4">
            <p className="text-sm font-medium">
              Este workspace aún no tiene fuentes
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Importa documentos, Excel, audios o videos para empezar.
            </p>
            <Button
              size="sm"
              className="mt-4"
              onClick={() => upload.current?.click()}
            >
              Importar fuentes
            </Button>
          </div>
        )}
      </section>
      <details className="border-t pt-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Notas ({annotations.data?.length ?? 0})
        </summary>
        <section
          aria-label="Notas del workspace"
          className="mt-4 flex flex-col gap-3"
        >
          <div className="space-y-2">
            <Label htmlFor={noteId} className="text-xs">
              Nota personal
            </Label>
            <textarea
              id={noteId}
              rows={3}
              maxLength={4000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Una idea, una duda o algo que quieres recordar…"
              className="w-full resize-none rounded-xl border bg-background p-3 text-xs leading-6 outline-none focus:ring-2 focus:ring-primary/20"
            />
            <p className="text-[11px] text-muted-foreground">
              {activeDocument && sourceType(activeDocument) === "pdf"
                ? `En ${activeDocument.title} · p. ${currentPage}`
                : "Las notas se vinculan a una página PDF. Abre un PDF para guardar una."}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={
                !note.trim() ||
                !activeDocument ||
                sourceType(activeDocument) !== "pdf" ||
                saving
              }
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
              Guardar nota
            </Button>
          </div>
          <div className="space-y-3">
            {annotations.data?.map((annotation) => (
              <article
                key={annotation.id}
                className="rounded-xl border bg-background p-3"
              >
                <button
                  type="button"
                  className="block w-full text-left text-xs leading-6"
                  onClick={() =>
                    onCitation({
                      document_id: annotation.document_id,
                      page_number: annotation.page_number,
                      version_id: annotation.version_id,
                      bbox: annotation.bbox,
                      document_title: "Nota",
                      text: annotation.text,
                      chunk_id: "",
                      element_id: "",
                      rotation: 0,
                    })
                  }
                >
                  {annotation.text || "Marcador de lectura"}
                </button>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    Página {annotation.page_number}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
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
                    <Trash2 size={12} />
                  </Button>
                </div>
              </article>
            ))}
          </div>
          {!annotations.isPending && !annotations.data?.length && (
            <p className="text-xs leading-5 text-muted-foreground">
              Las notas y marcas que guardes en tus PDFs aparecerán aquí.
            </p>
          )}
        </section>
      </details>
    </div>
  )
}
