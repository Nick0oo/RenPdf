import { createFileRoute, redirect } from "@tanstack/react-router"
import { StudioDesk } from "@/features/studio/StudioDesk"
export const Route = createFileRoute("/_layout/studio/$section")({
  beforeLoad: ({ params }) => {
    if (!["merge", "pages", "transform", "history"].includes(params.section))
      throw redirect({ to: "/studio/$section", params: { section: "merge" } })
  },
  component: Page,
})
function Page() {
  const { section } = Route.useParams()
  return (
    <div className="px-5 py-7 md:px-9">
      <StudioDesk
        key={section}
        section={section as "merge" | "pages" | "transform" | "history"}
      />
    </div>
  )
}
