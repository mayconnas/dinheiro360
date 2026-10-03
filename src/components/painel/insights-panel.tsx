// ─────────────────────────────────────────────────────────────
// Bloco "O que o gestor observou" do painel — reproduz o .insight
// do mockup gestor360-painel.html: cards coloridos (neg/warn/info/
// pos) com ícone + texto (título em negrito + detalhe). Gerado a
// partir das flags de anomalia (severity → cor) e, quando a taxa
// de poupança está subindo, um insight positivo extra. Server
// component: só formata e desenha os dados que a página já
// calculou via loadDashboard().
// ─────────────────────────────────────────────────────────────
import { Search, TrendingUp, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { Flag, FlagSeverity } from "@/lib/engine/anomalies";
import type { Indicator } from "@/lib/engine/indicators";
import { formatPercent } from "@/lib/utils";

export interface InsightsPanelProps {
  flags: Flag[];
  indicators: Indicator[];
}

type InsightVariant = "neg" | "warn" | "info" | "pos";

interface InsightItem {
  key: string;
  variant: InsightVariant;
  icon: ReactNode;
  title: string;
  detail: string;
}

/** Cores do bloco .ii (ícone) por variante, iguais ao mockup (funcionam nos dois temas via var CSS quando possível). */
const VARIANT_STYLES: Record<InsightVariant, { bg: string; fg: string }> = {
  neg: { bg: "#FDEAEE", fg: "#E11D48" },
  warn: { bg: "#FEF3E2", fg: "#D97706" },
  info: { bg: "#E6F3FB", fg: "#0284C7" },
  pos: { bg: "#E7F5EF", fg: "#059669" },
};

/** Dark-mode override das cores do .ii, espelhando as vars --*-soft do mockup em [data-theme=dark]. */
const VARIANT_STYLES_DARK: Record<InsightVariant, { bg: string; fg: string }> = {
  neg: { bg: "#2A1119", fg: "#FB7185" },
  warn: { bg: "#2A2110", fg: "#FBBF24" },
  info: { bg: "#0C2029", fg: "#38BDF8" },
  pos: { bg: "#0F241C", fg: "#34D399" },
};

const SEVERITY_TO_VARIANT: Record<FlagSeverity, InsightVariant> = {
  critico: "neg",
  atencao: "warn",
  info: "info",
};

const ICONS: Record<InsightVariant, ReactNode> = {
  neg: <TriangleAlert size={18} strokeWidth={2.2} />,
  warn: <TrendingUp size={18} strokeWidth={2.2} />,
  info: <Search size={18} strokeWidth={2.2} />,
  pos: <TrendingUp size={18} strokeWidth={2.2} />,
};

/**
 * Monta a lista de insights: uma entrada por flag (na ordem já
 * priorizada por detectAnomalies) e, ao final, um insight positivo
 * se a taxa de poupança estiver em tendência de alta.
 */
function buildInsights(flags: Flag[], indicators: Indicator[]): InsightItem[] {
  const items: InsightItem[] = flags.map((flag, idx) => ({
    key: `flag-${idx}-${flag.kind}`,
    variant: SEVERITY_TO_VARIANT[flag.severity],
    icon: ICONS[SEVERITY_TO_VARIANT[flag.severity]],
    title: flag.title,
    detail: flag.detail,
  }));

  const savings = indicators.find((i) => i.key === "taxa_poupanca");
  if (savings && savings.trend === "subindo") {
    items.push({
      key: "insight-taxa-poupanca-subindo",
      variant: "pos",
      icon: ICONS.pos,
      title: `Sua taxa de poupança está subindo (${formatPercent(savings.value)} no mês).`,
      detail:
        "Mantendo esse ritmo, você se aproxima da meta saudável de 20% de poupança sobre a renda.",
    });
  }

  return items;
}

export function InsightsPanel({ flags, indicators }: InsightsPanelProps) {
  const insights = buildInsights(flags, indicators);

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="px-5 py-5">
        {insights.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma observação por enquanto — continue registrando suas transações.
          </p>
        ) : (
          insights.map((item) => {
            const light = VARIANT_STYLES[item.variant];
            const dark = VARIANT_STYLES_DARK[item.variant];
            return (
              <div
                key={item.key}
                className="mb-2.5 flex gap-3 rounded-[13px] border bg-[var(--insight-surface-2,#FBFCFB)] p-3.5 last:mb-0 dark:bg-[#0E1613]"
              >
                <div
                  className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] dark:hidden"
                  style={{ backgroundColor: light.bg, color: light.fg }}
                >
                  {item.icon}
                </div>
                <div
                  className="hidden h-[34px] w-[34px] flex-none place-items-center rounded-[10px] dark:grid"
                  style={{ backgroundColor: dark.bg, color: dark.fg }}
                >
                  {item.icon}
                </div>
                <p className="m-0 self-center text-[12.5px] font-medium text-muted-foreground">
                  <b className="font-bold text-foreground">{item.title}</b> {item.detail}
                </p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
