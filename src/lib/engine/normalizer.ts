// ─────────────────────────────────────────────────────────────
// Camada 1.2 — Normalizador (R2)
// Limpa e padroniza o que os conectores trouxeram:
//   • valor sempre positivo + campo `tipo` separado
//   • data em ISO (AAAA-MM-DD)
//   • descrição limpa (remove ruído de extrato)
// Função pura, sem IO. Testável isoladamente.
// ─────────────────────────────────────────────────────────────
import type { PaymentMethodValue, RawTransaction, TransactionType } from "@/lib/types";

export interface NormalizedTransaction {
  date: string;
  amount: number;
  type: TransactionType;
  description: string;
  rawDescription: string;
  externalId?: string;
  /** Propagado de RawTransaction — ver src/lib/types.ts. */
  counterpartyName?: string;
  counterpartyDocument?: string;
  /** Propagados de RawTransaction (Pluggy) — ver src/lib/types.ts. */
  paymentMethod?: PaymentMethodValue | null;
  operationType?: string | null;
  merchantName?: string | null;
  pluggyCategory?: string | null;
  pluggyCategoryId?: string | null;
  status?: string | null;
  hasCreditCard?: boolean | null;
  rawPayload?: unknown | null;
}

/** Ruído comum em descrições de extrato/cartão. */
const NOISE_PATTERNS: RegExp[] = [
  /\bCOMPRA\s+CARTAO\b/gi,
  /\bCARTAO\s+DE\s+CREDITO\b/gi,
  /\bCART[AÃ]O\b/gi,
  /\bPAGAMENTO\b/gi,
  /\bDEBITO\b/gi,
  /\bCREDITO\b/gi,
  /\bPIX\s+(ENVIADO|RECEBIDO)\b/gi,
  /\bTED\b/gi,
  /\bDOC\b/gi,
  /\bCOMPRA\b/gi,
  /\*+/g, // asteriscos de mascaramento
  /\b\d{4,}\b/g, // sequências longas de dígitos (nº do cartão etc.)
];

/** Normaliza uma data em vários formatos comuns para ISO AAAA-MM-DD. */
export function toISODate(input: string): string {
  const s = input.trim();

  // já em ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // DD/MM/AAAA ou DD-MM-AAAA
  const br = s.match(/^(\d{2})[/\-.](\d{2})[/\-.](\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  // DD/MM/AA
  const brShort = s.match(/^(\d{2})[/\-.](\d{2})[/\-.](\d{2})$/);
  if (brShort) return `20${brShort[3]}-${brShort[2]}-${brShort[1]}`;

  // AAAA/MM/DD
  const isoSlash = s.match(/^(\d{4})[/\-.](\d{2})[/\-.](\d{2})$/);
  if (isoSlash) return `${isoSlash[1]}-${isoSlash[2]}-${isoSlash[3]}`;

  // fallback: tenta o Date do JS, mas sem depender de fuso
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // não conseguiu: devolve como veio (o repositório valida)
  return s;
}

function stripNoise(raw: string): string {
  let d = raw;
  for (const pattern of NOISE_PATTERNS) d = d.replace(pattern, " ");
  return d
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "")
    .trim();
}

/** Palavras que sobram de extratos genéricos e não identificam ninguém (sem acento, minúsculas). */
const GENERIC_WORDS = new Set([
  "pix", "ted", "doc", "boleto", "saque", "estorno", "deposito", "recebimento",
  "transferencia", "transf", "pagamento", "pagto", "pgto", "compra", "cartao",
  "debito", "credito", "recebido", "recebida", "enviado", "enviada",
  "qr", "code", "qrcode", "para", "pelo", "pela", "de", "da", "do", "das", "dos",
  "no", "na", "nos", "nas", "em", "com", "via",
]);

/**
 * true quando a descrição é só ruído de extrato ("PIX RECEBIDO", "TED
 * RECEBIDA", "PAGAMENTO DE BOLETO", "Transferência enviada pelo Pix",
 * "COMPRA CARTAO 1234") — não identifica ninguém e, como regras casam
 * por substring, viraria um padrão que pega lançamentos sem relação.
 * Exige ao menos uma palavra de 3+ letras fora da lista de genéricas.
 */
export function isNoiseOnlyDescription(raw: string): boolean {
  const words = stripNoise(raw)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return !words.some((w) => w.length >= 3 && /[a-z]/.test(w) && !GENERIC_WORDS.has(w));
}

/** Limpa a descrição removendo ruído e normalizando espaços/caixa. */
export function cleanDescription(raw: string): string {
  const d = stripNoise(raw);

  if (!d) return raw.trim(); // nunca devolve vazio

  // Title Case leve (primeira letra de cada palavra), preservando siglas curtas.
  return d
    .toLowerCase()
    .split(" ")
    .map((w) => (w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Aplica o normalizador a uma transação crua.
 * Resolve o sinal: se `type` não vier, deduz pelo sinal do valor
 * (negativo = saída, positivo = entrada) — convenção de extrato.
 */
export function normalize(raw: RawTransaction): NormalizedTransaction {
  const type: TransactionType =
    raw.type ?? (raw.amount < 0 ? "saida" : "entrada");

  return {
    date: toISODate(raw.date),
    amount: Math.abs(raw.amount),
    type,
    description: cleanDescription(raw.description),
    rawDescription: raw.description.trim(),
    externalId: raw.externalId,
    counterpartyName: raw.counterpartyName,
    counterpartyDocument: raw.counterpartyDocument,
    paymentMethod: raw.paymentMethod,
    operationType: raw.operationType,
    merchantName: raw.merchantName,
    pluggyCategory: raw.pluggyCategory,
    pluggyCategoryId: raw.pluggyCategoryId,
    status: raw.status,
    hasCreditCard: raw.hasCreditCard,
    rawPayload: raw.rawPayload,
  };
}

export function normalizeMany(
  raws: RawTransaction[]
): NormalizedTransaction[] {
  return raws.map(normalize);
}
