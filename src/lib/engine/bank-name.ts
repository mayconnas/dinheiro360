// ─────────────────────────────────────────────────────────────
// Nome LIMPO do banco/emissor — deriva um rótulo curto e estável
// ("Mercado Pago", "Bradesco", "Nubank"...) a partir do que a API
// Pluggy devolve para uma conta, em ordem de confiança:
//
//   1) código COMPE do banco (bankData.transferNumber, 3 primeiros
//      dígitos) — o dado MAIS confiável: é um código bancário oficial
//      (tabela de participantes STR/COMPE do Bacen) e não muda por
//      rebranding de nome fantasia/produto.
//   2) nome/marketingName da conta, casado contra apelidos conhecidos
//      (ex "Nu Pagamentos S.A. - Instituição de Pagamento" → "Nubank").
//   3) nome/marketingName limpo de sufixos societários comuns (S.A.,
//      Ltda, "Instituição de Pagamento"...), como último recurso.
//
// Cartões com nome genérico de produto (ex "gold", "platinum", sem
// nenhuma pista de banco no name/marketingName nem no bankData) NÃO
// têm como ser identificados com certeza por este helper — a Pluggy
// às vezes só devolve o nome do PRODUTO do cartão, não o emissor.
// Nesse caso o próprio nome genérico (limpo) é devolvido como
// `institution`, best-effort: pelo menos serve de rótulo estável para
// agrupar o mesmo cartão entre syncs. O nome ORIGINAL da conta
// continua preservado à parte (accounts.name/number, ver
// src/lib/pluggy/sync.ts) — este helper nunca o descarta, só deriva
// um rótulo de agrupamento a mais.
//
// Pura, client-safe (sem "server-only"): deliberadamente NÃO importa
// PluggyAccount de src/lib/pluggy/client.ts (que é server-only) — usa
// uma interface estrutural mínima, para poder ser chamada tanto no
// servidor (sync.ts) quanto em componente cliente se algum dia
// precisar.
//
// Usado só para EXIBIÇÃO/AGRUPAMENTO (filtro "por banco", cabeçalho
// de conexão, painel 360) — NUNCA para cálculo de saldo/dívida.
// ─────────────────────────────────────────────────────────────

/** Subconjunto estrutural de PluggyAccount que este helper precisa. */
export interface BankNameAccountInput {
  /** 'BANK'|'CREDIT'|'INVESTMENT'|... (Pluggy PluggyAccount.type). */
  type?: string | null;
  /** 'CHECKING_ACCOUNT'|'CREDIT_CARD'|... (Pluggy PluggyAccount.subtype). */
  subtype?: string | null;
  name?: string | null;
  marketingName?: string | null;
  bankData?: { transferNumber?: string | null } | null;
}

export interface CleanInstitutionResult {
  /** rótulo curto e estável do banco/emissor (ex "Mercado Pago", "Bradesco"). */
  institution: string;
  /** true quando a conta é um CARTÃO DE CRÉDITO (type='CREDIT' ou subtype='CREDIT_CARD'). */
  isCard: boolean;
}

/**
 * Código COMPE (3 primeiros dígitos de bankData.transferNumber) →
 * nome do banco/fintech. NÃO exaustivo — cobre os participantes mais
 * comuns do Open Finance brasileiro + os observados nas conexões
 * reais deste app. Só para DISPLAY (agrupamento/rótulo); nunca usado
 * em cálculo de valores, então uma entrada faltando/desatualizada
 * aqui degrada de forma segura (cai para o nome/marketingName, passo
 * 2/3 de cleanInstitution) em vez de quebrar algo.
 */
export const COMPE_BANKS: Record<string, string> = {
  "001": "Banco do Brasil",
  "033": "Santander",
  "041": "Banrisul",
  "070": "BRB",
  "077": "Inter",
  "102": "XP Investimentos",
  "104": "Caixa Econômica Federal",
  "208": "BTG Pactual",
  "212": "Banco Original",
  "218": "BS2",
  "237": "Bradesco",
  "260": "Nubank",
  "290": "PagBank",
  "318": "Banco BMG",
  "323": "Mercado Pago",
  "336": "C6 Bank",
  "341": "Itaú",
  "380": "PicPay",
  "403": "Cora",
  "422": "Safra",
  "461": "Asaas",
  "623": "Banco Pan",
  "637": "Sofisa",
  "654": "Digimais",
  "735": "Neon",
  "748": "Sicredi",
  "756": "Sicoob",
};

/** Apelidos conhecidos por substring no name/marketingName cru (case-insensitive). */
const NAME_ALIASES: [test: RegExp, label: string][] = [
  [/nu\s*pagamentos|nubank/i, "Nubank"],
  [/bradesco/i, "Bradesco"],
  [/mercado\s*pago/i, "Mercado Pago"],
  [/\bnext\b|banco digital next/i, "Next"],
  [/\bitau\b|itaú/i, "Itaú"],
  [/\binter\b/i, "Inter"],
  [/santander/i, "Santander"],
  [/\bcaixa\b/i, "Caixa"],
  [/banco do brasil|\bbb\b/i, "Banco do Brasil"],
  [/\bc6\b|c6 bank/i, "C6 Bank"],
  [/\bpicpay\b/i, "PicPay"],
  [/pagbank|pagseguro/i, "PagBank"],
  [/\bneon\b/i, "Neon"],
  [/\bxp\b|xp investimentos/i, "XP Investimentos"],
  [/btg\s*pactual|\bbtg\b/i, "BTG Pactual"],
  [/\bsicoob\b/i, "Sicoob"],
  [/\bsicredi\b/i, "Sicredi"],
  [/\bwill\s*bank\b/i, "Will Bank"],
];

/** dígitos de transferNumber → código COMPE (3 primeiros) ou null. */
function compeCode(transferNumber?: string | null): string | null {
  const digits = (transferNumber ?? "").replace(/\D/g, "");
  return digits.length >= 3 ? digits.slice(0, 3) : null;
}

function matchAlias(raw: string): string | null {
  for (const [test, label] of NAME_ALIASES) {
    if (test.test(raw)) return label;
  }
  return null;
}

/** Remove sufixos societários/institucionais comuns; sobra o nome enxuto. */
function stripCorporateSuffixes(raw: string): string {
  return raw
    .replace(
      /\s*-\s*(institui[çc][ãa]o de pagamento|banco m[úu]ltiplo|sociedade de cr[ée]dito.*)\s*$/i,
      ""
    )
    .replace(/\b(s\.?\s?a\.?|ltda\.?|s\/a)\b\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Deriva o nome/rótulo cru (marketingName preferido a name, por ser o
 * nome fantasia mais amigável quando presente) e aplica alias
 * conhecido ou, na falta, a limpeza de sufixos societários — sem
 * envolver o código COMPE. Exportado à parte para quem só tem o
 * name/marketingName em mãos (ex. dados já persistidos sem
 * bankData/transferNumber disponível), evitando duplicar a lista de
 * apelidos/sufixos noutro arquivo.
 */
export function cleanNameOnly(rawName: string | null | undefined): string {
  const raw = (rawName ?? "").trim();
  if (!raw) return "Banco";
  const alias = matchAlias(raw);
  if (alias) return alias;
  const cleaned = stripCorporateSuffixes(raw);
  return cleaned || raw;
}

/**
 * Deriva o nome LIMPO do banco/emissor para uma conta Pluggy, em
 * ordem de confiança: (1) código COMPE de bankData.transferNumber,
 * (2) apelido conhecido por nome/marketingName, (3) nome limpo de
 * sufixos societários. Ver cabeçalho do arquivo para o caso de
 * cartão com nome genérico.
 */
export function cleanInstitution(
  account: BankNameAccountInput
): CleanInstitutionResult {
  const isCard =
    (account.type ?? "").toUpperCase() === "CREDIT" ||
    (account.subtype ?? "").toUpperCase() === "CREDIT_CARD";

  const compe = compeCode(account.bankData?.transferNumber);
  if (compe && COMPE_BANKS[compe]) {
    return { institution: COMPE_BANKS[compe], isCard };
  }

  const raw = (account.marketingName || account.name || "").trim();
  return { institution: cleanNameOnly(raw), isCard };
}
