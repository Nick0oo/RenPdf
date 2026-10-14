import { AxiosError } from "axios"
import type { ModelSelection } from "@/client"

export const apiRoot = `${import.meta.env.VITE_API_URL ?? ""}/api/v1`
export type ProviderName = ModelSelection["provider"]

export function errorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    const detail = error.response?.data?.detail
    return typeof detail === "string"
      ? detail
      : "No se pudo completar la solicitud."
  }
  return error instanceof Error
    ? error.message
    : "No se pudo completar la solicitud."
}

export function modelValue(provider: string, model: string): string {
  return `${provider}|${model}`
}

export function modelSelection(value: string): ModelSelection {
  const [provider, ...model] = value.split("|")
  return { provider: provider as ProviderName, model: model.join("|") }
}
