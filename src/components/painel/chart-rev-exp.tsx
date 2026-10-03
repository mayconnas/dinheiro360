"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  BarController,
  LineController,
  BarElement,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Chart } from "react-chartjs-2";
import { formatBRL } from "@/lib/utils";

ChartJS.register(
  BarController,
  LineController,
  BarElement,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip
);

// Cores fixas do mockup (marca / negativo / neutro-fraco), consistentes nos dois temas.
const COLOR_BRAND = "#10B981"; // receitas
const COLOR_NEG = "#E11D48"; // despesas
const COLOR_FAINT = "#9AA9A1"; // sobra líquida (linha tracejada)
const COLOR_GRID = "#EDF2EF";
const COLOR_BORDER = "#E6ECE8";
const COLOR_MUTED = "#657A70";

const MESES_ABREV = [
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

/** Rótulo curto (3 letras) a partir da chave AAAA-MM, sem depender do locale completo. */
function monthShortLabel(monthKey: string): string {
  const [, m] = monthKey.split("-").map(Number);
  return MESES_ABREV[(m - 1 + 12) % 12];
}

/** Formata valores do eixo Y como o mockup: >=1000 vira "Nk". */
function formatAxisValue(value: number): string {
  return Math.abs(value) >= 1000 ? `${Math.round(value / 1000)}k` : `${value}`;
}

interface HistoryPoint {
  month: string;
  income: number;
  expense: number;
  balance: number;
}

export interface ChartRevExpProps {
  history: HistoryPoint[];
}

/**
 * Gráfico "Receitas × Despesas": barras de receitas (verde) e despesas
 * (vermelho) sobrepostas por uma linha tracejada de sobra líquida, com os
 * últimos meses do histórico financeiro real do usuário.
 */
export function ChartRevExp({ history }: ChartRevExpProps) {
  const labels = useMemo(() => history.map((h) => monthShortLabel(h.month)), [history]);

  const data: ChartData<"bar" | "line", number[], string> = useMemo(
    () => ({
      labels,
      datasets: [
        {
          type: "bar" as const,
          label: "Receitas",
          data: history.map((h) => Math.round(h.income * 100) / 100),
          backgroundColor: COLOR_BRAND,
          borderRadius: 5,
          maxBarThickness: 20,
          order: 2,
        },
        {
          type: "bar" as const,
          label: "Despesas",
          data: history.map((h) => Math.round(h.expense * 100) / 100),
          backgroundColor: COLOR_NEG,
          borderRadius: 5,
          maxBarThickness: 20,
          order: 2,
        },
        {
          type: "line" as const,
          label: "Sobra líquida",
          data: history.map((h) => Math.round(h.balance * 100) / 100),
          borderColor: COLOR_FAINT,
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 0,
          tension: 0.3,
          order: 1,
        },
      ],
    }),
    [history, labels]
  );

  const options: ChartOptions<"bar" | "line"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      font: { family: "inherit", size: 11.5 },
      color: COLOR_MUTED,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatBRL(Number(ctx.raw))}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: COLOR_BORDER },
          ticks: { color: COLOR_MUTED },
        },
        y: {
          grid: { color: COLOR_GRID },
          border: { display: false },
          ticks: {
            color: COLOR_MUTED,
            callback: (value) => formatAxisValue(Number(value)),
          },
        },
      },
    }),
    []
  );

  const hasData = history.length > 0;

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-bold tracking-tight text-foreground">
          Receitas × Despesas
        </h3>
        <span className="text-xs font-semibold text-muted-foreground">
          últimos {history.length} meses
        </span>
      </div>

      <div className="mt-1.5 h-[250px]">
        {hasData ? (
          <Chart type="bar" data={data} options={options} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sem histórico suficiente ainda.
          </div>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-3.5">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <span
            className="h-2.5 w-2.5 flex-none rounded-[3px]"
            style={{ background: COLOR_BRAND }}
          />
          Receitas
        </div>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <span
            className="h-2.5 w-2.5 flex-none rounded-[3px]"
            style={{ background: COLOR_NEG }}
          />
          Despesas
        </div>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <span
            className="h-[3px] w-3.5 flex-none rounded-full"
            style={{ background: COLOR_FAINT }}
          />
          Sobra líquida
        </div>
      </div>
    </div>
  );
}
