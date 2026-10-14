import { useId } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  label: string
  placeholder?: string
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  submitLabel: string
  pending?: boolean
}

export function NameDialog({
  open,
  onOpenChange,
  title,
  label,
  placeholder,
  value,
  onValueChange,
  onSubmit,
  submitLabel,
  pending,
}: Props) {
  const id = useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Usa un nombre que puedas reconocer en tu biblioteca.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (value.trim() && !pending) onSubmit()
          }}
          className="space-y-5"
        >
          <div className="space-y-2">
            <Label htmlFor={id}>{label}</Label>
            <Input
              id={id}
              autoFocus
              placeholder={placeholder}
              value={value}
              maxLength={120}
              onChange={(event) => onValueChange(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button disabled={!value.trim() || pending}>
              {pending ? "Guardando…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
