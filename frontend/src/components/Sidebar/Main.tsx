import { Link, useRouterState } from "@tanstack/react-router"
import { ChevronDown } from "lucide-react"
import { useState } from "react"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { type NavigationGroup, settingsNavigation } from "./navigation"

export function Main({ groups }: { groups: NavigationGroup[] }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const path = useRouterState({ select: (state) => state.location.pathname })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    research: true,
  })
  const close = () => {
    if (isMobile) setOpenMobile(false)
  }
  return (
    <div className="flex flex-col gap-1 py-2">
      {groups.map((group) => {
        const active =
          group.items.some((item) => path === item.href) ||
          (group.id === "research" && path.startsWith("/workspaces/"))
        return (
          <SidebarGroup key={group.id} className="px-2 py-1">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={group.title}
                  className={`h-9 text-xs font-semibold ${active ? "text-primary" : "text-muted-foreground"}`}
                  onClick={() =>
                    setExpanded((state) => ({
                      ...state,
                      [group.id]: !state[group.id],
                    }))
                  }
                  aria-expanded={expanded[group.id] ?? active}
                >
                  <group.icon className="size-4" />
                  <span>{group.title}</span>
                  <ChevronDown
                    className={`ml-auto size-3.5 transition-transform ${(expanded[group.id] ?? active) ? "" : "-rotate-90"}`}
                  />
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            {(expanded[group.id] ?? active) && (
              <SidebarGroupContent className="pl-3 group-data-[collapsible=icon]:pl-0">
                <SidebarMenu className="border-l border-sidebar-border pl-3 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:pl-0">
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        tooltip={item.title}
                        isActive={
                          path === item.href ||
                          (item.href === "/" && path.startsWith("/workspaces/"))
                        }
                        className="h-8 font-normal"
                      >
                        <Link
                          to={item.href}
                          aria-label={item.title}
                          onClick={close}
                        >
                          <item.icon className="size-3.5" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )
      })}
      <SidebarGroup className="mt-2 border-t border-sidebar-border px-2 pt-3">
        <SidebarMenu>
          {settingsNavigation.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={path === item.href}
                className="h-10"
              >
                <Link to={item.href} aria-label={item.title} onClick={close}>
                  <item.icon className="size-4" />
                  <span>{item.title}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroup>
    </div>
  )
}
