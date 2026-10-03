"use client";

import { useMemo } from "react";
import { Chart as ChartJS, ArcElement, Tooltip, type TooltipItem } from "chart.js";
import { Doughnut } from "react-chartjs-2";
import { formatBRL, cn } from "@/lib/utils";
import type { DashboardSpendingCategory } from "@/lib/data/dashboard";

ChartJS.register(ArcElement, Tooltip);

interface ChartCategoriesProps {
  /**
   * Quebra por categoria da visão CONTROLE DE GASTOS (ver
   * `DashboardData.spending.byCategory` em src/lib/data/dashboard.ts) — já
   * inclui compra no cartão (categorizada) e exclui pagamento de fatura
   * (senão dobraria: a fatura é a soma das compras já contadas aqui).
   * Vem pronto do servidor, já ordenado do maior gasto pro menor — este
   * componente só desenha, não reagrega nem reclassifica nada.
   */
  data: DashboardSpendingCategory[];
  /** Total gasto no mês (== `DashboardData.spending.total`). */
  total: number;
  className?: string;
}

interface CategorySlice {
  categoryId: string;
  name: string;
  color: string;
  value: number;
  pct: number;
}

export function ChartCategories({ data, total, className }: ChartCategoriesProps) {
  const slices: CategorySlice[] = useMemo(
    () =>
      data.map((c) => ({
        categoryId: c.categoryId,
        name: c.categoryName,
        color: c.color,
        value: c.total,
        pct: total > 0 ? c.total / total : 0,
      })),
    [data, total]
  );

  if (slices.length === 0) {
    return (
      <div className={cn("rounded-xl border bg-card shadow-sm", className)}>
        <div className="flex items-center justify-between gap-3 px-5 pt-[18px]">
          <h3 className="text-[15px] font-bold tracking-tight text-foreground">
            Gastos por categoria
          </h3>
          <span className="text-xs font-semibold text-muted-foreground">
            {formatBRL(0)} no mês
          </span>
        </div>
        <div className="px-5 pb-5 pt-4">
          <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            Sem gastos categorizados neste mês ainda.
          </div>
        </div>
      </div>
    );
  }

  const chartData = {
    labels: slices.map((s) => s.name),
    datasets: [
      {
        data: slices.map((s) => s.value),
        backgroundColor: slices.map((s) => s.color),
        borderColor: "var(--color-card, #fff)",
        borderWidth: 3,
        hoverOffset: 6,
      },
    ],
  };

  return (
    <div className={cn("rounded-xl border bg-card shadow-sm", className)}>
      <div className="flex items-center justify-between gap-3 px-5 pt-[18px]">
        <h3 className="text-[15px] font-bold tracking-tight text-foreground">
          Gastos por categoria
        </h3>
        <span className="text-xs font-semibold text-muted-foreground">
          {formatBRL(total)} no mês
        </span>
      </div>

      <div className="px-5 pb-5 pt-4">
        <div className="relative h-[250px]">
          <Doughnut
            data={chartData}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              cutout: "68%",
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: {
                    label: (ctx: TooltipItem<"doughnut">) => {
                      const slice = slices[ctx.dataIndex];
                      return `${slice.name}: ${formatBRL(slice.value)} (${Math.round(
                        slice.pct * 100
                      )}%)`;
                    },
                  },
                },
              },
            }}
          />
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-[11px] font-bold text-muted-foreground">Total gasto</div>
            <div className="tabular-nums mt-0.5 text-[22px] font-bold text-foreground">
              {formatBRL(total)}
            </div>
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap gap-3.5">
          {slices.map((s) => (
            <div
              key={s.categoryId}
              className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"
            >
              <span
                className="h-2.5 w-2.5 flex-none rounded-[3px]"
                style={{ backgroundColor: s.color }}
              />
              {s.name} · {Math.round(s.pct * 100)}%
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
