import type { ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Landmark,
  Scale,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { formatBRL, formatPercent, cn } from "@/lib/utils";

interface Totals {
  income: number;
  expense: number;
  balance: number;
}

interface HistoryEntry {
  month: string;
  income: number;
  expense: number;
  balance: number;
}

interface KpiCardsProps {
  totals: Totals;
  /**
   * PATRIMÔNIO LÍQUIDO REAL (realNetWorth): caixa + investimentos − dívida
   * de cartão. Pode ser negativo — mostrado em vermelho quando for. NÃO é
   * a mesma coisa que `totals.balance` (sobra do mês, um fluxo).
   */
  netBalance: number;
  /** Saldo em caixa real (realCashBalance): soma SÓ dos saldos POSITIVOS das contas banco/carteira — não inclui cheque especial (saldo negativo), que é dívida, nem desconta cartão. */
  cashBalance: number;
  history: HistoryEntry[];
}

/** Cores de marca fixas do mockup (funcionam nos dois temas). */
const ICO_COLORS = {
  g: { bg: "rgba(5,150,105,0.12)", fg: "#059669" },
  r: { bg: "rgba(225,29,72,0.12)", fg: "#E11D48" },
  b: { bg: "rgba(2,132,199,0.12)", fg: "#0284C7" },
  p: { bg: "rgba(124,58,237,0.12)", fg: "#7C3AED" },
  a: { bg: "rgba(217,119,6,0.12)", fg: "#D97706" },
} as const;

type IcoTone = keyof typeof ICO_COLORS;

const POS = "#059669";
const NEG = "#E11D48";

/** Variação percentual entre dois valores (null se base for 0/indisponível). */
function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

function monthLabelShort(monthKey: string | undefined): string {
  if (!monthKey) return "mês anterior";
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m) return "mês anterior";
  const date = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat("pt-BR", { month: "long" }).format(date);
}

export function KpiCards({ totals, netBalance, cashBalance, history }: KpiCardsProps) {
  const previous = history.length >= 2 ? history[history.length - 2] : undefined;
  const prevLabel = monthLabelShort(previous?.month);

  const incomeDelta = previous ? pctDelta(totals.income, previous.income) : null;
  const expenseDelta = previous ? pctDelta(totals.expense, previous.expense) : null;
  const balanceDelta =
    previous && Number.isFinite(previous.balance) ? totals.balance - previous.balance : null;

  // Patrimônio líquido/saldo em caixa vêm do saldo REAL das contas (foto de
  // agora, via Pluggy), não de soma de transações. NÃO temos série histórica
  // deles nos dados, então NÃO inventamos um "delta no mês" (seria
  // enganoso — daria só a sobra do mês reapresentada).

  return (
    <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5">
      <KpiCard
        label="Receitas do mês"
        icon={<ArrowUpRight className="h-4 w-4" strokeWidth={2.4} />}
        tone="g"
        value={formatBRL(totals.income)}
        delta={<DeltaPercent value={incomeDelta} caption={`vs. ${prevLabel}`} goodDirection="up" />}
      />

      <KpiCard
        label="Despesas do mês"
        icon={<ArrowDownRight className="h-4 w-4" strokeWidth={2.4} />}
        tone="r"
        value={formatBRL(totals.expense)}
        delta={
          <DeltaPercent value={expenseDelta} caption={`vs. ${prevLabel}`} goodDirection="down" />
        }
      />

      <KpiCard
        label="Sobra do mês"
        subtitle="Resultado do mês (fluxo) — não é seu saldo"
        icon={<TrendingUp className="h-4 w-4" strokeWidth={2.4} />}
        tone="g"
        value={formatBRL(totals.balance)}
        valueColor={totals.balance >= 0 ? POS : NEG}
        delta={
          balanceDelta === null ? (
            <span className="text-[12px] font-semibold text-muted-foreground">
              sem comparativo
            </span>
          ) : (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[12px] font-bold",
              )}
              style={{ color: balanceDelta >= 0 ? POS : NEG }}
            >
              {balanceDelta >= 0 ? "▲" : "▼"} {formatBRL(Math.abs(balanceDelta))}
              <span className="font-semibold text-muted-foreground">
                {balanceDelta >= 0 ? `acima de ${prevLabel}` : `abaixo de ${prevLabel}`}
              </span>
            </span>
          )
        }
      />

      <KpiCard
        label="Saldo em caixa"
        subtitle="Dinheiro disponível (não conta cheque especial)"
        icon={<Landmark className="h-4 w-4" strokeWidth={2.4} />}
        tone="a"
        value={formatBRL(cashBalance)}
        valueColor={cashBalance >= 0 ? undefined : NEG}
        delta={
          <span className="text-[12px] font-semibold text-muted-foreground">
            só contas com saldo positivo — cartão e cheque especial ficam de fora
          </span>
        }
      />

      <KpiCard
        label="Patrimônio líquido"
        subtitle="O que você tem menos o que deve"
        icon={<Scale className="h-4 w-4" strokeWidth={2.4} />}
        tone="b"
        value={formatBRL(netBalance)}
        valueColor={netBalance >= 0 ? POS : NEG}
        delta={
          <span className="text-xs font-semibold text-muted-foreground">
            caixa + investimentos − dívida de cartão
          </span>
        }
      />
    </div>
  );
}

function KpiCard({
  label,
  subtitle,
  icon,
  tone,
  value,
  valueColor,
  delta,
}: {
  label: string;
  /** Legenda curta abaixo do rótulo, para desambiguar fluxo vs. saldo (ex "Sobra do mês" x "Patrimônio líquido"). */
  subtitle?: string;
  icon: ReactNode;
  tone: IcoTone;
  value: string;
  valueColor?: string;
  delta: ReactNode;
}) {
  const colors = ICO_COLORS[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div>
          <span className="text-[12px] font-bold text-muted-foreground">{label}</span>
          {subtitle && (
            <p className="mt-0.5 text-[10.5px] font-medium leading-snug text-muted-foreground/80">
              {subtitle}
            </p>
          )}
        </div>
        <span
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px]"
          style={{ backgroundColor: colors.bg, color: colors.fg }}
        >
          {icon}
        </span>
      </div>
      <div
        className="tabular-nums text-[24px] font-bold leading-tight text-foreground"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      <div className="mt-2">{delta}</div>
    </div>
  );
}

function DeltaPercent({
  value,
  caption,
  goodDirection,
}: {
  value: number | null;
  caption: string;
  goodDirection: "up" | "down";
}) {
  if (value === null) {
    return <span className="text-[12px] font-semibold text-muted-foreground">sem comparativo</span>;
  }
  const isUp = value >= 0;
  const isGood = goodDirection === "up" ? isUp : !isUp;
  const color = isGood ? POS : NEG;
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-bold" style={{ color }}>
      <Icon className="h-3 w-3" strokeWidth={2.6} aria-hidden />
      {isUp ? "▲" : "▼"} {formatPercent(Math.abs(value), 1)}
      <span className="font-semibold text-muted-foreground">{caption}</span>
    </span>
  );
}
