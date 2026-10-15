import { createFileRoute } from "@tanstack/react-router"
import { ResearchDesk } from "@/features/research/ResearchDesk"
export const Route = createFileRoute("/_layout/library")({
  component: ResearchDesk,
  head: () => ({ meta: [{ title: "Biblioteca - RenPdf" }] }),
})
