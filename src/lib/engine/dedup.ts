// ─────────────────────────────────────────────────────────────
// Camada 1.3 — Deduplicador (R3)
// Duplicata = mesma data (± janela de N dias) E mesmo valor
//             E descrição similar (comparação difusa).
// Prioridade (R1): fonte automática vence a manual.
// Função pura.
// ─────────────────────────────────────────────────────────────
import type { NormalizedTransaction } from "./normalizer";
import type { Transaction, TransactionOrigin } from "@/lib/types";

const DEFAULT_WINDOW_DAYS = 3;
const SIMILARITY_THRESHOLD = 0.72;

/** Prioridade de origem: maior número vence. */
const ORIGIN_RANK: Record<TransactionOrigin, number> = {
  manual: 0,
  import: 1,
  open_finance: 2,
};

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const da = Date.UTC(ay, am - 1, ad);
  const db = Date.UTC(by, bm - 1, bd);
  return Math.abs((da - db) / 86_400_000);
}

/** Similaridade difusa por bag-of-tokens (Jaccard sobre palavras). */
export function descriptionSimilarity(a: string, b: string): number {
  const norm = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((t) => t.length > 1)
    );
  const sa = norm(a);
  const sb = norm(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return inter / union;
}

/** Duas transações são a mesma coisa? */
export function isSameTransaction(
  a: { date: string; amount: number; description: string },
  b: { date: string; amount: number; description: string },
  windowDays = DEFAULT_WINDOW_DAYS
): boolean {
  if (Math.abs(a.amount - b.amount) > 0.005) return false;
  if (daysBetween(a.date, b.date) > windowDays) return false;
  return descriptionSimilarity(a.description, b.description) >= SIMILARITY_THRESHOLD;
}

export interface DedupResult {
  /** transações a inserir (não são duplicata de nada já existente) */
  toInsert: NormalizedTransaction[];
  /** transações puladas por já existirem */
  skipped: NormalizedTransaction[];
}

/**
 * Contra o que já está no repositório: pula toda entrada que bater
 * com uma transação existente. A origem existente costuma ter
 * prioridade igual ou maior (automática já gravada), então descartar
 * a nova (frequentemente manual/reimport) é o comportamento correto.
 */
export function dedupeAgainstExisting(
  incoming: NormalizedTransaction[],
  existing: Pick<Transaction, "date" | "amount" | "description">[],
  windowDays = DEFAULT_WINDOW_DAYS
): DedupResult {
  const toInsert: NormalizedTransaction[] = [];
  const skipped: NormalizedTransaction[] = [];

  for (const inc of incoming) {
    const dup = existing.some((ex) => isSameTransaction(inc, ex, windowDays));
    if (dup) skipped.push(inc);
    else toInsert.push(inc);
  }
  return { toInsert, skipped };
}

/** Remove duplicatas *dentro* de um mesmo lote de importação. */
export function dedupeWithinBatch(
  batch: NormalizedTransaction[],
  windowDays = DEFAULT_WINDOW_DAYS
): NormalizedTransaction[] {
  const kept: NormalizedTransaction[] = [];
  for (const t of batch) {
    if (!kept.some((k) => isSameTransaction(t, k, windowDays))) kept.push(t);
  }
  return kept;
}

export { ORIGIN_RANK };
