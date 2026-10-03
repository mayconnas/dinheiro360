"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  Legend,
} from "recharts";
import { formatBRL, monthLabel } from "@/lib/utils";

// Paleta acessível e consistente (categórica).
const PALETTE = [
  "#10b981",
  "#6366f1",
  "#f59e0b",
  "#06b6d4",
  "#ef4444",
  "#a855f7",
  "#ec4899",
  "#f97316",
  "#14b8a6",
  "#64748b",
];

interface HistoryPoint {
  month: string;
  income: number;
  expense: number;
  balance: number;
}

export function HistoryChart({ data }: { data: HistoryPoint[] }) {
  const chartData = data.map((d) => ({
    mes: monthLabel(d.month).split(" de ")[0].slice(0, 3),
    Receitas: Math.round(d.income),
    Despesas: Math.round(d.expense),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis
          dataKey="mes"
          tick={{ fontSize: 12 }}
          stroke="hsl(var(--muted-foreground))"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 11 }}
          stroke="hsl(var(--muted-foreground))"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v / 1000}k`}
        />
        <Tooltip
          formatter={(v: number) => formatBRL(v)}
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            color: "hsl(var(--popover-foreground))",
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Receitas" fill="#10b981" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface CategorySlice {
  name: string;
  value: number;
  color: string;
}

export function CategoryPie({ data }: { data: CategorySlice[] }) {
  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        Sem despesas neste mês ainda.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
        >
          {data.map((slice, i) => (
            <Cell key={i} fill={slice.color || PALETTE[i % PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v: number) => formatBRL(v)}
          contentStyle={{
            background: "hsl(var(--popover))",
            border: "1px solid hsl(var(--border))",
            borderRadius: 8,
            color: "hsl(var(--popover-foreground))",
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
