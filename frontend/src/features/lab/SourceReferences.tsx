import { Link } from "@tanstack/react-router"
import type { EvidencePublic } from "@/client"
import { sourceLocation, sourceType } from "@/features/media/location"
import { apiRoot } from "@/features/research/api"

export function SourceReferences({
  citations,
  workspaceId,
}: {
  citations: EvidencePublic[]
  workspaceId?: string
}) {
  return (
    <div className="space-y-2">
      {citations.map((citation, index) => (
        <details
          key={`${citation.chunk_id}:${citation.element_id}:${index}`}
          className="rounded-lg border bg-background px-3 py-2 text-xs"
        >
          <summary className="cursor-pointer leading-5">
            Fuente {citation.label ?? index + 1} · {citation.document_title} ·{" "}
            {sourceLocation(citation)}
          </summary>
          {citation.text && (
            <blockquote className="my-3 whitespace-pre-wrap border-l-2 pl-3 leading-6 text-muted-foreground">
              {citation.text}
            </blockquote>
          )}
          {workspaceId ? (
            <Link
              className="mt-2 inline-block font-medium text-primary underline underline-offset-4"
              to="/workspaces/$workspaceId"
              params={{ workspaceId }}
              search={{
                document: citation.document_id,
                page: citation.page_number ?? undefined,
                time: citation.start_seconds ?? undefined,
                sheet: citation.sheet_name ?? undefined,
                cell: citation.cell_range ?? undefined,
              }}
            >
              Abrir fuente en el workspace
            </Link>
          ) : sourceType(citation) === "pdf" && citation.page_number ? (
            <a
              className="mt-2 inline-block font-medium text-primary underline underline-offset-4"
              target="_blank"
              rel="noreferrer"
              href={`${apiRoot}/documents/${citation.document_id}/file#page=${citation.page_number}`}
            >
              Abrir página original
            </a>
          ) : (
            <p className="mt-2 text-muted-foreground">
              {sourceLocation(citation)}
            </p>
          )}
        </details>
      ))}
    </div>
  )
}
