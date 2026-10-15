import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { apiRoot } from "@/features/research/api"
import type { SourceAnswer } from "./api"

export function SourceAnswers({ answers }: { answers: SourceAnswer[] }) {
  return (
    <div className="space-y-6">
      {answers.map((answer) => (
        <article
          key={answer.message_id}
          className="min-w-0 border-l-2 border-primary/25 pl-4"
        >
          {!answer.available ? (
            <p className="text-sm text-muted-foreground">
              La respuesta original ya no está disponible.
            </p>
          ) : (
            <>
              <div className="max-w-prose space-y-3 break-words text-sm leading-7 [&_li]:ml-5 [&_li]:list-disc [&_p]:my-3">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ alt }) => (
                      <span>{alt || "Imagen externa omitida"}</span>
                    ),
                    a: ({ children }) => (
                      <span className="underline">{children}</span>
                    ),
                    table: ({ children }) => (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left">{children}</table>
                      </div>
                    ),
                  }}
                >
                  {answer.content}
                </ReactMarkdown>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {answer.model || "Modelo no reportado"}
              </p>
              {!answer.citations.length && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Las fuentes citadas por esta respuesta ya no están
                  disponibles.
                </p>
              )}
              <div className="mt-3 space-y-2">
                {answer.citations.map((citation) => (
                  <details
                    key={`${citation.chunk_id}:${citation.element_id}`}
                    className="rounded-lg border px-3 py-2 text-xs"
                  >
                    <summary className="cursor-pointer leading-5">
                      Fuente {citation.label}: {citation.document_title}, página{" "}
                      {citation.page_number}
                    </summary>
                    <blockquote className="my-3 whitespace-pre-wrap border-l-2 pl-3 leading-6 text-muted-foreground">
                      {citation.text}
                    </blockquote>
                    <a
                      className="font-medium text-primary underline underline-offset-4"
                      target="_blank"
                      rel="noreferrer"
                      href={`${apiRoot}/documents/${citation.document_id}/file#page=${citation.page_number}`}
                    >
                      Abrir página original
                    </a>
                  </details>
                ))}
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  )
}
