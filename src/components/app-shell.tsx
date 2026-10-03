"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  Target,
  Sparkles,
  Settings,
  UserCog,
  Users,
  Tags,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/app/actions/auth";

// NOTA (navegação): "Conexões" saiu do menu top-level e virou uma aba
// dentro de "Configurações" (/configuracoes?tab=conexoes) — a rota
// /conexoes continua existindo e funcionando (não foi removida), só não
// tem mais item próprio no menu. "Perfil" continua com item próprio
// porque é destino frequente (renda, contas); ele também aparece como
// aba dentro de Configurações, reaproveitando o mesmo componente.
const NAV = [
  { href: "/", label: "Painel", icon: LayoutDashboard },
  { href: "/transacoes", label: "Transações", icon: ArrowLeftRight },
  { href: "/destinatarios", label: "Destinatários", icon: Users },
  { href: "/categorias", label: "Categorias", icon: Tags },
  { href: "/orcamento", label: "Orçamento", icon: Wallet },
  { href: "/metas", label: "Metas", icon: Target },
  { href: "/gestor", label: "Gestor (IA)", icon: Sparkles },
  { href: "/perfil", label: "Perfil", icon: UserCog },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function AppShell({
  children,
  userName,
}: {
  children: React.ReactNode;
  userName: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const navContent = (
    <nav className="flex flex-1 flex-col gap-1 px-3">
      {NAV.map((item) => {
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-muted/30">
      {/* Sidebar desktop */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-card md:flex">
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Wallet className="h-5 w-5" />
          </div>
          <span className="font-bold">Gestor 360</span>
        </div>
        <div className="flex flex-1 flex-col py-4">{navContent}</div>
        <div className="border-t p-3">
          <div className="mb-2 px-3 text-xs text-muted-foreground">
            {userName}
          </div>
          <form action={signOut}>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 text-muted-foreground"
              type="submit"
            >
              <LogOut className="h-5 w-5" />
              Sair
            </Button>
          </form>
        </div>
      </aside>

      {/* Sidebar mobile (drawer) */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col border-r bg-card">
            <div className="flex h-16 items-center justify-between border-b px-4">
              <span className="font-bold">Gestor 360</span>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex flex-1 flex-col py-4">{navContent}</div>
            <div className="border-t p-3">
              <form action={signOut}>
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 text-muted-foreground"
                  type="submit"
                >
                  <LogOut className="h-5 w-5" />
                  Sair
                </Button>
              </form>
            </div>
          </aside>
        </div>
      )}

      {/* Conteúdo */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b bg-card px-4 md:px-8">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1" />
          <ThemeToggle />
        </header>
        <main className="flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
