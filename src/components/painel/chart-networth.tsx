"use client";

import { useMemo, useRef } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type ScriptableContext,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { formatBRL, monthLabel } from "@/lib/utils";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

interface HistoryPoint {
  month: string;
  income: number;
  expense: number;
  balance: number;
}

interface ChartNetWorthProps {
  history: HistoryPoint[];
  netBalance: number;
}

/** Rótulo curto de mês (3 letras), ex: "jul", a partir da chave AAAA-MM. */
function shortMonthLabel(monthKey: string): string {
  return monthLabel(monthKey).split(" de ")[0].slice(0, 3);
}

/**
 * Monta uma série mensal de patrimônio líquido a partir do histórico de
 * saldo mensal (receita - despesa). Como só temos o patrimônio ATUAL,
 * reconstruímos os pontos anteriores subtraindo, de trás para frente, o
 * saldo (balance) de cada mês a partir do valor mais recente:
 * patrimônio(mês anterior) = patrimônio(mês) - balance(mês).
 * O último ponto da série é sempre o netBalance real e atual.
 */
function buildNetWorthSeries(
  history: HistoryPoint[],
  netBalance: number
): { labels: string[]; values: number[] } {
  if (history.length === 0) {
    return { labels: [], values: [netBalance] };
  }

  const values = new Array<number>(history.length);
  values[history.length - 1] = netBalance;
  for (let i = history.length - 1; i > 0; i--) {
    values[i - 1] = values[i] - history[i].balance;
  }

  return {
    labels: history.map((h) => shortMonthLabel(h.month)),
    values,
  };
}

export function ChartNetWorth({ history, netBalance }: ChartNetWorthProps) {
  const chartRef = useRef<ChartJS<"line">>(null);

  const { labels, values } = useMemo(
    () => buildNetWorthSeries(history, netBalance),
    [history, netBalance]
  );

  const monthsCount = history.length || 1;

  const data: ChartData<"line"> = useMemo(
    () => ({
      labels,
      datasets: [
        {
          data: values,
          borderColor: "#059669",
          borderWidth: 2.5,
          fill: true,
          backgroundColor: (context: ScriptableContext<"line">) => {
            const { ctx, chartArea } = context.chart;
            if (!chartArea) return "rgba(5, 150, 105, 0)";
            const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
            gradient.addColorStop(0, "rgba(16, 185, 129, 0.28)");
            gradient.addColorStop(1, "rgba(16, 185, 129, 0)");
            return gradient;
          },
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#059669",
          pointHoverBorderColor: "#ffffff",
          pointHoverBorderWidth: 2,
        },
      ],
    }),
    [labels, values]
  );

  const options: ChartOptions<"line"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#111A16",
          titleColor: "#E9F0EC",
          bodyColor: "#E9F0EC",
          padding: 10,
          cornerRadius: 8,
          displayColors: false,
          callbacks: {
            label: (ctx) => formatBRL(Number(ctx.raw)),
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: "#8DA096", font: { size: 11.5 } },
        },
        y: {
          grid: { color: "rgba(148, 163, 158, 0.18)" },
          border: { display: false },
          ticks: {
            color: "#8DA096",
            font: { size: 11.5 },
            callback: (value) => {
              const n = Number(value);
              return Math.abs(n) >= 1000 ? `${(n / 1000).toLocaleString("pt-BR")}k` : n;
            },
          },
        },
      },
    }),
    []
  );

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 pt-[18px]">
        <h3 className="text-[15px] font-bold tracking-tight text-foreground">
          Evolução do patrimônio líquido
        </h3>
        <span className="text-xs font-semibold text-muted-foreground">
          {monthsCount} {monthsCount === 1 ? "mês" : "meses"} · {formatBRL(netBalance)}
        </span>
      </div>
      <div className="px-5 pb-5 pt-4">
        <div className="h-[270px]">
          <Line ref={chartRef} data={data} options={options} />
        </div>
      </div>
    </div>
  );
}

export default ChartNetWorth;
