"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  type ChartOptions,
  type TooltipItem,
} from "chart.js";
import { Line } from "react-chartjs-2";
import type { Transaction } from "@/lib/types";
import type { Projection } from "@/lib/engine/projection";
import { formatBRL } from "@/lib/utils";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip);

export interface ChartCashflowProps {
  transactions: Transaction[];
  projection: Projection;
  /** mês exibido, formato AAAA-MM */
  month: string;
  /** data "de hoje", formato ISO AAAA-MM-DD */
  today: string;
}

/**
 * Monta as duas séries do gráfico (saldo realizado dia a dia até hoje, e
 * projeção tracejada até o fim do mês) a partir das transações do mês e da
 * projeção já calculada pelo motor (`projectCashflow`).
 */
function buildSeries(
  transactions: Transaction[],
  projection: Projection,
  month: string,
  today: string
) {
  const totalDays = projection.daysInMonth;
  const currentDay = Math.min(projection.currentDay, totalDays);
  const isCurrentMonth = today.slice(0, 7) === month;

  // Soma líquida (entrada - saída) de cada dia do mês corrente.
  const deltaByDay = new Array<number>(totalDays + 1).fill(0);
  for (const tx of transactions) {
    if (tx.isDuplicate) continue;
    if (tx.date.slice(0, 7) !== month) continue;
    const day = Number(tx.date.slice(8, 10));
    if (day < 1 || day > totalDays) continue;
    deltaByDay[day] += tx.type === "entrada" ? tx.amount : -tx.amount;
  }

  const days = Array.from({ length: totalDays }, (_, i) => i + 1);

  // Série realizada: saldo acumulado dia a dia, só até "hoje" (ou até o fim
  // do mês inteiro, se o mês não é o corrente).
  const realizedEnd = isCurrentMonth ? currentDay : totalDays;
  const realized: (number | null)[] = [];
  let running = 0;
  for (const day of days) {
    if (day <= realizedEnd) {
      running += deltaByDay[day];
      realized.push(running);
    } else {
      realized.push(null);
    }
  }
  const realizedToday = realized[realizedEnd - 1] ?? 0;

  // Série projetada: tracejada, do ponto de hoje até o fechamento do mês,
  // interpolando linearmente até `projectedMonthEnd`.
  const projected: (number | null)[] = days.map(() => null);
  if (isCurrentMonth && realizedEnd < totalDays) {
    const span = totalDays - realizedEnd;
    for (let day = realizedEnd; day <= totalDays; day++) {
      const progress = (day - realizedEnd) / span;
      const value =
        realizedToday + (projection.projectedMonthEnd - realizedToday) * progress;
      projected[day - 1] = value;
    }
  } else if (isCurrentMonth && realizedEnd === totalDays) {
    // mês já fechou hoje: nenhum trecho projetado a desenhar
  }

  return { days, realized, projected };
}

export function ChartCashflow({
  transactions,
  projection,
  month,
  today,
}: ChartCashflowProps) {
  const { days, realized, projected } = useMemo(
    () => buildSeries(transactions, projection, month, today),
    [transactions, projection, month, today]
  );

  const data = useMemo(
    () => ({
      labels: days,
      datasets: [
        {
          label: "Realizado até hoje",
          data: realized,
          borderColor: "#10B981",
          backgroundColor: "#10B981",
          borderWidth: 2.5,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          spanGaps: false,
        },
        {
          label: "Projeção até o fim",
          data: projected,
          borderColor: "#9AA9A1",
          backgroundColor: "#9AA9A1",
          borderWidth: 2,
          borderDash: [5, 4],
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          spanGaps: false,
        },
      ],
    }),
    [days, realized, projected]
  );

  const options = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items: TooltipItem<"line">[]) => `Dia ${items[0]?.label ?? ""}`,
            label: (item: TooltipItem<"line">) => {
              const raw = item.raw;
              if (raw === null || raw === undefined) return "";
              return `${item.dataset.label}: ${formatBRL(Number(raw))}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: "rgba(148, 163, 158, 0.3)" },
          ticks: { maxTicksLimit: 8 },
        },
        y: {
          grid: { color: "rgba(148, 163, 158, 0.15)" },
          border: { display: false },
          ticks: {
            callback: (value) =>
              typeof value === "number" && Math.abs(value) >= 1000
                ? `${Math.round(value / 1000)}k`
                : value,
          },
        },
      },
    }),
    []
  );

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 pt-[18px]">
        <h3 className="text-[15px] font-bold tracking-tight text-card-foreground">
          Saldo do mês (real × projetado)
        </h3>
        <span className="text-xs font-semibold text-muted-foreground">
          {monthDayHint(month)}
        </span>
      </div>
      <div className="px-5 pb-5 pt-4">
        <div className="h-[270px]">
          <Line data={data} options={options} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-3.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: "#10B981" }}
            />
            Realizado até hoje
          </div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: "#9AA9A1" }}
            />
            Projeção até o fim
          </div>
        </div>
      </div>
    </div>
  );
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function monthDayHint(month: string): string {
  const [, m] = month.split("-").map(Number);
  const name = MONTH_NAMES[(m ?? 1) - 1] ?? "";
  return `${name}, dia a dia`;
}
