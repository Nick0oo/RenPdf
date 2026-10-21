import { Clock3, Database, FileSearch, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { formatTime } from "@/features/media/location"

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
  const ranking = list(retrieval.ranking)
  const coverage = object(trace.document_coverage)
  const visual = object(trace.visual_coverage)
  const extraction = list(trace.extraction_coverage)
  const native = object(trace.native_media)
  const clips = list(native.clips)
  const providerFailure = object(trace.failure)
  const pendingIndexes = Array.isArray(trace.indexes_pending)
    ? trace.indexes_pending.filter((id): id is string => typeof id === "string")
    : []
  const stageNames: Record<string, string> = {
    request_started: "Inicio de consulta",
    retrieval_finished: "Evidencia recuperada",
    image_regions_prepared: "Imágenes preparadas para lectura",
    native_clips_prepared: "Segmentos originales preparados para lectura",
    image_region_prepared: "Región visual preparada",
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
            {trace.outcome === "COMPLETE" || trace.outcome === "complete"
              ? "Completado"
              : trace.outcome === "FAILED" || trace.outcome === "failed"
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
          {typeof trace.input_modality === "string" && (
            <Badge variant="secondary">
              {trace.input_modality === "native_media"
                ? "Audio/video original"
                : trace.input_modality === "image_region"
                  ? "Región de imagen"
                  : trace.input_modality === "text"
                    ? "Texto"
                    : trace.input_modality}
            </Badge>
          )}
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
        {(typeof trace.response_mode === "string" ||
          typeof trace.transport_attempts === "number") && (
          <p className="text-xs leading-5 text-muted-foreground">
            Modo de respuesta:{" "}
            {trace.response_mode === "buffered_native"
              ? "Audiovisual completa"
              : trace.response_mode === "stream"
                ? "Por fragmentos"
                : text(trace.response_mode)}{" "}
            · Intentos de transporte: {text(trace.transport_attempts)}
          </p>
        )}
      </div>
      {pendingIndexes.length > 0 && (
        <p className="rounded-lg bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
          Búsqueda textual disponible mientras se preparan índices semánticos:{" "}
          {pendingIndexes
            .map(
              (id) =>
                documents.find((document) => document.id === id)?.title ?? id,
            )
            .join(", ")}
          .
        </p>
      )}
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
                    Fuente {text(source.label, String(index + 1))} ·{" "}
                    {typeof source.sheet_name === "string"
                      ? `${source.sheet_name} · ${text(source.cell_range)}`
                      : typeof source.start_seconds === "number"
                        ? `${formatTime(source.start_seconds)}–${formatTime(typeof source.end_seconds === "number" ? source.end_seconds : null)}`
                        : `p. ${text(source.page_number ?? source.page)}`}
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
      {Object.keys(native).length > 0 && (
        <section
          aria-label="Segmentos nativos enviados al modelo"
          className="space-y-3 rounded-lg border p-3"
        >
          <h4 className="text-sm font-medium">
            Audio y video original consultado
          </h4>
          <p className="text-xs leading-5 text-muted-foreground">
            {clips.length}{" "}
            {clips.length === 1 ? "clip enviado" : "clips enviados"} ·{" "}
            {text(native.bytes, "0")} bytes ·{" "}
            {text(native.duration_seconds, "0")} segundos. Los intervalos
            corresponden a los segmentos originales recuperados.
          </p>
          {typeof native.omitted === "number" && native.omitted > 0 && (
            <p className="text-xs text-muted-foreground">
              {native.omitted}{" "}
              {native.omitted === 1 ? "clip omitido" : "clips omitidos"} por los
              límites de esta consulta.
            </p>
          )}
          {clips.map((clip, index) => (
            <details
              key={`${text(clip.element_id)}-${index}`}
              className="rounded-md bg-muted/40 p-3 text-xs"
            >
              <summary className="cursor-pointer leading-5">
                {documents.find((document) => document.id === clip.document_id)
                  ?.title ??
                  `Fuente ${text(clip.source_id, String(index + 1))}`}{" "}
                · {clip.media === "video" ? "Video" : "Audio"} ·{" "}
                {formatTime(
                  typeof clip.start_seconds === "number"
                    ? clip.start_seconds
                    : null,
                )}
                –
                {formatTime(
                  typeof clip.end_seconds === "number"
                    ? clip.end_seconds
                    : null,
                )}
              </summary>
              <dl className="mt-3 grid gap-2 text-muted-foreground">
                <div>
                  <dt>Formato y tamaño</dt>
                  <dd className="text-foreground">
                    {text(clip.mime_type)} · {text(clip.bytes)} bytes
                  </dd>
                </div>
                <div>
                  <dt>Documento / versión / elemento</dt>
                  <dd className="break-all text-foreground">
                    {text(clip.document_id)} / {text(clip.version_id)} /{" "}
                    {text(clip.element_id)}
                  </dd>
                </div>
                <div>
                  <dt>SHA-256 del clip enviado</dt>
                  <dd className="break-all font-mono text-foreground">
                    {text(clip.clip_sha256)}
                  </dd>
                </div>
              </dl>
              {typeof clip.document_id === "string" && onDocumentSelect && (
                <button
                  type="button"
                  className="mt-3 text-primary underline underline-offset-2"
                  onClick={() => onDocumentSelect(clip.document_id as string)}
                >
                  Ver historial de fuente
                </button>
              )}
            </details>
          ))}
        </section>
      )}
      {Object.keys(coverage).length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border p-3 text-xs">
          <h4 className="font-medium">Cobertura de la consulta</h4>
          <p>
            {text(coverage.with_evidence)}/{text(coverage.selected)} documentos
            aportaron evidencia.
          </p>
          <p>
            {text(visual.sent, "0")}/{text(visual.retrieved, "0")} regiones
            visuales recuperadas se enviaron al modelo.
          </p>
          {typeof visual.omitted === "number" && visual.omitted > 0 && (
            <p>
              Quedaron {visual.omitted} regiones fuera del límite de imágenes de
              esta consulta.
            </p>
          )}
          {Array.isArray(coverage.without_evidence) &&
            coverage.without_evidence.length > 0 && (
              <p>
                Sin evidencia:{" "}
                {coverage.without_evidence
                  .map(
                    (id) =>
                      documents.find((document) => document.id === id)?.title ??
                      String(id),
                  )
                  .join(", ")}
                .
              </p>
            )}
        </div>
      )}
      {extraction.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            Cobertura de extracción al consultar
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            {extraction.map((source) => (
              <p key={text(source.document_id)}>
                {documents.find(
                  (document) => document.id === source.document_id,
                )?.title ?? text(source.document_id)}
                :{" "}
                {source.source_type === "spreadsheet"
                  ? `${text(source.sheets_extracted)}/${text(source.sheets_total)} hojas · ${text(source.cells_with_chunks)}/${text(source.cells_total)} celdas con procedencia · ${text(source.missing_formula_values)} fórmulas sin valor guardado`
                  : source.source_type === "audio" ||
                      source.source_type === "video"
                    ? source.analysis_mode === "native_embeddings"
                      ? `${text(source.segments_prepared)}/${text(source.segments_total)} segmentos preparados para embeddings nativos · ${text(source.segments_analyzed, "0")} transcritos · precisión ${text(source.temporal_precision_seconds)} s`
                      : `${text(source.segments_analyzed)}/${text(source.segments_total)} segmentos analizados · ${text(source.analysis_model)} · precisión ${text(source.temporal_precision_seconds)} s`
                    : `${text(source.pages_extracted)}/${text(source.pages_total)} páginas · ${text(source.figures_total)} figuras · ${text(source.figures_multimodal_indexed)} con embedding visual.`}
              </p>
            ))}
          </div>
        </details>
      )}
      {ranking.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">
            Recuperación y ranking de chunks ({text(retrieval.candidate_count)})
          </summary>
          <p className="my-2 text-muted-foreground">
            {text(retrieval.strategy)} · {text(retrieval.elapsed_seconds)} s ·
            puntuaciones RRF, no porcentajes de certeza.
          </p>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th className="p-2">Posición</th>
                  <th className="p-2">Chunk</th>
                  <th className="p-2">Puntuación</th>
                  <th className="p-2">Selección</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((candidate) => (
                  <tr key={text(candidate.chunk_id)} className="border-t">
                    <td className="p-2">{text(candidate.rank)}</td>
                    <td
                      className="max-w-40 truncate p-2"
                      title={text(candidate.chunk_id)}
                    >
                      {text(candidate.chunk_id)}
                    </td>
                    <td className="p-2">{text(candidate.score)}</td>
                    <td className="p-2">{candidate.selected ? "Sí" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
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
      {(failures.length > 0 ||
        typeof trace.error_code === "string" ||
        Object.keys(providerFailure).length > 0) && (
        <div className="rounded-lg border border-destructive/30 p-3 text-sm">
          <p className="font-medium">Incidencias registradas</p>
          {typeof trace.error_code === "string" && (
            <p className="mt-1 text-destructive">{text(trace.error_code)}</p>
          )}
          {Object.keys(providerFailure).length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Excepción: {text(providerFailure.exception)}
              {typeof providerFailure.http_status === "number" &&
                ` · HTTP: ${providerFailure.http_status}`}
            </p>
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
