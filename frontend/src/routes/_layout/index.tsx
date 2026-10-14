import { createFileRoute } from "@tanstack/react-router"

import { ResearchDesk } from "@/features/research/ResearchDesk"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: "Biblioteca - RenPdf",
      },
    ],
  }),
})

function Dashboard() {
  return <ResearchDesk />
}
