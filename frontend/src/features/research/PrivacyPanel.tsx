import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldCheck } from "lucide-react"
import type { ConsentInput, DocumentPublic } from "@/client"
import { DocumentsService } from "@/client"
import { Button } from "@/components/ui/button"
import { sourceType } from "@/features/media/location"
import { errorMessage, type ProviderName } from "./api"

const scopes = {
  embeddings: "Creación de embeddings de la fuente",
  multimodal_embeddings:
    "Texto, imágenes, audio o video para embeddings multimodales",
  media_analysis: "Segmentos de audio o video para transcripción y análisis",
  chat: "Fragmentos y segmentos recuperados para el chat",
  vision: "Imágenes de regiones para análisis visual",
  original_pdf: "Archivo PDF completo",
} as const

export function PrivacyPanel({
  document,
  provider,
}: {
  document: DocumentPublic
  provider: ProviderName
}) {
  const cache = useQueryClient()
  const consents = useQuery({
    queryKey: ["consents", document.id],
    queryFn: async () =>
      (await DocumentsService.consents({ path: { document_id: document.id } }))
        .data,
  })
  const grant = useMutation({
    mutationFn: (scope: ConsentInput["scope"]) =>
      DocumentsService.grantConsent({
        path: { document_id: document.id },
        body: { provider, scope, expires_in_days: 30 },
      }),
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: ["consents", document.id] }),
  })
  const revoke = useMutation({
    mutationFn: (id: string) =>
      DocumentsService.revokeConsent({
        path: { document_id: document.id, consent_id: id },
      }),
    onSuccess: () =>
      cache.invalidateQueries({ queryKey: ["consents", document.id] }),
  })
  return (
    <div className="space-y-3 rounded-xl border p-4 text-sm">
      <h3 className="flex items-center gap-2 font-medium">
        <ShieldCheck size={16} /> Autorizar envíos a {provider}
      </h3>
      <p className="text-xs text-muted-foreground">
        Documento: {document.title}. Cada autorización dura 30 días y cubre
        solamente este propósito. Revocar impide envíos futuros; no recupera
        datos ya enviados.
      </p>
      {Object.entries(scopes)
        .filter(([scope]) =>
          sourceType(document) === "spreadsheet"
            ? ["embeddings", "chat"].includes(scope)
            : sourceType(document) === "pdf"
              ? scope !== "media_analysis"
              : !["vision", "original_pdf"].includes(scope),
        )
        .map(([scope, title]) => {
          const active =
            consents.data?.filter(
              (row) =>
                row.provider === provider &&
                row.scope === scope &&
                !row.revoked_at &&
                new Date(row.expires_at) > new Date(),
            ) ?? []
          return (
            <div
              key={scope}
              className="flex items-center justify-between gap-3"
            >
              <span className="text-xs">{title}</span>
              {active.length ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={revoke.isPending}
                  onClick={() => {
                    for (const row of active) revoke.mutate(row.id)
                  }}
                >
                  Revocar
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={grant.isPending}
                  onClick={() => grant.mutate(scope as ConsentInput["scope"])}
                >
                  Autorizar
                </Button>
              )}
            </div>
          )
        })}
      {(grant.error || revoke.error) && (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage(grant.error || revoke.error)}
        </p>
      )}
    </div>
  )
}
