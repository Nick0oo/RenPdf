import type { ProviderConfig, RoutingInput } from "@/client"
import { modelValue } from "@/features/research/api"
import { ChoiceSelect } from "@/features/research/ChoiceSelect"

type Props = {
  providers: ProviderConfig[]
  task: RoutingInput["task"]
  value: string
  onValueChange: (value: string) => void
  label: string
  disabled?: boolean
  size?: "sm" | "default"
  className?: string
}

export function ProviderModelSelect({
  providers,
  task,
  value,
  onValueChange,
  label,
  disabled,
  size,
  className,
}: Props) {
  const groups = providers
    .map((provider) => ({
      label: `${provider.name} · ${provider.is_cloud ? "Nube" : "Local"}`,
      options: (provider.models ?? [])
        .filter((model) =>
          task === "embeddings"
            ? model.capabilities?.embeddings !== "unsupported"
            : task === "vision"
              ? model.capabilities?.vision !== "unsupported" &&
                model.capabilities?.text !== "unsupported"
              : task === "rerank"
                ? model.capabilities?.reranking === "declared"
                : model.capabilities?.text !== "unsupported",
        )
        .map((model) => ({
          value: modelValue(provider.name, model.id),
          label: `${provider.name} · ${model.id}`,
        })),
    }))
    .filter((group) => group.options.length)
  if (
    value &&
    !groups.some((group) =>
      group.options.some((option) => option.value === value),
    )
  )
    groups.unshift({
      label: "Modelo guardado",
      options: [{ value, label: value.replace("|", " · ") }],
    })
  return (
    <ChoiceSelect
      label={label}
      placeholder={
        groups.length ? "Seleccionar modelo…" : "Sin modelo compatible"
      }
      value={value}
      onValueChange={onValueChange}
      groups={groups}
      disabled={disabled || !groups.length}
      size={size}
      className={className}
    />
  )
}
