// ─────────────────────────────────────────────────────────────
// Helpers puros para a tela de Transações (período, agrupamento,
// resumo). Client-safe — SEM "server-only", sem acesso a banco.
// O componente sempre passa o "hoje" por parâmetro (determinismo /
// testabilidade): nada aqui chama `new Date()` internamente para
// decidir presets.
// ─────────────────────────────────────────────────────────────
import type { Transaction } from "@/lib/types";
import type { ClassifyResult } from "@/lib/engine/transfers";

/**
 * Une os três Sets de `classifyTransactions` (excludeFromIncome,
 * excludeFromExpense, cardPurchase — ver src/lib/engine/transfers.ts) num
 * único Set<id>, pronto para passar como `internalTransferIds` para
 * `periodSummary`/`groupByDate` abaixo. Funciona porque os dois já filtram
 * por `t.type`: uma entrada só é descontada se estiver em
 * `excludeFromIncome` (é o único jeito de ela aparecer no Set unido vindo
 * dali), uma saída só é descontada se estiver em `excludeFromExpense` ou
 * `cardPurchase` — a união não mistura os lados.
 */
export function combinedExclusionIds(
  classification: Pick<
    ClassifyResult,
    "excludeFromIncome" | "excludeFromExpense" | "cardPurchase"
  >
): Set<string> {
  return new Set([
    ...classification.excludeFromIncome,
    ...classification.excludeFromExpense,
    ...classification.cardPurchase,
  ]);
}

const MES_ABBR = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

// ─── Utilitários de data (ISO AAAA-MM-DD, sem fuso) ───

function toISO(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function parseISO(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

// ─── Período ───

export interface PeriodRange {
  from: string;
  to: string;
}

export type PeriodPresetKey =
  | "mes_atual"
  | "mes_inteiro"
  | "mes_passado"
  | "ult7"
  | "ult30"
  | "ano";

/**
 * Calcula os 6 presets de período a partir de um "hoje" explícito.
 * NÃO chama `new Date()` internamente — o chamador (componente)
 * decide o "agora".
 */
export function PERIOD_PRESETS(today: Date): Record<PeriodPresetKey, PeriodRange> {
  const y = today.getFullYear();
  const m = today.getMonth();
  return {
    mes_atual: { from: toISO(new Date(y, m, 1)), to: toISO(today) },
    mes_inteiro: { from: toISO(new Date(y, m, 1)), to: toISO(new Date(y, m + 1, 0)) },
    mes_passado: {
      from: toISO(new Date(y, m - 1, 1)),
      to: toISO(new Date(y, m, 0)),
    },
    ult7: { from: toISO(addDays(today, -6)), to: toISO(today) },
    ult30: { from: toISO(addDays(today, -29)), to: toISO(today) },
    ano: { from: toISO(new Date(y, 0, 1)), to: toISO(today) },
  };
}

/** Filtra transações cuja `date` (ISO) cai em [fromISO, toISO], inclusive. */
export function filterByPeriod(
  txs: Transaction[],
  fromISO: string,
  toISO_: string
): Transaction[] {
  return txs.filter((t) => t.date >= fromISO && t.date <= toISO_);
}

/** Formata um range ISO como "1–20 jul 2026" / "28 jun – 3 jul 2026" / "28 dez 2025 – 3 jan 2026". */
export function formatRange(fromISO: string, toISO_: string): string {
  const f = parseISO(fromISO);
  const t = parseISO(toISO_);
  if (f.y === t.y && f.m === t.m) {
    return `${f.d}–${t.d} ${MES_ABBR[f.m - 1]} ${f.y}`;
  }
  if (f.y === t.y) {
    return `${f.d} ${MES_ABBR[f.m - 1]} – ${t.d} ${MES_ABBR[t.m - 1]} ${f.y}`;
  }
  return `${f.d} ${MES_ABBR[f.m - 1]} ${f.y} – ${t.d} ${MES_ABBR[t.m - 1]} ${t.y}`;
}

// ─── Agrupamento por data ───

export interface DateGroup {
  dateISO: string;
  label: { primary: string; secondary: string };
  income: number;
  expense: number;
  items: Transaction[];
}

/**
 * Agrupa por dia (desc). `today` decide o rótulo "Hoje"/"Ontem" —
 * passado explicitamente pelo componente, nunca calculado aqui.
 * `income`/`expense` são somas em positivo (expense também positivo;
 * o consumidor decide o sinal na exibição) — EXCLUINDO do lado certo
 * (receita ou despesa, por `t.type`) qualquer id presente em
 * `internalTransferIds` quando passado. Aceita tanto o Set legado de
 * transferência interna (src/lib/engine/transfers.ts
 * detectInternalTransfers) quanto o Set unido de `combinedExclusionIds`
 * acima (classifyTransactions: entre contas, compra no cartão, fatura/
 * estorno do cartão, Pix no crédito) — para bater com o resumo do período
 * acima. `items` continua trazendo TODAS as transações do dia (nada some
 * da lista).
 */
export function groupByDate(
  txs: Transaction[],
  today: Date,
  internalTransferIds?: Set<string>
): DateGroup[] {
  const todayISO = toISO(today);
  const yesterdayISO = toISO(addDays(today, -1));
  const isInternal = (t: Transaction) =>
    !!internalTransferIds && internalTransferIds.has(t.id);

  const groups = new Map<string, Transaction[]>();
  for (const t of txs) {
    const arr = groups.get(t.date);
    if (arr) arr.push(t);
    else groups.set(t.date, [t]);
  }

  const dates = [...groups.keys()].sort().reverse();

  return dates.map((dateISO) => {
    const items = groups.get(dateISO)!;
    const income = items
      .filter((t) => t.type === "entrada" && !isInternal(t))
      .reduce((a, t) => a + t.amount, 0);
    const expense = items
      .filter((t) => t.type === "saida" && !isInternal(t))
      .reduce((a, t) => a + t.amount, 0);

    const { d, m } = parseISO(dateISO);
    let primary: string;
    let secondary: string;
    if (dateISO === todayISO) {
      primary = "Hoje";
      secondary = `${d} ${MES_ABBR[m - 1]}`;
    } else if (dateISO === yesterdayISO) {
      primary = "Ontem";
      secondary = `${d} ${MES_ABBR[m - 1]}`;
    } else {
      primary = `${d} ${MES_ABBR[m - 1]}`;
      secondary = "";
    }

    return { dateISO, label: { primary, secondary }, income, expense, items };
  });
}

// ─── Agrupamento por destinatário (description) ───

export interface PayeeGroup {
  payee: string;
  initials: string;
  count: number;
  /** soma líquida (entradas − saídas) do grupo */
  net: number;
  items: Transaction[];
}

function initialsOf(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .replace(/[^\p{Lu}\p{N}]/gu, ""); // mantém iniciais acentuadas ("Érica" → "É")
  return letters || "•";
}

/**
 * Agrupa por destinatário. Quando a transação tem `payeeId` (destinatário
 * cadastrado) e `payeeNames` traz o nome, agrupa pela entidade real de
 * destinatário — de modo que "MARIA" e "Maria" (mesma pessoa cadastrada)
 * caem no mesmo grupo. Enquanto uma transação ainda não estiver vinculada a
 * um payee (antes do backfill / import antigo), cai para `description` como
 * chave — a tela funciona igual antes e depois de cadastrar os destinatários.
 *
 * Ordenado por maior movimentação absoluta (soma de |amount| do grupo), desc.
 * Dentro do grupo, itens ordenados por data desc.
 *
 * @param payeeNames mapa opcional payeeId → nome de exibição do destinatário.
 */
export function groupByPayee(
  txs: Transaction[],
  payeeNames?: Map<string, string>
): PayeeGroup[] {
  // chave de agrupamento: payeeId (prefixado, p/ não colidir com descrições)
  // quando a tx está vinculada a um destinatário; senão a própria descrição.
  const groups = new Map<string, { label: string; items: Transaction[] }>();
  for (const t of txs) {
    const linkedName = t.payeeId ? payeeNames?.get(t.payeeId) : undefined;
    const key = t.payeeId && linkedName ? `id:${t.payeeId}` : t.description;
    const label = linkedName ?? t.description;
    const g = groups.get(key);
    if (g) g.items.push(t);
    else groups.set(key, { label, items: [t] });
  }

  const entries = [...groups.values()].map(({ label, items }) => {
    const sorted = [...items].sort((a, b) => b.date.localeCompare(a.date));
    const net = sorted.reduce(
      (a, t) => a + (t.type === "entrada" ? t.amount : -t.amount),
      0
    );
    const movement = sorted.reduce((a, t) => a + t.amount, 0);
    return {
      payee: label,
      initials: initialsOf(label),
      count: sorted.length,
      net,
      items: sorted,
      _movement: movement,
    };
  });

  entries.sort((a, b) => b._movement - a._movement);

  return entries.map(({ _movement, ...rest }) => rest);
}

// ─── Resumo do período ───

export interface PeriodSummary {
  income: number;
  expense: number;
  balance: number;
  count: number;
  avgSpend: number;
}

/**
 * `expense` é retornado positivo; `balance` = income − expense.
 *
 * `internalTransferIds`, quando passado, exclui do income/expense/avgSpend
 * (do lado certo, por `t.type`) as transações cujo id está no Set — aceita
 * tanto o Set legado de transferência interna (src/lib/engine/transfers.ts
 * detectInternalTransfers) quanto o Set unido de `combinedExclusionIds`
 * acima (classifyTransactions: entre contas — regra do CPF —, compra no
 * cartão — dívida —, fatura/estorno interno do cartão, Pix no crédito).
 * `count` continua contando TODAS as transações do período (inclusive as
 * excluídas) — é "quantos lançamentos existem no período", não "quantos
 * contam pro saldo". Retrocompatível: sem o parâmetro, soma tudo como antes.
 */
export function periodSummary(
  txs: Transaction[],
  internalTransferIds?: Set<string>
): PeriodSummary {
  const isInternal = (t: Transaction) =>
    !!internalTransferIds && internalTransferIds.has(t.id);
  const income = txs
    .filter((t) => t.type === "entrada" && !isInternal(t))
    .reduce((a, t) => a + t.amount, 0);
  const expenseTxs = txs.filter((t) => t.type === "saida" && !isInternal(t));
  const expense = expenseTxs.reduce((a, t) => a + t.amount, 0);
  const avgSpend = expenseTxs.length > 0 ? expense / expenseTxs.length : 0;

  return {
    income,
    expense,
    balance: income - expense,
    count: txs.length,
    avgSpend,
  };
}
