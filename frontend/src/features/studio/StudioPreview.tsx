import { ImageOff, Loader2, RefreshCw } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { apiRoot } from "@/features/research/api"

type Preview = {
  state: "loading" | "ready" | "error"
  url?: string
  message?: string
}

/** Fetches with the session cookie and releases every private object URL. */
export function StudioPreview({
  documentId,
  title,
  pageNumber,
}: {
  documentId: string
  title: string
  pageNumber: number
}) {
  const [attempt, setAttempt] = useState(0)
  const [preview, setPreview] = useState<Preview>({ state: "loading" })
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    setPreview({ state: "loading" })
    async function load() {
      try {
        const response = await fetch(
          `${apiRoot}/studio/documents/${documentId}/pages/${pageNumber}/preview`,
          {
            credentials: "include",
            signal: controller.signal,
            cache: attempt > 0 ? "reload" : "no-store",
          },
        )
        if (response.status === 401)
          throw new Error(
            "La sesión terminó. Vuelve a ingresar para ver esta página.",
          )
        if (response.status === 404)
          throw new Error(
            "Esta página no está disponible. Revisa que el PDF siga en tu biblioteca.",
          )
        if (!response.ok)
          throw new Error(
            "No se pudo preparar la vista previa. Intenta cargarla de nuevo.",
          )
        if (!response.headers.get("content-type")?.startsWith("image/png"))
          throw new Error(
            "La versión del servidor todavía no tiene esta vista previa. Recarga la aplicación después de actualizar el servidor.",
          )
        const blob = await response.blob()
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setPreview({ state: "ready", url: objectUrl })
      } catch (error) {
        if (!controller.signal.aborted)
          setPreview({
            state: "error",
            message:
              error instanceof Error
                ? error.message
                : "No se pudo cargar la vista previa.",
          })
      }
    }
    void load()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [documentId, pageNumber, attempt])
  return (
    <div className="flex min-h-60 items-center justify-center overflow-hidden rounded-lg border bg-muted/30 p-3">
      {preview.state === "loading" && (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="size-4 animate-spin" />
          Preparando vista previa…
        </p>
      )}
      {preview.state === "ready" && (
        <img
          src={preview.url}
          alt={`Vista previa de la página ${pageNumber} de ${title}`}
          className="max-h-72 max-w-full object-contain"
          onError={() =>
            setPreview({
              state: "error",
              message:
                "La imagen de esta página no se pudo mostrar. Intenta cargarla de nuevo.",
            })
          }
        />
      )}
      {preview.state === "error" && (
        <div className="max-w-sm space-y-3 p-4 text-center">
          <ImageOff className="mx-auto size-6 text-muted-foreground" />
          <p role="alert" className="text-sm leading-6 text-muted-foreground">
            {preview.message}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAttempt((value) => value + 1)}
          >
            <RefreshCw className="size-4" />
            Volver a cargar vista previa
          </Button>
        </div>
      )}
    </div>
  )
}
