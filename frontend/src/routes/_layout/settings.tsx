import { createFileRoute } from "@tanstack/react-router"
import {
  CheckCircle2,
  Monitor,
  Moon,
  ShieldCheck,
  Sun,
  UserRound,
} from "lucide-react"
import { type Theme, useTheme } from "@/components/theme-provider"
import ChangePassword from "@/components/UserSettings/ChangePassword"
import DeleteAccount from "@/components/UserSettings/DeleteAccount"
import UserInformation from "@/components/UserSettings/UserInformation"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import useAuth from "@/hooks/useAuth"
import { getInitials } from "@/utils"
export const Route = createFileRoute("/_layout/settings")({
  component: Account,
  head: () => ({ meta: [{ title: "Cuenta - RenPdf" }] }),
})
function Account() {
  const { user } = useAuth()
  const { theme, setTheme } = useTheme()
  if (!user) return null
  return (
    <div className="mx-auto max-w-6xl px-5 py-7 md:px-9">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">Tu cuenta</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Tu identidad en RenPdf, seguridad y preferencias de lectura.
        </p>
      </header>
      <div className="grid gap-10 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="space-y-6">
          <div className="border-b pb-6">
            <Avatar className="mb-4 size-16">
              <AvatarFallback className="bg-primary/10 text-xl text-primary">
                {getInitials(user.full_name || user.email)}
              </AvatarFallback>
            </Avatar>
            <h2 className="text-lg font-semibold">
              {user.full_name || user.email.split("@")[0]}
            </h2>
            <p className="mt-1 break-all text-sm text-muted-foreground">
              {user.email}
            </p>
            <Badge variant="outline" className="mt-4">
              {user.is_superuser ? "Administrador" : "Investigador"}
            </Badge>
          </div>
          <div className="space-y-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-2">
              <CheckCircle2 size={14} className="text-primary" />{" "}
              {user.is_active ? "Cuenta activa" : "Cuenta inactiva"}
            </p>
            <p className="flex items-center gap-2">
              <ShieldCheck size={14} /> Sesión autenticada
            </p>
          </div>
          <nav className="space-y-2 text-sm">
            <a
              href="#account-profile"
              className="block py-1 text-muted-foreground hover:text-primary"
            >
              Perfil
            </a>
            <a
              href="#account-security"
              className="block py-1 text-muted-foreground hover:text-primary"
            >
              Seguridad
            </a>
            <a
              href="#account-appearance"
              className="block py-1 text-muted-foreground hover:text-primary"
            >
              Apariencia
            </a>
          </nav>
        </aside>
        <div className="space-y-8">
          <section
            id="account-profile"
            className="scroll-mt-5 rounded-2xl border bg-background px-6 pb-6"
          >
            <UserInformation />
          </section>
          <section
            id="account-security"
            className="scroll-mt-5 rounded-2xl border bg-background px-6 pb-6"
          >
            <ChangePassword />
          </section>
          <section
            id="account-appearance"
            className="scroll-mt-5 rounded-2xl border bg-background p-6"
          >
            <h2 className="text-lg font-semibold">Apariencia</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Elige el tema de tu escritorio. Se conserva en este navegador.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3">
              {[
                { value: "light", label: "Claro", icon: Sun },
                { value: "dark", label: "Oscuro", icon: Moon },
                { value: "system", label: "Sistema", icon: Monitor },
              ].map((choice) => (
                <Button
                  key={choice.value}
                  variant={theme === choice.value ? "default" : "outline"}
                  className="h-20 flex-col gap-2"
                  aria-pressed={theme === choice.value}
                  onClick={() => setTheme(choice.value as Theme)}
                >
                  <choice.icon size={19} />
                  {choice.label}
                </Button>
              ))}
            </div>
          </section>
          {!user.is_superuser && (
            <section>
              <DeleteAccount />
            </section>
          )}
          <p className="flex items-start gap-2 text-xs leading-6 text-muted-foreground">
            <UserRound size={14} className="mt-1 shrink-0" /> Tus modelos y los
            permisos de documentos se administran desde Configuración y
            Trazabilidad.
          </p>
        </div>
      </div>
    </div>
  )
}
