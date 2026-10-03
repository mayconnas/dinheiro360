"use client";

// ─────────────────────────────────────────────────────────────
// Abas da tela de Configurações. Estado controlado via querystring
// (?tab=perfil|conexoes|ia), não useState — assim o link é
// compartilhável/atualizável (ex.: /configuracoes?tab=ia) e sobrevive a
// refresh. Usa o <Tabs> do shadcn/ui (Radix) já presente no projeto.
//
// COMO UMA FEATURE INJETA CONTEÚDO NUMA ABA:
// Este componente NÃO conhece o conteúdo das abas — ele só monta a
// casca (lista de triggers + troca de painel) e recebe o conteúdo de
// cada aba via props `perfilSlot` / `conexoesSlot` / `iaSlot`. O
// server component da página (src/app/(app)/configuracoes/page.tsx)
// monta cada slot como JSX (Server Component, pode ser async) e passa
// pra cá. Isso mantém o data-fetching de cada feature no server,
// enquanto só a casca de abas roda no client.
//
// Para adicionar uma nova aba no futuro: (1) adicione o id em
// SETTINGS_TABS, (2) adicione a prop `<novoId>Slot: React.ReactNode`,
// (3) adicione o <TabsTrigger>/<TabsContent> correspondente abaixo.
// ─────────────────────────────────────────────────────────────

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { User, Building2, Sparkles } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  SETTINGS_TABS,
  DEFAULT_SETTINGS_TAB,
  isSettingsTab,
  type SettingsTabId,
} from "@/components/configuracoes/settings-tabs-config";

// Re-exporta as constantes puras (definidas no arquivo neutro) para quem
// já importava daqui. O server component importa direto do -config.
export {
  SETTINGS_TABS,
  DEFAULT_SETTINGS_TAB,
  isSettingsTab,
  type SettingsTabId,
};

const TAB_META: Record<SettingsTabId, { label: string; icon: typeof User }> = {
  perfil: { label: "Geral / Perfil", icon: User },
  conexoes: { label: "Conexões", icon: Building2 },
  ia: { label: "Inteligência (IA)", icon: Sparkles },
};

export interface SettingsTabsProps {
  /** Aba ativa no primeiro render (lida do searchParams no server). */
  initialTab: SettingsTabId;
  /** Conteúdo da aba "Geral/Perfil" — injetado pela feature de Perfil. */
  perfilSlot: React.ReactNode;
  /** Conteúdo da aba "Conexões" — injetado pela feature de Open Finance/Pluggy. */
  conexoesSlot: React.ReactNode;
  /** Conteúdo da aba "Inteligência (IA)" — injetado pela feature de credenciais de IA. */
  iaSlot: React.ReactNode;
}

export function SettingsTabs({
  initialTab,
  perfilSlot,
  conexoesSlot,
  iaSlot,
}: SettingsTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const current = isSettingsTab(searchParams.get("tab"))
    ? (searchParams.get("tab") as SettingsTabId)
    : initialTab;

  function handleChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <Tabs value={current} onValueChange={handleChange} className="w-full">
      <TabsList>
        {SETTINGS_TABS.map((id) => {
          const { label, icon: Icon } = TAB_META[id];
          return (
            <TabsTrigger key={id} value={id} className="gap-2">
              <Icon className="h-4 w-4" />
              {label}
            </TabsTrigger>
          );
        })}
      </TabsList>

      <TabsContent value="perfil">{perfilSlot}</TabsContent>
      <TabsContent value="conexoes">{conexoesSlot}</TabsContent>
      <TabsContent value="ia">{iaSlot}</TabsContent>
    </Tabs>
  );
}
