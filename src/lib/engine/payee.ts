// ─────────────────────────────────────────────────────────────
// Camada 1.2b — Extrator/normalizador de Destinatário (Payee)
// Resolve "com quem" foi a transação: pessoa, empresa ou
// estabelecimento. Fonte de verdade em ordem de confiança:
//   1. counterpartyName (Pluggy paymentData.payer/receiver ou
//      merchant.name/businessName) — estruturado, não precisa parsing.
//   2. parsing de rawDescription (extrato sem paymentData) — remove
//      prefixos de operação e ruído, devolve o que sobrar.
// Funções puras, sem IO. Testáveis isoladamente.
// ─────────────────────────────────────────────────────────────
import type { TransactionType } from "@/lib/types";

export type PayeeKind = "pessoa" | "empresa" | "estabelecimento" | "desconhecido";

/** Prefixos/termos de operação bancária a remover antes de sobrar o nome. */
const OPERATION_PREFIXES: RegExp[] = [
  /\bTRANSFEREN(?:CIA|C[IÍ]A)\s+(?:ENVIADA|RECEBIDA)\b/gi,
  /\bTRANSFEREN(?:CIA|C[IÍ]A)\b/gi,
  /\bPIX\s+(?:ENVIADO|RECEBIDO)\b/gi,
  /\bPIX\b/gi,
  /\bTED\b/gi,
  /\bDOC\b/gi,
  /\bBOLETO\b/gi,
  /\bPAGAMENTO\s+DE\s+BOLETO\b/gi,
  /\bPAGAMENTO\b/gi,
  /\bCOMPRA\s+(?:NO\s+)?CARTAO\b/gi,
  /\bCOMPRA\b/gi,
  /\bCART[AÃ]O\s+DE\s+CREDITO\b/gi,
  /\bCART[AÃ]O\b/gi,
  /\bDEBITO\b/gi,
  /\bCREDITO\b/gi,
  /\bSAQUE\b/gi,
  /\bDEPOSITO\b/gi,
  /\bSAL[AÁ]RIO\b/gi,
  /\bREMUNERA[CÇ][AÃ]O\b/gi,
  /\bRESGATE\b/gi,
  /\bAPLICA[CÇ][AÃ]O\b/gi,
  /\bENVIADA?\b/gi,
  /\bRECEBIDA?\b/gi,
];

/** Ruído residual: pedidos, parcelas, máscaras, datas/horas soltas. */
const RESIDUE_PATTERNS: RegExp[] = [
  /\bPEDIDO\s*#?\d+\b/gi,
  /\bPARC(?:ELA)?\s*\d+\/\d+\b/gi,
  /\b\d{1,2}\/\d{1,2}\b/g, // parcela "1/12" sem a palavra
  /\*+/g, // asteriscos de mascaramento (IFD*IFOOD)
  /\b\d{6,}\b/g, // sequências longas de dígitos (CPF/CNPJ/protocolo)
  /\b\d{2}[:h]\d{2}\b/gi, // horário HH:MM ou HHhMM
  /\bAG\s*\d+\b/gi, // agência
  /\bCC?\s*\d+\b/gi, // conta corrente abreviada
  /[-–—:|]{1,}$/g,
  /^[-–—:|]{1,}/g,
];

/** Estabelecimentos conhecidos: prefixo/substring → nome canônico. */
const KNOWN_MERCHANTS: { match: string; canonical: string }[] = [
  { match: "ifood", canonical: "iFood" },
  { match: "ifd*", canonical: "iFood" },
  { match: "uber", canonical: "Uber" },
  { match: "99app", canonical: "99" },
  { match: "99*", canonical: "99" },
  { match: "rappi", canonical: "Rappi" },
  { match: "mcdonald", canonical: "McDonald's" },
  { match: "burger king", canonical: "Burger King" },
  { match: "netflix", canonical: "Netflix" },
  { match: "spotify", canonical: "Spotify" },
  { match: "amazon prime", canonical: "Amazon Prime" },
  { match: "amazon", canonical: "Amazon" },
  { match: "disney", canonical: "Disney+" },
  { match: "hbo", canonical: "HBO Max" },
  { match: "youtube premium", canonical: "YouTube Premium" },
  { match: "google", canonical: "Google" },
  { match: "carrefour", canonical: "Carrefour" },
  { match: "pao de acucar", canonical: "Pão de Açúcar" },
  { match: "assai", canonical: "Assaí" },
  { match: "atacadao", canonical: "Atacadão" },
  { match: "extra", canonical: "Extra" },
  { match: "drogasil", canonical: "Drogasil" },
  { match: "drogaria raia", canonical: "Droga Raia" },
  { match: "raia", canonical: "Droga Raia" },
  { match: "unimed", canonical: "Unimed" },
  { match: "enel", canonical: "Enel" },
  { match: "light sa", canonical: "Light" },
  { match: "sabesp", canonical: "Sabesp" },
  { match: "vivo", canonical: "Vivo" },
  { match: "claro", canonical: "Claro" },
  { match: "tim ", canonical: "Tim" },
  { match: "shell", canonical: "Shell" },
  { match: "ipiranga", canonical: "Ipiranga" },
  { match: "posto", canonical: "Posto" },
];

/** Remove acentos (NFD → strip combining marks). */
function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Sufixos societários removidos na chave de dedup (não no nome exibido). */
const COMPANY_SUFFIXES =
  /\b(ltda|me|epp|s\/?a|sa|eireli|mei|holding|group|grupo)\b\.?/gi;

/**
 * Chave de dedup: minúsculo, sem acento, colapsa espaços, remove
 * pontuação e sufixos societários (LTDA/ME/S.A./EIRELI...) para que
 * "Maria Oliveira Santos" e "MARIA OLIVEIRA SANTOS" — ou "Empresa
 * XYZ" e "Empresa XYZ Ltda" — caiam na mesma chave.
 */
export function normalizePayeeName(name: string): string {
  let s = stripAccents(name).toLowerCase();
  s = s.replace(COMPANY_SUFFIXES, " ");
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " "); // pontuação fora
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/** Title Case leve, preservando siglas curtas (≤2 letras) em minúsculo. */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export interface ExtractPayeeInput {
  /** Nome estruturado da contraparte, quando a fonte já entrega (Pluggy). */
  counterpartyName?: string;
  /** Descrição bruta (preserva o original — NÃO usar a description limpa). */
  rawDescription: string;
  type?: TransactionType;
}

/**
 * Extrai o nome de exibição da contraparte. Prioriza counterpartyName
 * (estruturado, Pluggy); sem ele, faz parsing de rawDescription
 * removendo prefixos de operação e ruído residual. Reconhece
 * estabelecimentos conhecidos (KNOWN_MERCHANTS) e devolve o nome
 * canônico. Se sobrar vazio/curto demais/só ruído, devolve null.
 */
export function extractPayeeName(input: ExtractPayeeInput): string | null {
  if (input.counterpartyName && input.counterpartyName.trim()) {
    return titleCase(input.counterpartyName.trim());
  }

  const raw = input.rawDescription.trim();
  if (!raw) return null;

  // estabelecimento conhecido: verifica no raw (case-insensitive) antes
  // de qualquer remoção, pois o match costuma incluir separadores (* etc).
  const haystack = stripAccents(raw).toLowerCase();
  for (const entry of KNOWN_MERCHANTS) {
    if (haystack.includes(entry.match)) return entry.canonical;
  }

  let s = raw;
  for (const pattern of OPERATION_PREFIXES) s = s.replace(pattern, " ");
  for (const pattern of RESIDUE_PATTERNS) s = s.replace(pattern, " ");
  s = s.replace(/\s+/g, " ").trim();

  if (s.length < 3) return null;
  // sobrou só pontuação/dígitos → sem sinal de nome
  if (!/\p{L}/u.test(s)) return null;

  return titleCase(s);
}

/**
 * Classifica o tipo de contraparte:
 *  • documento com 11 dígitos → pessoa (CPF)
 *  • documento com 14 dígitos → empresa (CNPJ)
 *  • sem documento mas veio de merchant (compra/estabelecimento) →
 *    estabelecimento
 *  • senão → desconhecido
 */
export function guessKind(input: {
  counterpartyDocument?: string;
  name: string;
  isMerchant?: boolean;
}): PayeeKind {
  const digits = (input.counterpartyDocument ?? "").replace(/\D/g, "");
  if (digits.length === 11) return "pessoa";
  if (digits.length === 14) return "empresa";
  if (input.isMerchant) return "estabelecimento";
  return "desconhecido";
}
