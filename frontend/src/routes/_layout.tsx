import {
  createFileRoute,
  Outlet,
  redirect,
  useRouterState,
} from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"
import AppSidebar from "@/components/Sidebar/AppSidebar"
import { navigationTitle } from "@/components/Sidebar/navigation"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { isLoggedIn } from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async () => {
    if (!isLoggedIn()) throw redirect({ to: "/login" })
  },
})
function Layout() {
  const path = useRouterState({ select: (state) => state.location.pathname })
  const isWorkspace = path.startsWith("/workspaces/")
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "13.5rem",
          "--sidebar-width-icon": "3.5rem",
        } as React.CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <header
          className={cn(
            "flex shrink-0 items-center gap-3 border-b bg-background px-4 md:px-6",
            isWorkspace ? "h-9" : "h-12",
          )}
        >
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
          <span className="h-4 border-l" />
          <span className="text-xs text-muted-foreground">RenPdf</span>
          <ChevronRight size={12} className="text-muted-foreground" />
          <span className="text-xs font-medium">{navigationTitle(path)}</span>
        </header>
        <main className="min-h-0 flex-1 overflow-auto bg-muted/[0.18]">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
