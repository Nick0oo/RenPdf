import type { LucideIcon } from "lucide-react"
import {
  Activity,
  BookOpen,
  Boxes,
  Combine,
  Crop,
  FileOutput,
  FileText,
  FlaskConical,
  FolderOpen,
  GraduationCap,
  History,
  Layers,
  Library,
  Lightbulb,
  ListChecks,
  MessageSquareText,
  Settings2,
  ShieldCheck,
  UserRound,
} from "lucide-react"

export type NavigationItem = { title: string; href: string; icon: LucideIcon }
export type NavigationGroup = {
  id: string
  title: string
  icon: LucideIcon
  items: NavigationItem[]
}

/** Feature modules contribute destinations here; the shell owns navigation only. */
export const navigationGroups: NavigationGroup[] = [
  {
    id: "research",
    title: "Investigación",
    icon: BookOpen,
    items: [
      { title: "Workspaces", href: "/", icon: FolderOpen },
      { title: "Biblioteca", href: "/library", icon: Library },
    ],
  },
  {
    id: "trace",
    title: "Trazabilidad",
    icon: History,
    items: [
      { title: "Actividad", href: "/trace/activity", icon: Activity },
      {
        title: "Respuestas",
        href: "/trace/responses",
        icon: MessageSquareText,
      },
      { title: "Fuentes", href: "/trace/documents", icon: FileText },
      { title: "Permisos", href: "/trace/permissions", icon: ShieldCheck },
    ],
  },
  {
    id: "studio",
    title: "Studio",
    icon: Boxes,
    items: [
      { title: "Combinar", href: "/studio/merge", icon: Combine },
      { title: "Organizar", href: "/studio/pages", icon: FileText },
      { title: "Recortar y rotar", href: "/studio/transform", icon: Crop },
      { title: "Exportar", href: "/studio/history", icon: FileOutput },
    ],
  },
  {
    id: "lab",
    title: "Laboratorio",
    icon: FlaskConical,
    items: [
      { title: "Comparar fuentes", href: "/lab/compare", icon: Combine },
      { title: "Preguntas", href: "/lab/questions", icon: Lightbulb },
      { title: "Resúmenes", href: "/lab/summaries", icon: FileText },
    ],
  },
  {
    id: "study",
    title: "Estudio",
    icon: GraduationCap,
    items: [
      { title: "Fichas con evidencia", href: "/study/cards", icon: FileText },
      { title: "Mazos", href: "/study/decks", icon: Layers },
      { title: "Autoevaluación", href: "/study/review", icon: ListChecks },
    ],
  },
]

export const settingsNavigation: NavigationItem[] = [
  { title: "Configuración", href: "/configuration", icon: Settings2 },
  { title: "Cuenta", href: "/settings", icon: UserRound },
]

export function navigationTitle(pathname: string): string {
  if (pathname.startsWith("/workspaces/")) return "Workspace"
  return (
    [
      ...navigationGroups.flatMap((group) => group.items),
      ...settingsNavigation,
    ].find((item) => item.href === pathname)?.title ?? "RenPdf"
  )
}
