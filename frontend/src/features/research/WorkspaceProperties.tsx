import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import type { ProviderConfig, WorkspacePublic } from "@/client"
import { WorkspacesService } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ModelSettings } from "@/features/models/ModelSettings"
import { errorMessage } from "./api"

export function WorkspaceProperties({
  workspace,
  providers,
  open,
  onOpenChange,
}: {
  workspace: WorkspacePublic
  providers: ProviderConfig[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const cache = useQueryClient()
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description)
  const update = useMutation({
    mutationFn: () =>
      WorkspacesService.updateWorkspace({
        path: { workspace_id: workspace.id },
        body: { name: name.trim(), description: description.trim() },
      }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["workspaces"] })
      toast.success("Workspace actualizado")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b p-6">
          <SheetTitle>Configuración del workspace</SheetTitle>
          <SheetDescription>
            Nombre, propósito y modelos de esta investigación.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-6">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              update.mutate()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="workspace-name">Nombre del workspace</Label>
              <Input
                id="workspace-name"
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="workspace-description">
                Propósito de la investigación
              </Label>
              <textarea
                id="workspace-description"
                value={description}
                maxLength={2000}
                rows={3}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Qué estás investigando y qué quieres entender…"
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              />
            </div>
            <Button disabled={!name.trim() || update.isPending}>
              Guardar workspace
            </Button>
          </form>
          <div className="border-t pt-6">
            <ModelSettings
              open={open}
              onOpenChange={() => undefined}
              providers={providers}
              workspaceId={workspace.id}
              inline
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
