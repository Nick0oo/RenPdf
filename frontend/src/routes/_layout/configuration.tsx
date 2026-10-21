import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { ProvidersService } from "@/client"
import { ModelSettings } from "@/features/models/ModelSettings"
export const Route = createFileRoute("/_layout/configuration")({
  component: Configuration,
})
function Configuration() {
  const providers = useQuery({
    queryKey: ["providers"],
    queryFn: async () => (await ProvidersService.providerCatalog()).data,
    staleTime: 60000,
  })
  return (
    <div className="mx-auto max-w-5xl px-5 py-7 md:px-9">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold">Configuración</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Modelos, capacidades y conexiones de tu escritorio.
        </p>
      </header>
      <section className="rounded-2xl border bg-background p-5 md:p-7">
        <ModelSettings
          open
          onOpenChange={() => undefined}
          providers={providers.data ?? []}
          inline
        />
      </section>
    </div>
  )
}
