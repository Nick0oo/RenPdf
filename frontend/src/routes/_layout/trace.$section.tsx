import { createFileRoute, redirect } from "@tanstack/react-router"
import { RagDesk } from "@/features/trace/RagDesk"
import { TraceDesk } from "@/features/trace/TraceDesk"
export const Route = createFileRoute("/_layout/trace/$section")({
  beforeLoad: ({ params }) => {
    if (
      !["activity", "responses", "documents", "permissions", "rag"].includes(
        params.section,
      )
    )
      throw redirect({ to: "/trace/$section", params: { section: "activity" } })
  },
  component: Page,
})
function Page() {
  const { section } = Route.useParams()
  return (
    <div className="px-5 py-7 md:px-9">
      {section === "rag" ? (
        <RagDesk />
      ) : (
        <TraceDesk
          key={section}
          section={
            section as "activity" | "responses" | "documents" | "permissions"
          }
        />
      )}
    </div>
  )
}
