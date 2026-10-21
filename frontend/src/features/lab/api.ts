import axios from "axios"
import type { EvidencePublic } from "@/client"
import { sourceLocation } from "@/features/media/location"
import { apiRoot } from "@/features/research/api"

export async function learningRequest<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const response = await axios.request<T>({
    url: `${apiRoot}/learning${path}`,
    method,
    data: body,
    withCredentials: true,
    timeout: path === "/generate" ? 180000 : 30000,
  })
  if (
    !String(response.headers["content-type"] ?? "").includes(
      "application/json",
    ) ||
    response.data === null ||
    typeof response.data !== "object"
  ) {
    const error = new Error(
      "El servidor devolvió una respuesta inesperada para Laboratorio o Estudio. Comprueba que la API y la aplicación estén actualizadas.",
    )
    error.name = "ApiContractError"
    throw error
  }
  return response.data
}

export type SourceAnswer = {
  message_id: string
  available: boolean
  content: string
  provider: string | null
  model: string | null
  citations: EvidencePublic[]
  usage?: Record<string, unknown>
}
export type ResearchEntry = {
  id: string
  workspace_id: string
  kind: "question" | "summary" | "comparison"
  title: string
  question: string
  notes: string
  document_ids: string[]
  created_at: string
  answers: SourceAnswer[]
}
export type Deck = {
  id: string
  workspace_id: string
  name: string
  description: string
  created_at: string
  cards: number
  due_cards: number
  reviews: number
}
export type Card = {
  id: string
  deck_id: string
  question: string
  answer: string
  document_id: string | null
  version_id: string | null
  page_number: number
  source_message_id: string | null
  citation_label: number | null
  created_at: string
  due_at: string
  review_count: number
  source_title: string | null
  source_available: boolean
  evidence: EvidencePublic | null
  evidences?: EvidencePublic[]
}
export type GenerationKind = "summary" | "questions" | "deck"
export type Generation = {
  kind: GenerationKind
  conversation_id: string
  message_id: string
  research: ResearchEntry[]
  deck: Deck | null
  cards: Card[]
  coverage: Record<string, unknown>
}
export type Review = {
  id: string
  card_id: string
  rating: string
  response: string
  created_at: string
  next_due_at: string
}
export type Progress = {
  cards: number
  due_cards: number
  reviewed_cards: number
  reviews: number
  ratings: Record<string, number>
  assessment: "self_reported"
}

export function downloadResearch(entry: ResearchEntry) {
  const text = [
    `# ${entry.title}`,
    entry.question,
    entry.notes,
    ...entry.answers.map((answer) =>
      answer.available
        ? `${answer.content}\n\n${answer.citations.map((cite) => `- Fuente ${cite.label}: ${cite.document_title}, ${sourceLocation(cite)}\n  ${cite.text}`).join("\n")}\n\nModelo: ${answer.provider ?? "no reportado"} / ${answer.model ?? "no reportado"}`
        : "La respuesta original ya no está disponible.",
    ),
  ]
    .filter(Boolean)
    .join("\n\n")
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/markdown;charset=utf-8" }),
  )
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = "investigacion.md"
  anchor.click()
  URL.revokeObjectURL(url)
}
