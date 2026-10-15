import { useQuery } from "@tanstack/react-query"
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  RotateCw,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Page, Document as PDF, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/TextLayer.css"
import "react-pdf/dist/Page/AnnotationLayer.css"
import type {
  BBox,
  DocumentPublic,
  ElementPublic,
  EvidencePublic,
} from "@/client"
import { DocumentsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiRoot } from "@/features/research/api"

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString()

export function rotateBox(box: BBox, degrees: number): BBox {
  const { x, y, width: w, height: h } = box
  switch ((degrees + 360) % 360) {
    case 90:
      return { x: 1 - y - h, y: x, width: h, height: w }
    case 180:
      return { x: 1 - x - w, y: 1 - y - h, width: w, height: h }
    case 270:
      return { x: y, y: 1 - x - w, width: h, height: w }
    default:
      return box
  }
}

type Props = {
  document: DocumentPublic
  citation?: EvidencePublic
  onAsk: (text: string, element?: ElementPublic, vision?: boolean) => void
  onBookmark: (page: number) => void
  onPage: (page: number) => void
  onHighlight: (page: number, bbox: BBox, text: string) => void
}
type RenderFrame = {
  key: string
  documentId: string
  page: number
  width: number
  rotation: number
}

export function PdfReader({
  document,
  citation,
  onAsk,
  onBookmark,
  onPage,
  onHighlight,
}: Props) {
  const [page, setPage] = useState(
    Number(localStorage.getItem(`pdf-page:${document.id}`)) || 1,
  )
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [nativeRotation, setNativeRotation] = useState(0)
  const [width, setWidth] = useState(540)
  const [search, setSearch] = useState("")
  const [selection, setSelection] = useState("")
  const [selectedElement, setSelectedElement] = useState<ElementPublic>()
  const [error, setError] = useState("")
  const [renderedFrame, setRenderedFrame] = useState<RenderFrame>()
  const requestedFrame = useMemo(
    () => ({
      key: `${document.id}:${page}:${width}:${zoom}:${nativeRotation}:${rotation}`,
      documentId: document.id,
      page,
      width: width * zoom,
      rotation: (nativeRotation + rotation) % 360,
    }),
    [document.id, page, width, zoom, nativeRotation, rotation],
  )
  const currentFrame = useRef(requestedFrame)
  currentFrame.current = requestedFrame
  const previousFrame =
    renderedFrame?.documentId === document.id &&
    renderedFrame.key !== requestedFrame.key
      ? renderedFrame
      : undefined
  const ready = renderedFrame?.key === requestedFrame.key && !error
  const pendingPage = !ready && !error
  const container = useRef<HTMLDivElement>(null)
  const highlight = useRef<HTMLDivElement>(null)
  const file = useMemo(
    () => ({
      url: `${apiRoot}/documents/${document.id}/file`,
      withCredentials: true,
    }),
    [document.id],
  )
  const elements = useQuery({
    queryKey: ["elements", document.id, page, citation?.version_id],
    queryFn: async () =>
      (
        await DocumentsService.pageElementsApi({
          path: { document_id: document.id, page_number: page },
          query: { version_id: citation?.version_id },
        })
      ).data,
    enabled: !!document.current_version_id,
    retry: false,
  })
  const movePage = useCallback((nextPage: number) => {
    setSelection("")
    setSelectedElement(undefined)
    setError("")
    setPage(nextPage)
  }, [])

  useEffect(() => {
    const target = container.current
    if (!target) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width - 32)),
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setPage(Number(localStorage.getItem(`pdf-page:${document.id}`)) || 1)
    setSelection("")
    setSelectedElement(undefined)
    setRotation(0)
    setNativeRotation(0)
    setRenderedFrame(undefined)
    setError("")
  }, [document.id])
  useEffect(() => {
    if (citation?.document_id === document.id) movePage(citation.page_number)
  }, [citation, document.id, movePage])
  useEffect(() => {
    if (!renderedFrame || renderedFrame.documentId !== document.id) return
    localStorage.setItem(`pdf-page:${document.id}`, String(renderedFrame.page))
    onPage(renderedFrame.page)
  }, [renderedFrame, document.id, onPage])
  useEffect(() => {
    if (
      citation &&
      renderedFrame?.page === citation.page_number &&
      highlight.current
    )
      highlight.current.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [citation, renderedFrame])
  const box =
    citation?.page_number === page ? citation.bbox : selectedElement?.bbox
  const transformed = box ? rotateBox(box, nativeRotation + rotation) : null
  const matching =
    elements.data?.filter(
      (element) =>
        search &&
        element.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    ) ?? []
  const captureSelection = () => {
    if (!ready) return
    const text = window.getSelection()?.toString().trim() ?? ""
    if (text && text.length < 4000) {
      setSelection(text)
      const source = elements.data?.find((element) =>
        element.text.replace(/\s+/g, " ").includes(text.replace(/\s+/g, " ")),
      )
      setSelectedElement(source)
    }
  }
  return (
    <div className="flex h-full min-h-[500px] flex-col overflow-hidden rounded-xl border bg-muted/30">
      <div className="flex flex-wrap items-center gap-1 border-b bg-background p-2">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Página anterior"
          disabled={page <= 1}
          onClick={() => movePage(page - 1)}
        >
          <ChevronLeft size={17} />
        </Button>
        <Input
          aria-label="Página del PDF"
          type="number"
          className="h-8 w-16 text-center"
          value={page}
          min={1}
          max={document.page_count}
          onChange={(e) =>
            movePage(
              Math.min(
                document.page_count,
                Math.max(1, Number(e.target.value) || 1),
              ),
            )
          }
        />
        <span className="mr-auto text-xs text-muted-foreground">
          / {document.page_count}
        </span>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Página siguiente"
          disabled={page >= document.page_count}
          onClick={() => movePage(page + 1)}
        >
          <ChevronRight size={17} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Reducir zoom"
          onClick={() => setZoom(Math.max(0.5, zoom - 0.15))}
        >
          <ZoomOut size={17} />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setZoom(1)}>
          {Math.round(zoom * 100)}%
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Aumentar zoom"
          onClick={() => setZoom(Math.min(2.5, zoom + 0.15))}
        >
          <ZoomIn size={17} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Rotar PDF"
          onClick={() => setRotation((rotation + 90) % 360)}
        >
          <RotateCw size={17} />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Guardar marcador"
          disabled={!ready}
          onClick={() => onBookmark(page)}
        >
          <Bookmark size={17} />
        </Button>
      </div>
      <div className="flex items-center gap-2 border-b bg-background px-3 py-2">
        <Search size={15} className="text-muted-foreground" />
        <Input
          aria-label="Buscar en esta página"
          disabled={!ready}
          placeholder="Buscar en esta página…"
          className="h-7 border-0 shadow-none"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <section
        aria-label="Contenido del PDF"
        ref={container}
        className="min-h-0 flex-1 overflow-auto p-4"
        onMouseUp={captureSelection}
      >
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <PDF
          file={file}
          onLoadError={() =>
            setError(
              "No se pudo abrir el PDF. Verifica tu sesión y el archivo original.",
            )
          }
          loading={
            <p className="animate-pulse py-20 text-center">
              Abriendo tu documento…
            </p>
          }
        >
          <div
            className="relative mx-auto w-fit shadow-md"
            data-testid="pdf-render-surface"
          >
            {(previousFrame
              ? [previousFrame, requestedFrame]
              : [requestedFrame]
            ).map((frame) => {
              const isPrevious = frame.key !== requestedFrame.key
              return (
                <div
                  key={frame.key}
                  data-testid={
                    isPrevious || !previousFrame
                      ? "pdf-page"
                      : "pdf-page-buffer"
                  }
                  data-page={frame.page}
                  aria-hidden={isPrevious || (!!previousFrame && pendingPage)}
                  className={
                    isPrevious
                      ? "pointer-events-none"
                      : previousFrame
                        ? "absolute left-0 top-0 pointer-events-none opacity-0"
                        : undefined
                  }
                >
                  <Page
                    pageNumber={frame.page}
                    width={frame.width}
                    rotate={frame.rotation}
                    suspense={false}
                    renderTextLayer={!isPrevious}
                    renderAnnotationLayer={!isPrevious}
                    onLoadSuccess={(loaded) => {
                      if (currentFrame.current.key === frame.key)
                        setNativeRotation(loaded.rotate)
                    }}
                    onRenderSuccess={() => {
                      if (currentFrame.current.key === frame.key)
                        setRenderedFrame((previous) =>
                          previous?.key === frame.key ? previous : frame,
                        )
                    }}
                    onRenderError={() => {
                      if (!isPrevious)
                        setError(
                          "No se pudo mostrar esta página. Prueba otra página o vuelve a abrir el PDF.",
                        )
                    }}
                    onLoadError={() => {
                      if (!isPrevious)
                        setError("No se pudo cargar esta página del PDF.")
                    }}
                    loading={
                      <div
                        className="min-h-80 bg-background"
                        style={{ width: frame.width }}
                      />
                    }
                    error={
                      <p className="p-6 text-sm text-destructive">
                        Página no disponible.
                      </p>
                    }
                  />
                </div>
              )
            })}
            {pendingPage && (
              <p
                role="status"
                className="absolute left-1/2 top-3 z-30 -translate-x-1/2 whitespace-nowrap rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"
              >
                Abriendo página {page}…
              </p>
            )}
            {ready && transformed && (
              <div
                ref={highlight}
                data-testid="citation-highlight"
                className="pointer-events-none absolute z-20 rounded-sm border-2 border-amber-500 bg-amber-300/25"
                style={{
                  left: `${transformed.x * 100}%`,
                  top: `${transformed.y * 100}%`,
                  width: `${transformed.width * 100}%`,
                  height: `${transformed.height * 100}%`,
                }}
              />
            )}
          </div>
        </PDF>
      </section>
      {ready && (selection || selectedElement) && (
        <div className="border-t bg-background p-3 text-xs">
          <p className="mb-2 line-clamp-2">
            {selection || selectedElement?.text || "Región visual seleccionada"}
          </p>
          <Button
            size="sm"
            onClick={() =>
              onAsk(
                selection || "Describe esta región y explica su información.",
                selectedElement,
                selectedElement?.element_type === "figure",
              )
            }
          >
            <MessageSquare size={14} /> Preguntar sobre esta selección
          </Button>
          {selectedElement?.bbox && (
            <Button
              size="sm"
              variant="outline"
              className="ml-2"
              onClick={() =>
                onHighlight(
                  page,
                  selectedElement.bbox!,
                  selection || selectedElement.text,
                )
              }
            >
              Guardar subrayado de región
            </Button>
          )}
        </div>
      )}
      {(search ||
        elements.data?.some(
          (element) =>
            element.element_type === "figure" ||
            element.element_type === "table",
        )) && (
        <div className="max-h-32 overflow-auto border-t bg-background p-2">
          {(search
            ? matching
            : (elements.data?.filter((element) =>
                ["figure", "table"].includes(element.element_type),
              ) ?? [])
          ).map((element) => (
            <button
              type="button"
              key={element.id}
              disabled={!ready}
              className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
              onClick={() => {
                setSelectedElement(element)
                setSelection(element.text)
              }}
            >
              <span className="mr-2 font-medium text-primary">
                {element.element_type === "figure"
                  ? "Figura"
                  : element.element_type === "table"
                    ? "Tabla"
                    : "Texto"}
              </span>
              {element.text.slice(0, 100) || "Interpretación visual pendiente"}
            </button>
          ))}
          {search && !matching.length && (
            <p className="p-2 text-xs text-muted-foreground">
              Sin coincidencias en el texto extraído de esta página.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
