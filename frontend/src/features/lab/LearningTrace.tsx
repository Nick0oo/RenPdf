import { useQuery } from "@tanstack/react-query"
import { History } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { errorMessage } from "@/features/research/api"
import { moduleRequest, type ResponseTrace } from "@/features/trace/api"
import { ExecutionTrace } from "@/features/trace/ExecutionTrace"

export function LearningTrace({
  messageId,
  usage,
}: {
  messageId: string
  usage?: Record<string, unknown>
}) {
  const [open, setOpen] = useState(false)
  const trace = useQuery({
    queryKey: ["trace-response", messageId],
    queryFn: () =>
      moduleRequest<ResponseTrace>(`/trace/responses/${messageId}`),
    enabled: open && !usage?.trace,
  })
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <History data-icon="inline-start" />
        Ver trazabilidad
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Cómo se generó este material</DialogTitle>
            <DialogDescription>
              Fuentes recuperadas, modelo, permisos y ejecución de la consulta
              que quedó guardada.
            </DialogDescription>
          </DialogHeader>
          {!usage?.trace && trace.isPending ? (
            <p role="status">Cargando trazabilidad…</p>
          ) : trace.error ? (
            <p role="alert">{errorMessage(trace.error)}</p>
          ) : (
            <ExecutionTrace
              value={usage?.trace ?? trace.data?.message.usage?.trace}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
