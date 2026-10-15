import { Logo } from "@/components/Common/Logo"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import { Main } from "./Main"
import { navigationGroups } from "./navigation"
import { User } from "./User"
export function AppSidebar() {
  const { user } = useAuth()
  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="border-b border-sidebar-border px-5 py-5 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
        <Logo variant="responsive" />
        <p className="mt-1 text-[11px] text-muted-foreground group-data-[collapsible=icon]:hidden">
          Escritorio de investigación
        </p>
      </SidebarHeader>
      <SidebarContent>
        <Main groups={navigationGroups} />
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <User user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
export default AppSidebar
