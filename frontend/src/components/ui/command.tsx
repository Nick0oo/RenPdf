import { Command as CommandPrimitive } from "cmdk"
import { Search } from "lucide-react"
import type * as React from "react"
import { cn } from "@/lib/utils"

export function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) { return <CommandPrimitive className={cn("flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground", className)} {...props} /> }
export function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) { return <div className="flex items-center gap-3 border-b px-4"><Search className="size-4 shrink-0 text-muted-foreground" /><CommandPrimitive.Input className={cn("h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground", className)} {...props} /></div> }
export function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) { return <CommandPrimitive.List className={cn("max-h-80 overflow-y-auto overscroll-contain p-2", className)} {...props} /> }
export function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) { return <CommandPrimitive.Empty className="px-4 py-8 text-center text-sm text-muted-foreground" {...props} /> }
export function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) { return <CommandPrimitive.Group className={cn("overflow-hidden [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground", className)} {...props} /> }
export function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) { return <CommandPrimitive.Item className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none data-[selected=true]:bg-accent data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-40", className)} {...props} /> }
