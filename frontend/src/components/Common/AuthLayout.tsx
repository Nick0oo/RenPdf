import { BookOpen, FileSpreadsheet, Headphones, Video } from "lucide-react"
import { Appearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import { Footer } from "./Footer"

interface AuthLayoutProps {
  children: React.ReactNode
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="grid min-h-svh bg-background lg:grid-cols-[1.1fr_1fr]">
      <div className="hidden flex-col justify-between border-r bg-sidebar p-12 lg:flex xl:p-16">
        <Logo variant="full" className="h-auto text-2xl" asLink={false} />
        <div className="max-w-lg">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight">
            Tus fuentes tienen mucho que decir.
          </h2>
          <p className="mt-5 max-w-md text-base leading-7 text-muted-foreground">
            Reúne documentos, hojas de cálculo y grabaciones. Haz preguntas y
            vuelve a la evidencia que sostiene cada respuesta.
          </p>
          <div className="mt-8 flex flex-wrap gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <BookOpen size={17} />
              PDF
            </span>
            <span className="flex items-center gap-2">
              <FileSpreadsheet size={17} />
              Excel
            </span>
            <span className="flex items-center gap-2">
              <Headphones size={17} />
              Audio
            </span>
            <span className="flex items-center gap-2">
              <Video size={17} />
              Video
            </span>
          </div>
        </div>
        <p className="max-w-md text-sm leading-6 text-muted-foreground">
          Una biblioteca personal, con control sobre tus fuentes y permisos.
        </p>
      </div>
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-end">
          <Appearance />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <Footer />
      </div>
    </div>
  )
}
