import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/lib/utils";
import type { PeriodSummary } from "@/lib/transactions/view-helpers";

export interface PeriodSummaryStripProps {
  summary: PeriodSummary;
  className?: string;
}

/** Faixa de 5 cards com o resumo do período (entradas, saídas, saldo, contagem, ticket médio). */
export function PeriodSummaryStrip({ summary, className }: PeriodSummaryStripProps) {
  const { income, expense, balance, count, avgSpend } = summary;
  const balancePositive = balance >= 0;

  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-5",
        className
      )}
    >
      <SummaryCell
        label="Entradas"
        icon={<ArrowUpRight className="h-3.5 w-3.5 text-success" />}
        value={formatBRL(income)}
        valueClassName="text-success"
      />
      <SummaryCell
        label="Saídas"
        icon={<ArrowDownRight className="h-3.5 w-3.5 text-destructive" />}
        value={formatBRL(expense)}
        valueClassName="text-destructive"
      />
      <SummaryCell
        label="Saldo do período"
        value={`${balancePositive ? "+" : "−"} ${formatBRL(Math.abs(balance))}`}
        valueClassName={balancePositive ? "text-success" : "text-destructive"}
      />
      <SummaryCell label="Lançamentos" value={String(count)} />
      <SummaryCell label="Gasto médio" value={formatBRL(avgSpend)} />
    </div>
  );
}

function SummaryCell({
  label,
  value,
  icon,
  valueClassName,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={cn("mt-1 truncate text-lg font-bold tabular-nums", valueClassName)}>
        {value}
      </div>
    </div>
  );
}
