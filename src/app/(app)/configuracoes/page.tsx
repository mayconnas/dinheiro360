import { getProfile, getAccounts } from "@/lib/data/repository";
import { ProfileView } from "@/components/profile-view";
import { ConnectionsSection } from "@/components/configuracoes/connections-section";
import { AiKeysSection } from "@/components/configuracoes/ai-keys-section";
import { getAICredentialsStatus } from "@/app/actions/ai-credentials";
import { JevSection } from "@/components/configuracoes/jev-section";
import { getJevStatus } from "@/app/actions/jev";
import { SettingsTabs } from "@/components/configuracoes/settings-tabs";
import {
  DEFAULT_SETTINGS_TAB,
  isSettingsTab,
  type SettingsTabId,
} from "@/components/configuracoes/settings-tabs-config";

// ─────────────────────────────────────────────────────────────
// Casa de "Configurações": Geral/Perfil, Conexões (Open Finance) e
// Inteligência (IA). A casca de abas é client (settings-tabs.tsx); os
// dados de cada aba são buscados aqui no server e passados como slots.
//
// A aba "ia" usa getAICredentialsStatus() (server action) para buscar a
// projeção mascarada das credenciais de cada provedor e passa pra
// <AiKeysSection>, que é client (useTransition + server actions de
// escrita em src/app/actions/ai-credentials.ts). A api_key completa
// nunca chega até aqui.
//
// Na mesma aba fica o card da TypeSafe (Jev), que não é um provedor de
// chat: é usado só para categorizar lançamentos na tela de Transações
// (ver src/app/actions/jev.ts). Status também mascarado.
// ─────────────────────────────────────────────────────────────

function resolveTab(raw: string | string[] | undefined): SettingsTabId {
  const value = (Array.isArray(raw) ? raw[0] : raw) ?? null;
  return isSettingsTab(value) ? value : DEFAULT_SETTINGS_TAB;
}

export default async function ConfiguracoesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const initialTab = resolveTab(params.tab);

  const [profile, accounts, credentialsStatus, jevStatus] = await Promise.all([
    getProfile(),
    getAccounts(),
    getAICredentialsStatus(),
    getJevStatus(),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">
          Seu perfil, suas conexões de Open Finance e as chaves de IA usadas
          pelo Gestor.
        </p>
      </div>

      <SettingsTabs
        initialTab={initialTab}
        perfilSlot={
          profile ? (
            <ProfileView profile={profile} accounts={accounts} />
          ) : (
            <p className="text-muted-foreground">Perfil não encontrado.</p>
          )
        }
        conexoesSlot={<ConnectionsSection />}
        iaSlot={
          <div className="space-y-6">
            <AiKeysSection status={credentialsStatus.data} />
            <JevSection status={jevStatus.data} />
          </div>
        }
      />
    </div>
  );
}
