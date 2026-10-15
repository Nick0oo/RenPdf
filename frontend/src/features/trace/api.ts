import axios from "axios"
import type { DocumentPublic, MessagePublic, WorkspacePublic } from "@/client"
import { apiRoot } from "@/features/research/api"

export async function moduleRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await axios.request<T>({
    url: `${apiRoot}${path}`,
    method: body === undefined ? "GET" : "POST",
    data: body,
    withCredentials: true,
  })
  if (
    !String(response.headers["content-type"] ?? "").includes("application/json")
  ) {
    const error = new Error(
      "La versión del servidor todavía no tiene este módulo. Recarga la aplicación después de actualizar el servidor.",
    )
    error.name = "ApiContractError"
    throw error
  }
  return response.data
}

export type TraceRow = {
  id: string
  kind: "chat" | "job" | "studio"
  title: string
  workspace_id?: string
  document_id?: string
  conversation_id?: string
  state: string
  provider?: string
  model?: string
  mode?: string
  citations?: number
  action?: string
  progress?: number
  stage?: string
  error_code?: string
  usage?: Record<string, unknown>
  created_at: string
}

export type TraceOverview = {
  documents: number
  workspaces: number
  responses: number
  jobs: number
  studio_operations: number
  active_consents: number
}

export type IndexTrace = {
  id: string
  state: string
  active: boolean
  profile: {
    provider: string
    model: string
    model_version: string
    dimensions: number
    modality: string
    fingerprint: string
  }
}

export type DocumentTrace = {
  lineage_total: number
  document: DocumentPublic
  sha256: string
  versions: {
    id: string
    number: number
    state: string
    parser: string
    parser_version: string
    current: boolean
    chunks: number
    figures: number
    indexes: IndexTrace[]
    created_at: string
  }[]
  jobs: {
    id: string
    kind: string
    state: string
    stage: string
    progress: number
  }[]
  lineage: {
    id: string
    kind: string
    output_name: string
    sources: { document_id: string; pages: number[] }[]
  }[]
}

export type PermissionTrace = {
  data: {
    consent: {
      id: string
      document_id: string
      provider: string
      scope: string
      granted_at: string
      expires_at: string
      revoked_at: string | null
    }
    document_title: string
    state: string
  }[]
  total: number
  default_policy: string
}

export type ResponseTrace = {
  conversation_id: string
  workspace_id: string
  message: MessagePublic
}

export type TraceCollection = {
  data: TraceRow[]
  total: number
  offset: number
  limit: number
}
export const traceWorkspaces = () =>
  moduleRequest<WorkspacePublic[]>("/workspaces/")
export const traceDocuments = () =>
  moduleRequest<DocumentPublic[]>("/documents/")
