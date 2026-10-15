import { createFileRoute, redirect } from "@tanstack/react-router"
import { StudyDesk } from "@/features/study/StudyDesk"
export const Route = createFileRoute("/_layout/study/$section")({
  beforeLoad: ({ params }) => {
    if (!["cards", "decks", "review"].includes(params.section))
      throw redirect({
        to: "/study/$section",
        params: { section: "cards" },
        search: { workspace: undefined, deck: undefined },
      })
  },
  validateSearch: (search: Record<string, unknown>) => ({
    workspace:
      typeof search.workspace === "string" ? search.workspace : undefined,
    deck: typeof search.deck === "string" ? search.deck : undefined,
  }),
  component: Page,
})
function Page() {
  const { section } = Route.useParams()
  return (
    <div className="mx-auto max-w-6xl px-5 py-7 md:px-9">
      <StudyDesk
        key={section}
        section={section as "cards" | "decks" | "review"}
      />
    </div>
  )
}
