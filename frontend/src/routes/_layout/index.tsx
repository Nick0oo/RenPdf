import { createFileRoute } from "@tanstack/react-router"
import { WorkspacesOverview } from "@/features/research/WorkspacesOverview"
export const Route = createFileRoute("/_layout/")({
  component: WorkspacesOverview,
  head: () => ({ meta: [{ title: "Workspaces - RenPdf" }] }),
})
