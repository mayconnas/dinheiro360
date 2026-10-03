// ─────────────────────────────────────────────────────────────
// Constantes/tipos PUROS das abas de Configurações. Arquivo NEUTRO
// (sem "use client") para poder ser importado tanto pelo server
// component (configuracoes/page.tsx) quanto pelo client
// (settings-tabs.tsx). Não coloque nada aqui que dependa do React
// client (hooks, componentes) — só dados e funções puras.
// ─────────────────────────────────────────────────────────────

export const SETTINGS_TABS = ["perfil", "conexoes", "ia"] as const;
export type SettingsTabId = (typeof SETTINGS_TABS)[number];

export const DEFAULT_SETTINGS_TAB: SettingsTabId = "perfil";

const SETTINGS_TAB_SET = new Set<string>(SETTINGS_TABS);

/** True quando `value` é uma aba válida. Puro — server e client usam. */
export function isSettingsTab(value: string | null): value is SettingsTabId {
  return !!value && SETTINGS_TAB_SET.has(value);
}
