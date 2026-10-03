// ─────────────────────────────────────────────────────────────
// Camada 3.4 — Detector de Recorrências (R10)
// Recorrência = mesmo estabelecimento + valor ~igual + intervalo
//               ~mensal (± dias). Assinatura / conta fixa.
// Alimenta a projeção (custos fixos futuros) e a lista de
// "assinaturas que você talvez tenha esquecido".
// Puro.
// ─────────────────────────────────────────────────────────────
import type { Transaction } from "@/lib/types";
import { realTransactions } from "./aggregate";
import { descriptionSimilarity } from "./dedup";

export interface Recurrence {
  /** descrição representativa (a mais recente) */
  label: string;
  categoryId: string | null;
  /** valor médio das ocorrências */
  amount: number;
  type: "entrada" | "saida";
  /** intervalo médio em dias entre ocorrências */
  intervalDays: number;
  occurrences: number;
  /** data ISO da última ocorrência */
  lastDate: string;
  /** data ISO prevista da próxima */
  nextExpected: string;
  /** true se já deveria ter ocorrido e não ocorreu */
  overdue: boolean;
}

const AMOUNT_TOLERANCE = 0.15; // ±15%
const MONTH_MIN = 25;
const MONTH_MAX = 35;
const SIM_THRESHOLD = 0.6;

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

interface Cluster {
  txs: Transaction[];
}

/** Agrupa transações por semelhança de descrição + valor. */
function clusterByMerchant(txs: Transaction[]): Cluster[] {
  const clusters: Cluster[] = [];
  for (const t of txs) {
    let placed = false;
    for (const c of clusters) {
      const rep = c.txs[0];
      const amountClose =
        Math.abs(t.amount - rep.amount) / Math.max(rep.amount, 1) <=
        AMOUNT_TOLERANCE;
      const descClose =
        descriptionSimilarity(t.description, rep.description) >= SIM_THRESHOLD;
      if (amountClose && descClose && t.type === rep.type) {
        c.txs.push(t);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ txs: [t] });
  }
  return clusters;
}

/**
 * Detecta recorrências. `today` permite avaliar atraso de forma
 * determinística.
 */
export function detectRecurrences(
  txs: Transaction[],
  today: string
): Recurrence[] {
  const clean = realTransactions(txs);
  const clusters = clusterByMerchant(clean);
  const recurrences: Recurrence[] = [];

  for (const c of clusters) {
    if (c.txs.length < 2) continue; // recorrência exige repetição
    const sorted = [...c.txs].sort((a, b) => a.date.localeCompare(b.date));

    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      intervals.push(dayDiff(sorted[i - 1].date, sorted[i].date));
    }
    const avgInterval =
      intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // intervalo precisa parecer mensal
    if (avgInterval < MONTH_MIN || avgInterval > MONTH_MAX) continue;

    const amount =
      sorted.reduce((a, t) => a + t.amount, 0) / sorted.length;
    const last = sorted[sorted.length - 1];
    const nextExpected = addDays(last.date, Math.round(avgInterval));
    const daysSinceExpected = dayDiff(nextExpected, today);
    const overdue = daysSinceExpected > 5; // margem de tolerância

    recurrences.push({
      label: last.description,
      categoryId: last.categoryId,
      amount,
      type: last.type,
      intervalDays: Math.round(avgInterval),
      occurrences: sorted.length,
      lastDate: last.date,
      nextExpected,
      overdue,
    });
  }

  return recurrences.sort((a, b) => b.amount - a.amount);
}

/** Recorrências de saída ainda esperadas dentro do mês (custos fixos futuros). */
export function expectedExpenseRemaining(
  recurrences: Recurrence[],
  month: string
): number {
  return recurrences
    .filter(
      (r) =>
        r.type === "saida" &&
        !r.overdue &&
        r.nextExpected.slice(0, 7) === month
    )
    .reduce((acc, r) => acc + r.amount, 0);
}

/** Recorrências de entrada ainda esperadas no mês (receitas fixas futuras). */
export function expectedIncomeRemaining(
  recurrences: Recurrence[],
  month: string
): number {
  return recurrences
    .filter(
      (r) =>
        r.type === "entrada" &&
        !r.overdue &&
        r.nextExpected.slice(0, 7) === month
    )
    .reduce((acc, r) => acc + r.amount, 0);
}
