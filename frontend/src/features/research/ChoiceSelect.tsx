import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

export type ChoiceOption = { value: string; label: string; disabled?: boolean }

type Props = {
  label: string
  placeholder: string
  value: string
  onValueChange: (value: string) => void
  options?: ChoiceOption[]
  groups?: { label: string; options: ChoiceOption[] }[]
  disabled?: boolean
  size?: "sm" | "default"
  className?: string
}

/** One accessible select presentation for all research forms. */
export function ChoiceSelect({
  label,
  placeholder,
  value,
  onValueChange,
  options = [],
  groups,
  disabled,
  size = "default",
  className,
}: Props) {
  const sections = groups ?? [{ label: "", options }]
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        size={size}
        className={cn("w-full min-w-0 bg-background text-sm", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent
        align="start"
        className="max-w-[min(28rem,calc(100vw-2rem))]"
      >
        {sections.map((section) => (
          <SelectGroup key={section.label}>
            {section.label && <SelectLabel>{section.label}</SelectLabel>}
            {section.options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                data-value={option.value}
                disabled={option.disabled}
                className="break-words whitespace-normal"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
