import { BookOpen, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

const ErrorComponent = () => {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-foreground"
      data-testid="error-component"
    >
      <div className="max-w-md space-y-3 text-center">
        <p className="text-sm font-medium text-primary">RenPdf</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          No pudimos abrir esta pantalla
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Recarga la aplicación para volver a intentarlo. También puedes abrir
          la biblioteca y elegir otro documento.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => window.location.reload()}>
          <RefreshCw size={16} /> Recargar aplicación
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            try {
              localStorage.removeItem("renpdf_workspace")
            } catch {
              // Navigation still works when the browser disables local storage.
            }
            window.location.assign("/library")
          }}
        >
          <BookOpen size={16} /> Abrir biblioteca
        </Button>
      </div>
    </div>
  )
}

export default ErrorComponent
