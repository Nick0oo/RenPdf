import { createFileRoute, redirect } from "@tanstack/react-router"
import { LabDesk } from "@/features/lab/LabDesk"
export const Route = createFileRoute("/_layout/lab/$section")({
  beforeLoad: ({ params }) => {
    if (!["compare", "questions", "summaries"].includes(params.section))
      throw redirect({ to: "/lab/$section", params: { section: "compare" } })
  },
  component: Page,
})
function Page() {
  const { section } = Route.useParams()
  return (
    <div className="mx-auto max-w-6xl px-5 py-7 md:px-9">
      <LabDesk
        key={section}
        section={section as "compare" | "questions" | "summaries"}
      />
    </div>
  )
}
