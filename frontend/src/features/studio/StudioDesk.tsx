import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Download,
  FilePlus2,
  Files,
  Loader2,
  RotateCw,
  Scissors,
  X,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import type { DocumentPublic, JobPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { apiRoot, errorMessage } from "@/features/research/api"
import { ChoiceSelect } from "@/features/research/ChoiceSelect"
import {
  moduleRequest,
  traceDocuments,
  traceWorkspaces,
} from "@/features/trace/api"
import { StudioPreview } from "./StudioPreview"

export type StudioSection = "merge" | "pages" | "transform" | "history"
type Source = { id: string; pages: string }
type Operation = {
  id: string
  kind: string
  output_name: string
  output_document_id: string | null
  workspace_id: string | null
  page_count: number
  file_size: number
  state: string
  created_at: string
  sources: { document_id: string; pages: number[]; rotation: number }[]
}
type Result = { operation: Operation; document: DocumentPublic; job: JobPublic }
const headings: Record<StudioSection, string> = {
  merge: "Reúne tus PDFs en un archivo",
  pages: "Dale orden a tus páginas",
  transform: "Ajusta la lectura del PDF",
  history: "Tus copias, listas para descargar",
}

export function parsePageSelection(
  value: string,
  maximum: number,
): number[] | null {
  if (!value.trim()) return null
  const pages: number[] = []
  for (const token of value.split(",")) {
    const part = token.trim()
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part)
    if (!match)
      throw new Error("Usa páginas como 3, 1-2, 5. Las páginas comienzan en 1.")
    const from = Number(match[1])
    const to = Number(match[2] ?? match[1])
    if (from < 1 || to < from || to > maximum)
      throw new Error(`Selecciona páginas entre 1 y ${maximum}.`)
    if (pages.length + to - from + 1 > 500)
      throw new Error("La copia puede tener hasta 500 páginas.")
    for (let page = from; page <= to; page++) pages.push(page)
  }
  return pages
}

async function downloadCopy(identifier: string, name: string) {
  const response = await fetch(`${apiRoot}/documents/${identifier}/file`, {
    credentials: "include",
  })
  if (!response.ok)
    throw new Error("La copia no está disponible para descargar.")
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function StudioDesk({ section = "merge" }: { section?: StudioSection }) {
  const cache = useQueryClient()
  const [sources, setSources] = useState<Source[]>([])
  const [search, setSearch] = useState("")
  const [name, setName] = useState("Mi copia.pdf")
  const [workspace, setWorkspace] = useState("library")
  const [rotation, setRotation] = useState("0")
  const [margins, setMargins] = useState({
    left: "0",
    top: "0",
    right: "0",
    bottom: "0",
  })
  const [error, setError] = useState("")
  const [result, setResult] = useState<Result>()
  const [previewPage, setPreviewPage] = useState(1)
  const [historyPage, setHistoryPage] = useState(0)
  const documents = useQuery({
    queryKey: ["documents"],
    queryFn: traceDocuments,
  })
  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: traceWorkspaces,
  })
  const history = useQuery({
    queryKey: ["studio-history", historyPage],
    queryFn: () =>
      moduleRequest<Operation[]>(
        `/studio/operations?limit=30&offset=${historyPage * 30}`,
      ),
    enabled: section === "history",
  })
  const resultJobs = useQuery({
    queryKey: ["studio-output-jobs", result?.document.id],
    queryFn: () =>
      moduleRequest<JobPublic[]>(`/documents/${result?.document.id}/jobs`),
    enabled: !!result,
    refetchInterval: (query) =>
      ["SUCCEEDED", "FAILED", "CANCELLED"].includes(
        query.state.data?.find((job) => job.id === result?.job.id)?.state ??
          "QUEUED",
      )
        ? false
        : 3000,
  })
  const resultJob = resultJobs.data?.find((job) => job.id === result?.job.id)
  const savedDocument = useQuery({
    queryKey: ["studio-output", result?.document.id],
    queryFn: () =>
      moduleRequest<DocumentPublic>(`/documents/${result?.document.id}`),
    enabled: !!result,
    refetchInterval: (query) =>
      !["FAILED", "CANCELLED"].includes(resultJob?.state ?? "") &&
      ["UPLOADED", "PROCESSING"].includes(
        query.state.data?.status ?? "UPLOADED",
      )
        ? 3000
        : false,
  })
  const create = useMutation({
    mutationFn: (body: unknown) =>
      moduleRequest<Result>("/studio/operations", body),
    onSuccess: async (data) => {
      setResult(data)
      setError("")
      toast.success("Copia creada; preparando su texto para investigar.")
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["documents"] }),
        cache.invalidateQueries({ queryKey: ["studio-history"] }),
        cache.invalidateQueries({ queryKey: ["trace-overview"] }),
        cache.invalidateQueries({ queryKey: ["workspace-documents"] }),
      ])
    },
    onError: (value) => setError(errorMessage(value)),
  })
  useEffect(() => {
    setSources([])
    setResult(undefined)
    setError("")
    setPreviewPage(1)
    setName(
      section === "merge"
        ? "PDFs combinados.pdf"
        : section === "pages"
          ? "Páginas seleccionadas.pdf"
          : "PDF ajustado.pdf",
    )
  }, [section])
  const available = (documents.data ?? []).filter(
    (document) => (document.source_type ?? "pdf") === "pdf",
  )
  const current = available.find((document) => document.id === sources[0]?.id)
  const totalPages = sources.reduce((total, source) => {
    const document = available.find((item) => item.id === source.id)
    if (!document) return total
    try {
      return (
        total +
        (parsePageSelection(source.pages, document.page_count)?.length ??
          document.page_count)
      )
    } catch {
      return total
    }
  }, 0)

  function choose(document: DocumentPublic) {
    setPreviewPage(1)
    setSources((value) =>
      section === "merge"
        ? value.some((item) => item.id === document.id)
          ? value.filter((item) => item.id !== document.id)
          : [...value, { id: document.id, pages: "" }]
        : [{ id: document.id, pages: "" }],
    )
  }
  function move(index: number, delta: number) {
    setSources((value) => {
      const copy = [...value]
      ;[copy[index], copy[index + delta]] = [copy[index + delta], copy[index]]
      return copy
    })
  }
  function save() {
    setError("")
    try {
      if (sources.length === 0 || (section === "merge" && sources.length < 2))
        throw new Error(
          section === "merge"
            ? "Selecciona al menos dos PDFs para combinar."
            : "Selecciona un PDF de tu biblioteca.",
        )
      if (!name.trim()) throw new Error("Escribe un nombre para la copia.")
      const values = Object.fromEntries(
        Object.entries(margins).map(([key, value]) => [key, Number(value)]),
      )
      if (
        section === "transform" &&
        Object.values(values).some(
          (value) => !Number.isFinite(value) || value < 0 || value >= 100,
        )
      )
        throw new Error("Los márgenes deben estar entre 0 y 99%.")
      const crop =
        section === "transform" &&
        Object.values(values).some((value) => value !== 0)
          ? {
              x: values.left / 100,
              y: values.top / 100,
              width: 1 - (values.left + values.right) / 100,
              height: 1 - (values.top + values.bottom) / 100,
            }
          : null
      if (crop && (crop.width <= 0 || crop.height <= 0))
        throw new Error("El recorte debe dejar un área visible de la página.")
      create.mutate({
        kind: section,
        output_name: name,
        workspace_id: workspace === "library" ? null : workspace,
        sources: sources.map((source) => ({
          document_id: source.id,
          pages: parsePageSelection(
            source.pages,
            available.find((item) => item.id === source.id)?.page_count ?? 0,
          ),
          rotation: section === "transform" ? Number(rotation) : 0,
          crop,
        })),
      })
    } catch (value) {
      setError(errorMessage(value))
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1440px] space-y-7 p-4 md:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {headings[section]}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Trabaja con tus archivos en este equipo. Cada cambio crea una copia
          que puedes descargar y usar como una nueva fuente.
        </p>
      </header>
      {(error || documents.error || history.error) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
        >
          {error || errorMessage(documents.error ?? history.error)}
        </p>
      )}
      {section === "history" ? (
        <section className="divide-y rounded-xl border">
          {history.isLoading && (
            <p className="p-6 text-sm text-muted-foreground">
              Cargando copias…
            </p>
          )}
          {history.data?.length === 0 && (
            <div className="p-8">
              <Files className="mb-3 size-8 text-primary" />
              <p className="font-medium">Tu primera copia empieza en Studio</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Combina archivos, organiza páginas o ajusta un recorte. Aquí
                podrás recuperar el resultado y su origen.
              </p>
            </div>
          )}
          {history.data?.map((operation) => (
            <article
              key={operation.id}
              className="flex flex-wrap items-start justify-between gap-5 p-5"
            >
              <div className="min-w-0">
                <h2 className="break-words font-medium">
                  {operation.output_name}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {operation.page_count} páginas ·{" "}
                  {(operation.file_size / 1024 / 1024).toFixed(2)} MB ·{" "}
                  {new Date(operation.created_at).toLocaleString("es-CO")}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {operation.kind === "merge"
                    ? "Combinado"
                    : operation.kind === "pages"
                      ? "Páginas organizadas"
                      : "Recorte / rotación"}{" "}
                  · {operation.sources.length} archivos de origen
                </p>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-primary">
                    Ver páginas de origen
                  </summary>
                  <div className="mt-2 space-y-2">
                    {operation.sources.map((source, index) => (
                      <p
                        key={`${source.document_id}-${index}`}
                        className="max-w-xl break-words text-xs text-muted-foreground"
                      >
                        {available.find(
                          (item) => item.id === source.document_id,
                        )?.title ?? "Original retirado de la biblioteca"}
                        : páginas {source.pages.join(", ")}
                        {source.rotation ? ` · giro ${source.rotation}°` : ""}
                      </p>
                    ))}
                  </div>
                </details>
              </div>
              <div className="flex flex-wrap gap-2">
                {operation.workspace_id && (
                  <Button asChild variant="outline">
                    <a href={`/workspaces/${operation.workspace_id}`}>
                      Abrir workspace
                    </a>
                  </Button>
                )}
                <Button
                  disabled={!operation.output_document_id}
                  onClick={() =>
                    operation.output_document_id &&
                    void downloadCopy(
                      operation.output_document_id,
                      operation.output_name,
                    ).catch((value) => toast.error(errorMessage(value)))
                  }
                >
                  <Download className="size-4" />
                  {operation.output_document_id
                    ? "Descargar copia"
                    : "Copia eliminada"}
                </Button>
              </div>
            </article>
          ))}
          <div className="flex items-center justify-end gap-3 p-4">
            <span className="mr-auto text-xs text-muted-foreground">
              Página {historyPage + 1}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={historyPage === 0}
              onClick={() => setHistoryPage((value) => value - 1)}
            >
              Anterior
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={(history.data?.length ?? 0) < 30}
              onClick={() => setHistoryPage((value) => value + 1)}
            >
              Siguiente
            </Button>
          </div>
        </section>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(280px,.75fr)_minmax(0,1.25fr)]">
          <section className="space-y-4 rounded-xl border p-5">
            <div className="flex items-center gap-2">
              <Files className="size-5 text-primary" />
              <h2 className="font-semibold">
                {section === "merge" ? "Elige los PDFs" : "Elige tu PDF"}
              </h2>
            </div>
            <Input
              aria-label="Buscar PDF en Studio"
              placeholder="Buscar en tu biblioteca…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="max-h-[430px] space-y-2 overflow-y-auto pr-1">
              {documents.isLoading && (
                <p className="text-sm text-muted-foreground">
                  Cargando biblioteca…
                </p>
              )}
              {available
                .filter((document) =>
                  document.title.toLowerCase().includes(search.toLowerCase()),
                )
                .map((document) => {
                  const selected = sources.findIndex(
                    (source) => source.id === document.id,
                  )
                  return (
                    <button
                      type="button"
                      key={document.id}
                      onClick={() => choose(document)}
                      aria-pressed={selected >= 0}
                      aria-label={`Seleccionar ${document.title}`}
                      className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left hover:bg-muted/40 ${selected >= 0 ? "border-primary bg-primary/5" : ""}`}
                    >
                      <div
                        className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border text-xs ${selected >= 0 ? "border-primary bg-primary text-primary-foreground" : ""}`}
                      >
                        {selected >= 0 ? (
                          section === "merge" ? (
                            selected + 1
                          ) : (
                            <Check className="size-4" />
                          )
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="break-words text-sm font-medium">
                          {document.title}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {document.page_count} páginas ·{" "}
                          {(document.file_size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </button>
                  )
                })}
              {available.length === 0 && (
                <p className="text-sm leading-6 text-muted-foreground">
                  Sube tus PDFs a la biblioteca para comenzar a trabajar en
                  Studio.
                </p>
              )}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Hasta 50 MB entre los originales seleccionados y 500 páginas en la
              copia.
            </p>
          </section>
          <section className="space-y-6 rounded-xl border p-5 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold">
                {section === "merge"
                  ? "Orden de los archivos"
                  : section === "pages"
                    ? "Páginas de la copia"
                    : "Recorte y rotación"}
              </h2>
              <Badge variant="secondary">{totalPages} páginas</Badge>
            </div>
            {sources.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center gap-3 border-y py-8 text-center">
                <FilePlus2 className="size-8 text-primary" />
                <p className="text-sm text-muted-foreground">
                  Selecciona{" "}
                  {section === "merge" ? "tus archivos" : "un archivo"} en la
                  biblioteca para preparar la copia.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {sources.map((source, index) => {
                  const document = available.find(
                    (item) => item.id === source.id,
                  )
                  return (
                    <div
                      key={source.id}
                      className="space-y-3 rounded-lg bg-muted/40 p-4"
                    >
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 break-words text-sm font-medium">
                          {section === "merge" && `${index + 1}. `}
                          {document?.title}
                        </span>
                        {section === "merge" && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Subir archivo ${index + 1}`}
                              disabled={index === 0}
                              onClick={() => move(index, -1)}
                            >
                              <ArrowUp className="size-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Bajar archivo ${index + 1}`}
                              disabled={index === sources.length - 1}
                              onClick={() => move(index, 1)}
                            >
                              <ArrowDown className="size-4" />
                            </Button>
                          </>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Retirar archivo de la copia"
                          onClick={() =>
                            setSources((value) =>
                              value.filter((item) => item.id !== source.id),
                            )
                          }
                        >
                          <X className="size-4" />
                        </Button>
                      </div>
                      <div>
                        <Label htmlFor={`studio-pages-${source.id}`}>
                          Páginas, en el orden que quieras
                        </Label>
                        <Input
                          id={`studio-pages-${source.id}`}
                          aria-label={`Páginas de ${document?.title}`}
                          className="mt-2"
                          placeholder={`Todas (${document?.page_count ?? 0}). Ejemplo: 3, 1-2`}
                          value={source.pages}
                          onChange={(event) =>
                            setSources((value) =>
                              value.map((item) =>
                                item.id === source.id
                                  ? { ...item, pages: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                  )
                })}
                <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                  <Scissors className="mt-0.5 size-4 shrink-0" />
                  Incluye solo las páginas que deseas conservar. El campo vacío
                  conserva todas; cambia el orden con una lista como 3, 1-2.
                </p>
              </div>
            )}
            {current && section !== "merge" && (
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_160px]">
                <StudioPreview
                  documentId={current.id}
                  title={current.title}
                  pageNumber={previewPage}
                />
                <div className="space-y-3">
                  <Label htmlFor="studio-preview-page">
                    Ver página original
                  </Label>
                  <Input
                    id="studio-preview-page"
                    type="number"
                    min="1"
                    max={current.page_count}
                    value={previewPage}
                    onChange={(event) =>
                      setPreviewPage(
                        Math.max(
                          1,
                          Math.min(
                            current.page_count,
                            Number(event.target.value) || 1,
                          ),
                        ),
                      )
                    }
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    Vista del original antes de aplicar cambios. La copia
                    conserva el contenido del PDF.
                  </p>
                </div>
              </div>
            )}
            {section === "transform" && (
              <div className="space-y-4 border-t pt-5">
                <div className="max-w-xs">
                  <Label className="mb-2 block">
                    Girar las páginas seleccionadas
                  </Label>
                  <ChoiceSelect
                    label="Rotación de Studio"
                    placeholder="Sin giro"
                    value={rotation}
                    onValueChange={setRotation}
                    options={[
                      { value: "0", label: "Sin giro" },
                      { value: "90", label: "90° hacia la derecha" },
                      { value: "180", label: "180°" },
                      { value: "270", label: "90° hacia la izquierda" },
                    ]}
                  />
                </div>
                <div>
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <RotateCw className="size-4" />
                    Quitar márgenes
                  </h3>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Porcentaje del ancho o alto de cada página original, antes
                    del giro. El recorte ajusta el área visible; no elimina ni
                    oculta de forma segura el contenido.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(
                      [
                        { key: "left", label: "Izquierdo" },
                        { key: "top", label: "Superior" },
                        { key: "right", label: "Derecho" },
                        { key: "bottom", label: "Inferior" },
                      ] as const
                    ).map((item) => (
                      <div key={item.key}>
                        <Label htmlFor={`margin-${item.key}`}>
                          {item.label} %
                        </Label>
                        <Input
                          id={`margin-${item.key}`}
                          className="mt-2"
                          type="number"
                          min="0"
                          max="99"
                          value={margins[item.key]}
                          onChange={(event) =>
                            setMargins((value) => ({
                              ...value,
                              [item.key]: event.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="grid gap-4 border-t pt-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="studio-name">Nombre de la copia</Label>
                <Input
                  id="studio-name"
                  className="mt-2"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={240}
                />
              </div>
              <div>
                <Label className="mb-2 block">
                  Guardar también en un workspace
                </Label>
                <ChoiceSelect
                  label="Destino de la copia"
                  placeholder="Mi biblioteca"
                  value={workspace}
                  onValueChange={setWorkspace}
                  options={[
                    { value: "library", label: "Solo mi biblioteca" },
                    ...(workspaces.data ?? []).map((item) => ({
                      value: item.id,
                      label: item.name,
                    })),
                  ]}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                Los originales se conservan. La copia empieza sin permisos de
                nube y sin un índice vectorial; su texto se prepara
                automáticamente.
              </p>
              <Button
                disabled={create.isPending || sources.length === 0}
                onClick={save}
              >
                {create.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FilePlus2 className="size-4" />
                )}
                {create.isPending ? "Creando copia…" : "Crear copia"}
              </Button>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Studio edita páginas. La copia no conserva firmas digitales
              válidas ni promete reconstruir marcadores o enlaces entre páginas.
            </p>
          </section>
        </div>
      )}
      {result && (
        <section
          aria-live="polite"
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5"
        >
          <div>
            <h2 className="break-words font-medium">{result.document.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {result.document.page_count} páginas ·{" "}
              {resultJob?.state === "FAILED"
                ? "No se pudo extraer el texto; puedes descargar la copia"
                : resultJob?.state === "CANCELLED"
                  ? "Extracción cancelada; puedes descargar o reprocesar la copia"
                  : savedDocument.data?.status === "DEGRADED"
                    ? "Extracción parcial; revisa la advertencia en tu biblioteca"
                    : ["EXTRACTED", "READY"].includes(
                          savedDocument.data?.status ?? "",
                        )
                      ? "Texto disponible para consultar"
                      : "Preparando el texto para investigar"}
            </p>
            {(resultJob?.error_message || savedDocument.data?.warning) && (
              <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                {resultJob?.error_message ?? savedDocument.data?.warning}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {result.operation.workspace_id && (
              <Button asChild variant="outline">
                <a href={`/workspaces/${result.operation.workspace_id}`}>
                  Abrir workspace
                </a>
              </Button>
            )}
            <Button
              onClick={() =>
                void downloadCopy(
                  result.document.id,
                  result.document.original_filename,
                ).catch((value) => toast.error(errorMessage(value)))
              }
            >
              <Download className="size-4" />
              Descargar copia
            </Button>
          </div>
        </section>
      )}
    </main>
  )
}
