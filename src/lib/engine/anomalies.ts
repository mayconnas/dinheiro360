// ─────────────────────────────────────────────────────────────
// Camada 3.3 — Detector de Anomalias (R9)
// Cada regra vira um flag:
//   • gasto numa categoria > X% acima da média histórica dela
//   • transação de valor > média + N desvios-padrão do padrão
//   • cobrança recorrente NOVA (estabelecimento inédito com cara de assinatura)
//   • assinatura esperada e AUSENTE (recorrência que sumiu)
// Puro.
// ─────────────────────────────────────────────────────────────
import type { Category, Transaction } from "@/lib/types";
import {
  avgExpenseByCategory,
  expenseByCategory,
  filterByMonth,
  mean,
  realTransactions,
  stdDev,
} from "./aggregate";
import type { Recurrence } from "./recurrences";

export type FlagSeverity = "info" | "atencao" | "critico";

export interface Flag {
  kind:
    | "categoria_acima_media"
    | "transacao_atipica"
    | "cobranca_nova"
    | "assinatura_ausente";
  severity: FlagSeverity;
  title: string;
  detail: string;
  /** valor em R$ associado ao flag, quando aplicável */
  amount?: number;
  categoryId?: string | null;
}

const CATEGORY_OVERRUN = 0.4; // > 40% acima da média (R9, "X%")
const OUTLIER_SIGMAS = 2.5; // > média + N desvios (R9, "N desvios")

/** Regra 1: categoria gastando muito acima da própria média histórica. */
function categoryOverruns(
  txs: Transaction[],
  month: string,
  categories: Category[]
): Flag[] {
  const current = expenseByCategory(txs, month);
  const avg = avgExpenseByCategory(txs, month, 3);
  const catById = new Map(categories.map((c) => [c.id, c]));
  const flags: Flag[] = [];

  for (const [catId, spent] of current) {
    const baseline = avg.get(catId);
    if (!baseline || baseline < 50) continue; // ignora ruído de valores baixos
    const overrun = (spent - baseline) / baseline;
    if (overrun >= CATEGORY_OVERRUN) {
      const name = catById.get(catId)?.name ?? "Sem categoria";
      flags.push({
        kind: "categoria_acima_media",
        severity: overrun >= 0.8 ? "critico" : "atencao",
        title: `${name} acima do normal`,
        detail: `Gasto de R$ ${spent.toFixed(2)} vs. média de R$ ${baseline.toFixed(
          2
        )} (${Math.round(overrun * 100)}% acima).`,
        amount: spent - baseline,
        categoryId: catId,
      });
    }
  }
  return flags;
}

/** Regra 2: transação individual atípica (outlier estatístico). */
function outlierTransactions(txs: Transaction[], month: string): Flag[] {
  const history = realTransactions(txs).filter(
    (t) => t.type === "saida" && t.date.slice(0, 7) < month
  );
  if (history.length < 8) return []; // pouca base pra estatística

  const amounts = history.map((t) => t.amount);
  const m = mean(amounts);
  const sd = stdDev(amounts);
  if (sd === 0) return [];
  const threshold = m + OUTLIER_SIGMAS * sd;

  const flags: Flag[] = [];
  for (const t of filterByMonth(txs, month)) {
    if (t.type !== "saida") continue;
    if (t.amount > threshold) {
      flags.push({
        kind: "transacao_atipica",
        severity: "atencao",
        title: `Transação atípica: ${t.description}`,
        detail: `R$ ${t.amount.toFixed(
          2
        )} está bem acima do seu padrão (média R$ ${m.toFixed(2)}).`,
        amount: t.amount,
        categoryId: t.categoryId,
      });
    }
  }
  return flags;
}

/** Regra 3 e 4: cobranças novas e assinaturas ausentes, a partir das recorrências. */
function recurrenceFlags(
  recurrences: Recurrence[],
  month: string
): Flag[] {
  const flags: Flag[] = [];
  for (const r of recurrences) {
    if (r.type !== "saida") continue;

    // Regra 4 — assinatura esperada e ausente
    if (r.overdue) {
      flags.push({
        kind: "assinatura_ausente",
        severity: "info",
        title: `Recorrência sumiu: ${r.label}`,
        detail: `Era esperada perto de ${r.nextExpected} (~R$ ${r.amount.toFixed(
          2
        )}) e não apareceu. Confira se foi cobrada em outro lugar.`,
        amount: r.amount,
        categoryId: r.categoryId,
      });
    }

    // Regra 3 — cobrança nova (recorrência recém-nascida: 2 ocorrências, a última neste mês)
    if (
      r.occurrences === 2 &&
      !r.overdue &&
      r.lastDate.slice(0, 7) === month
    ) {
      flags.push({
        kind: "cobranca_nova",
        severity: "atencao",
        title: `Cobrança recorrente nova: ${r.label}`,
        detail: `Parece uma assinatura nova de ~R$ ${r.amount.toFixed(
          2
        )}/mês. Se não reconhece, cancele.`,
        amount: r.amount,
        categoryId: r.categoryId,
      });
    }
  }
  return flags;
}

export function detectAnomalies(
  txs: Transaction[],
  month: string,
  categories: Category[],
  recurrences: Recurrence[]
): Flag[] {
  const flags = [
    ...categoryOverruns(txs, month, categories),
    ...outlierTransactions(txs, month),
    ...recurrenceFlags(recurrences, month),
  ];
  const rank: Record<FlagSeverity, number> = {
    critico: 0,
    atencao: 1,
    info: 2,
  };
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
