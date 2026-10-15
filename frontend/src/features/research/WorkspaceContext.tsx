import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BookOpen,
  FilePlus2,
  FileText,
  Plus,
  StickyNote,
  Trash2,
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
import { errorMessage } from "./api"
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
    onDocumentChange(id)
    onDocumentsChange()
  }
  return (
    <div className="space-y-7">
      <section aria-label="Fuentes del workspace" className="space-y-4">
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
                <FilePlus2 size={15} /> Importar PDFs
              </Button>
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
          Marca los PDFs que quieres consultar. Abre una fuente para leerla sin
          perder el chat.
        </p>
        <input
          ref={upload}
          type="file"
          multiple
          accept="application/pdf,.pdf"
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
                })
                await WorkspacesService.attachDocument({
                  path: {
                    workspace_id: workspaceId,
                    document_id: response.data.id,
                  },
                })
                added.push(response.data.id)
                onDocumentChange(response.data.id)
              }
              toast.success(`${files.length} PDFs añadidos al workspace`)
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
            Guardando tus PDFs…
          </p>
        )}
        <div className="space-y-2">
          {documents.map((document) => (
            <div
              key={document.id}
              className={`flex items-start gap-2.5 rounded-xl border p-3 ${activeDocument?.id === document.id ? "border-primary/30 bg-primary/5" : "bg-background"}`}
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
                  className="block w-full text-left text-xs font-medium leading-5"
                  onClick={() => onDocumentChange(document.id)}
                >
                  {document.title}
                </button>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {document.page_count} páginas ·{" "}
                  {documentStatus(document.status)}
                </p>
              </div>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Abrir PDF ${document.title}`}
                onClick={() => onOpenPdf(document.id)}
              >
                <BookOpen size={14} />
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
              Importa uno o varios PDFs para empezar.
            </p>
            <Button
              size="sm"
              className="mt-4"
              onClick={() => upload.current?.click()}
            >
              Importar PDFs
            </Button>
          </div>
        )}
      </section>
      <section
        aria-label="Notas del workspace"
        className="space-y-4 border-t pt-6"
      >
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <StickyNote size={15} /> Notas
          </h2>
          <span className="text-xs text-muted-foreground">
            {annotations.data?.length ?? 0}
          </span>
        </div>
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
            {activeDocument
              ? `En ${activeDocument.title} · p. ${currentPage}`
              : "Añade un PDF para guardar una nota."}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="w-full"
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
    </div>
  )
}
