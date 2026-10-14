import { Link } from "@tanstack/react-router"
import { FileText } from "lucide-react"

import { cn } from "@/lib/utils"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
}

export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  const content = (
    <span
      role="img"
      aria-label="RenPdf"
      className={cn(
        "inline-flex items-center gap-2 font-semibold tracking-tight",
        variant === "icon" ? "size-5" : "h-6 text-xl",
        className,
      )}
    >
      <FileText aria-hidden="true" className="size-[1em] shrink-0" />
      {variant !== "icon" && (
        <span
          className={cn(
            variant === "responsive" && "group-data-[collapsible=icon]:hidden",
          )}
        >
          RenPdf
        </span>
      )}
    </span>
  )

  if (!asLink) {
    return content
  }

  return <Link to="/">{content}</Link>
}
