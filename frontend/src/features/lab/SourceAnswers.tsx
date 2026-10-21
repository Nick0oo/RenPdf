import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import type { SourceAnswer } from "./api"
import { LearningTrace } from "./LearningTrace"
import { SourceReferences } from "./SourceReferences"

export function SourceAnswers({
  answers,
  workspaceId,
  showTrace = true,
}: {
  answers: SourceAnswer[]
  workspaceId?: string
  showTrace?: boolean
}) {
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
              <div className="mt-3 space-y-3">
                <SourceReferences
                  citations={answer.citations}
                  workspaceId={workspaceId}
                />
                {showTrace && (
                  <LearningTrace
                    messageId={answer.message_id}
                    usage={answer.usage}
                  />
                )}
              </div>
            </>
          )}
        </article>
      ))}
    </div>
  )
}
