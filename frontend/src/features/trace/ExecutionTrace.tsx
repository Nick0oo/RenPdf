import { Clock3, Database, FileSearch, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"

type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
const list = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? value.map(object) : []
const text = (value: unknown, fallback = "No registrado") =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback

export function ExecutionTrace({
  value,
  documents = [],
  onDocumentSelect,
}: {
  value: unknown
  documents?: { id: string; title: string }[]
  onDocumentSelect?: (id: string) => void
}) {
  const trace = object(value)
  if (Object.keys(trace).length === 0)
    return (
      <p className="rounded-lg bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
        Esta respuesta es anterior al registro detallado de ejecución. Puedes
        revisar sus citas y los datos que sí guardó el proveedor.
      </p>
    )
  const policy = object(trace.policy)
  const context = object(trace.context)
  const retrieval = object(trace.retrieval)
  const snapshots = list(trace.document_snapshots)
  const sources = list(trace.source_refs ?? trace.sources)
  const profiles = list(retrieval.used_profiles)
  const failures = list(retrieval.semantic_failures)
  const stages = list(trace.stages)
  const stageNames: Record<string, string> = {
    request_started: "Inicio de consulta",
    retrieval_finished: "Evidencia recuperada",
    inference_started: "Inicio de respuesta",
    inference_finished: "Respuesta recibida",
    citations_validated: "Citas validadas",
    finished: "Ejecución terminada",
  }
  const started = trace.started_at ?? trace.started
  const finished = trace.finished_at ?? trace.finished
  return (
    <section className="space-y-4 border-t pt-5">
      <h3 className="flex items-center gap-2 font-medium">
        <Clock3 className="size-4" />
        Ejecución registrada
      </h3>
      <div className="grid gap-3 rounded-lg bg-muted/40 p-4 text-sm sm:grid-cols-2">
        <div>
          <p className="text-muted-foreground">Tiempo total</p>
          <p className="mt-1 font-medium">
            {typeof trace.elapsed_seconds === "number"
              ? `${trace.elapsed_seconds.toFixed(2)} segundos`
              : "No registrado"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Resultado</p>
          <p className="mt-1 font-medium">
            {trace.outcome === "COMPLETE"
              ? "Completado"
              : trace.outcome === "FAILED"
                ? "Falló"
                : text(trace.outcome)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Inicio</p>
          <p className="mt-1 text-xs">
            {typeof started === "string"
              ? new Date(started).toLocaleString("es-CO")
              : "No registrado"}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Fin</p>
          <p className="mt-1 text-xs">
            {typeof finished === "string"
              ? new Date(finished).toLocaleString("es-CO")
              : "No registrado"}
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4" />
          Modelo y alcance
        </h4>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{text(policy.provider)}</Badge>
          <Badge variant="outline">{text(policy.model)}</Badge>
          {typeof trace.is_cloud === "boolean" && (
            <Badge variant="secondary">
              {trace.is_cloud ? "Proveedor de nube" : "Proveedor local"}
            </Badge>
          )}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Límite de respuesta: {text(policy.max_tokens)} tokens · Tiempo máximo:{" "}
          {text(policy.timeout_seconds)} segundos
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          Acceso comprobado:{" "}
          {trace.consent_verified === true
            ? "Sí"
            : trace.consent_verified === false
              ? "No"
              : "No registrado"}{" "}
          · Modelo invocado:{" "}
          {trace.inference_attempted === true
            ? "Sí"
            : trace.inference_attempted === false
              ? "No"
              : "No registrado"}
        </p>
        <p className="break-all text-xs leading-5 text-muted-foreground">
          Versión de instrucciones: {text(trace.prompt_template_version)}
        </p>
      </div>
      <div className="space-y-2">
        <h4 className="flex items-center gap-2 text-sm font-medium">
          <FileSearch className="size-4" />
          Contexto consultado
        </h4>
        <p className="text-sm text-muted-foreground">
          {Array.isArray(trace.document_snapshots)
            ? snapshots.length
            : "No registrado"}{" "}
          documentos ·{" "}
          {text(
            trace.evidence_count ??
              context.source_count ??
              (Array.isArray(trace.sources) ? sources.length : undefined),
            "No registrado",
          )}{" "}
          fragmentos ·{" "}
          {text(context.window_count ?? trace.context_windows, "No registrado")}{" "}
          ventanas de lectura
        </p>
        {sources.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border">
            <div className="divide-y">
              {sources.map((source, index) => (
                <div
                  key={`${text(source.element_id)}-${index}`}
                  className="flex flex-wrap justify-between gap-2 px-3 py-2 text-xs"
                >
                  <span>
                    Fuente {text(source.label, String(index + 1))} · página{" "}
                    {text(source.page_number ?? source.page)}
                    <span className="mt-1 block font-medium">
                      {documents.find(
                        (document) => document.id === source.document_id,
                      )?.title ?? `Documento ${text(source.document_id)}`}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {text(
                      source.char_count ??
                        source.character_count ??
                        source.chars,
                    )}{" "}
                    caracteres
                    {typeof source.document_id === "string" &&
                      onDocumentSelect && (
                        <button
                          type="button"
                          className="mt-1 block text-primary underline underline-offset-2"
                          onClick={() =>
                            onDocumentSelect(source.document_id as string)
                          }
                        >
                          Ver historial de fuente
                        </button>
                      )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {profiles.length > 0 && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Database className="size-4" />
            Perfiles usados para buscar
          </h4>
          {profiles.map((profile, index) => (
            <p
              key={`${text(profile.fingerprint)}-${index}`}
              className="break-words text-xs leading-5 text-muted-foreground"
            >
              {text(profile.provider)} · {text(profile.model)} ·{" "}
              {text(profile.dimensions)} dimensiones ·{" "}
              {text(profile.modality, "texto")}
            </p>
          ))}
        </div>
      )}
      {stages.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Etapas registradas</h4>
          <ol className="space-y-2 border-l-2 border-primary/20 pl-4">
            {stages.map((stage, index) => (
              <li
                key={text(stage.stage) + index}
                className="flex justify-between gap-3 text-xs"
              >
                <span>
                  {stageNames[text(stage.stage)] ?? text(stage.stage)}
                </span>
                <span className="text-muted-foreground">
                  {text(stage.elapsed_seconds)} s desde el inicio
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {typeof trace.finish_reason === "string" && (
        <p className="text-xs leading-5 text-muted-foreground">
          Finalización reportada por el proveedor:{" "}
          {trace.finish_reason === "length" ||
          trace.finish_reason === "MAX_TOKENS"
            ? "Se alcanzó el límite de respuesta; puede haber quedado incompleta."
            : trace.finish_reason === "stop" || trace.finish_reason === "STOP"
              ? "Respuesta terminada."
              : text(trace.finish_reason)}
        </p>
      )}
      {(failures.length > 0 || typeof trace.error_code === "string") && (
        <div className="rounded-lg border border-destructive/30 p-3 text-sm">
          <p className="font-medium">Incidencias registradas</p>
          {typeof trace.error_code === "string" && (
            <p className="mt-1 text-destructive">{text(trace.error_code)}</p>
          )}
          {failures.map((failure, index) => (
            <p
              key={`${text(failure.code)}-${index}`}
              className="mt-1 text-xs text-muted-foreground"
            >
              Perfil {text(failure.profile_id)} ·{" "}
              {text(failure.code ?? failure.error_code)}
            </p>
          ))}
        </div>
      )}
    </section>
  )
}
