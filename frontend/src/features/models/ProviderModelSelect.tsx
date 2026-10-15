import { Check, ChevronsUpDown, Cloud, Search, Server } from "lucide-react"
import { useState } from "react"
import type { ProviderConfig, RoutingInput } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { modelValue } from "@/features/research/api"
import { cn } from "@/lib/utils"

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

function capabilityFor(
  task: RoutingInput["task"],
  model: NonNullable<ProviderConfig["models"]>[number],
) {
  return task === "embeddings"
    ? model.capabilities?.embeddings
    : task === "vision"
      ? model.capabilities?.vision
      : task === "rerank"
        ? model.capabilities?.reranking
        : model.capabilities?.text
}

export function ProviderModelSelect({
  providers,
  task,
  value,
  onValueChange,
  label,
  disabled,
  size = "default",
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const selected = value.split("|").slice(1).join("|")
  const groups = providers.map((provider) => ({
    provider,
    models: (provider.models ?? []).filter(
      (model) =>
        capabilityFor(task, model) !== "unsupported" &&
        (task !== "vision" || model.capabilities?.text !== "unsupported"),
    ),
  }))
  const count = groups.reduce((sum, group) => sum + group.models.length, 0)
  const savedMissing =
    value &&
    !groups.some((group) =>
      group.models.some(
        (model) => modelValue(group.provider.name, model.id) === value,
      ),
    )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          size={size}
          disabled={disabled || (!count && !savedMissing)}
          className={cn(
            "w-full min-w-0 justify-between gap-3 bg-background font-normal",
            className,
          )}
        >
          <span className="min-w-0 truncate">
            {selected || "Elegir modelo"}
          </span>
          <ChevronsUpDown
            size={14}
            className="shrink-0 text-muted-foreground"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(30rem,calc(100vw-2rem))] p-0">
        <Command label={`Buscar en ${label}`} loop>
          <CommandInput
            placeholder="Buscar modelo o proveedor…"
            aria-label={`Buscar en ${label}`}
          />
          <div className="flex items-center justify-between border-b px-4 py-2 text-[11px] text-muted-foreground">
            <span>{count} modelos compatibles con la tarea</span>
            <Search size={12} />
          </div>
          <CommandList>
            <CommandEmpty>No hay modelos con esa búsqueda.</CommandEmpty>
            {savedMissing && (
              <CommandGroup heading="Modelo guardado">
                <CommandItem
                  value={value}
                  aria-label={value.replace("|", " · ")}
                  onSelect={() => setOpen(false)}
                >
                  <Check size={14} />
                  <span>{selected}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    No está en el catálogo actual
                  </span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map(
              ({ provider, models }) =>
                models.length > 0 && (
                  <CommandGroup
                    key={provider.name}
                    heading={`${provider.name} · ${provider.is_cloud ? "Nube" : "Local"}`}
                  >
                    <div className="space-y-0.5">
                      {models.map((model) => {
                        const choice = modelValue(provider.name, model.id)
                        const capability = capabilityFor(task, model)
                        return (
                          <CommandItem
                            key={choice}
                            value={choice}
                            keywords={[
                              model.id,
                              provider.name,
                              provider.is_cloud ? "nube" : "local",
                            ]}
                            aria-label={`${provider.name} · ${model.id}`}
                            data-value={choice}
                            onSelect={() => {
                              onValueChange(choice)
                              setOpen(false)
                            }}
                          >
                            {provider.is_cloud ? (
                              <Cloud
                                size={15}
                                className="shrink-0 text-muted-foreground"
                              />
                            ) : (
                              <Server
                                size={15}
                                className="shrink-0 text-muted-foreground"
                              />
                            )}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm">
                                {model.id}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                {capability === "verified"
                                  ? "Capacidad verificada"
                                  : capability === "declared"
                                    ? "Capacidad declarada"
                                    : "Capacidad por verificar"}
                                {model.capabilities?.vision === "verified" ||
                                model.capabilities?.vision === "declared"
                                  ? " · Visión"
                                  : ""}
                              </span>
                            </span>
                            {value === choice && (
                              <Check
                                size={15}
                                className="shrink-0 text-primary"
                              />
                            )}
                          </CommandItem>
                        )
                      })}
                    </div>
                  </CommandGroup>
                ),
            )}
          </CommandList>
          <p className="border-t px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
            Se excluyen capacidades incompatibles con esta tarea. Los modelos
            por verificar conservan su estado; elegirlos no confirma su
            funcionamiento.
          </p>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
