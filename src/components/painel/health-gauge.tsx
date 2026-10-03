"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Indicator, IndicatorStatus } from "@/lib/engine/indicators";

/** Cores de marca fixas do mockup (funcionam nos dois temas). */
const POS = "#059669";
const WARN = "#D97706";
const NEG = "#E11D48";
const POS_SOFT = "rgba(5,150,105,0.12)";
const WARN_SOFT = "rgba(217,119,6,0.12)";
const NEG_SOFT = "rgba(225,29,72,0.12)";

export interface HealthGaugeProps {
  indicators: Indicator[];
}

/** Pontuação de 0/50/100 por status, usada na média ponderada do placar. */
function statusScore(status: IndicatorStatus): number | null {
  if (status === "bom") return 100;
  if (status === "atencao") return 50;
  if (status === "critico") return 0;
  return null; // sem_dados não entra na média
}

/**
 * Score de 0 a 100: média simples da pontuação dos indicadores com status
 * conhecido (bom=100, atenção=50, crítico=0). Indicadores "sem_dados" são
 * ignorados. Sem nenhum dado disponível, cai no meio da escala (50).
 */
function computeScore(indicators: Indicator[]): number {
  const scores = indicators
    .map((i) => statusScore(i.status))
    .filter((v): v is number => v !== null);
  if (scores.length === 0) return 50;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  return Math.round(Math.min(100, Math.max(0, avg)));
}

function verdictFor(score: number): { label: string; color: string; soft: string; Icon: typeof AlertTriangle } {
  if (score >= 70) return { label: "Saudável — no bom caminho", color: POS, soft: POS_SOFT, Icon: CheckCircle2 };
  if (score >= 40) return { label: "Atenção — reserva frágil", color: WARN, soft: WARN_SOFT, Icon: AlertTriangle };
  return { label: "Crítico — priorize ajustes", color: NEG, soft: NEG_SOFT, Icon: XCircle };
}

/** Nota curta explicando o veredito, com base no indicador mais fraco. */
function noteFor(score: number, weakest: Indicator | undefined): string {
  if (!weakest) {
    return score >= 70
      ? "Seus indicadores estão equilibrados. Continue no ritmo atual."
      : "Ainda não há dados suficientes para uma leitura completa do seu placar.";
  }
  if (score >= 70) {
    return "Você fecha o mês bem posicionado — mantenha o ritmo atual para seguir evoluindo.";
  }
  return `${weakest.hint} O ponto de maior atenção agora é "${weakest.label.toLowerCase()}".`;
}

const STATUS_TAG: Record<IndicatorStatus, { label: string; className: string; fill: string }> = {
  bom: { label: "Saudável", className: "bg-success/15 text-success", fill: POS },
  atencao: { label: "Melhorar", className: "bg-warning/15 text-warning", fill: WARN },
  critico: { label: "Crítico", className: "bg-destructive/15 text-destructive", fill: NEG },
  sem_dados: { label: "Sem dados", className: "bg-muted text-muted-foreground", fill: "#9AA9A1" },
};

interface PillarSpec {
  key: string;
  title: string;
  unitSuffix: string;
  /** Converte o valor bruto do indicador (fração/meses) em texto e % de barra. */
  format: (indicator: Indicator) => { display: string; barPct: number };
}

const PILLARS: PillarSpec[] = [
  {
    key: "reserva_emergencia",
    title: "Reserva de emergência",
    unitSuffix: "mês de despesas",
    format: (i) => ({
      display: i.value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      // referência visual: 6 meses = barra cheia (mesma escala do "bom" do indicador)
      barPct: Math.min(100, Math.max(4, (i.value / 6) * 100)),
    }),
  },
  {
    key: "taxa_poupanca",
    title: "Taxa de poupança",
    unitSuffix: "%",
    format: (i) => ({
      display: (i.value * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      // referência visual: 20% = barra cheia (meta saudável)
      barPct: Math.min(100, Math.max(4, (i.value / 0.2) * 100)),
    }),
  },
  {
    key: "peso_custos_fixos",
    title: "Gasto sobre a renda",
    unitSuffix: "%",
    format: (i) => ({
      display: (i.value * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      barPct: Math.min(100, Math.max(4, i.value * 100)),
    }),
  },
  {
    key: "comprometimento_renda",
    title: "Comprometimento com dívidas",
    unitSuffix: "% da renda",
    format: (i) => ({
      display: (i.value * 100).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
      barPct: Math.min(100, Math.max(4, i.value * 100)),
    }),
  },
];

const FILL_CLASS: Record<IndicatorStatus, string> = {
  bom: "bg-success",
  atencao: "bg-warning",
  critico: "bg-destructive",
  sem_dados: "bg-muted-foreground/40",
};

/**
 * Placar de saúde financeira (bloco ".health" do mockup): gauge SVG 0-100
 * com ponteiro, veredito colorido e nota, ao lado dos 4 pilares (reserva de
 * emergência, taxa de poupança, gasto sobre a renda, comprometimento com
 * dívidas) cada um com barra de progresso e selo de status.
 */
export function HealthGauge({ indicators }: HealthGaugeProps) {
  const score = computeScore(indicators);
  const verdict = verdictFor(score);

  // Indicador mais crítico entre os 4 pilares, para compor a nota.
  const pillarIndicators = PILLARS.map((p) => indicators.find((i) => i.key === p.key)).filter(
    (i): i is Indicator => !!i
  );
  const rank: Record<IndicatorStatus, number> = { critico: 0, atencao: 1, sem_dados: 2, bom: 3 };
  const weakest = [...pillarIndicators].sort((a, b) => rank[a.status] - rank[b.status])[0];
  const note = noteFor(score, weakest);

  // Ângulo do ponteiro: -180deg (score 0) até 0deg (score 100), replicando o mockup.
  const cx = 115;
  const cy = 140;
  const r = 74;
  const angleRad = ((-180 + (score / 100) * 180) * Math.PI) / 180;
  const needleX = cx + r * Math.cos(angleRad);
  const needleY = cy + r * Math.sin(angleRad);

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[340px_1fr]">
      {/* Gauge card */}
      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card px-5 pb-6 pt-[22px] text-center shadow-sm">
        <div className="relative h-[150px] w-[230px]">
          <svg viewBox="0 0 230 150" width="230" height="150">
            <defs>
              <linearGradient id="healthGaugeGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor={NEG} />
                <stop offset="0.5" stopColor={WARN} />
                <stop offset="1" stopColor={POS} />
              </linearGradient>
            </defs>
            <path
              d="M20 140 A95 95 0 0 1 210 140"
              fill="none"
              stroke="var(--grid-track, hsl(var(--muted)))"
              strokeWidth={16}
              strokeLinecap="round"
            />
            <path
              d="M20 140 A95 95 0 0 1 210 140"
              fill="none"
              stroke="url(#healthGaugeGradient)"
              strokeWidth={16}
              strokeLinecap="round"
            />
            <g>
              <line
                x1={cx}
                y1={cy}
                x2={needleX.toFixed(1)}
                y2={needleY.toFixed(1)}
                stroke="hsl(var(--foreground))"
                strokeWidth={3}
                strokeLinecap="round"
              />
              <circle cx={cx} cy={cy} r={6} fill="hsl(var(--foreground))" />
            </g>
          </svg>
          <div className="absolute inset-x-0 top-[58px] text-center">
            <div className="tabular-nums text-[44px] font-bold leading-none text-foreground">{score}</div>
            <div className="text-xs font-semibold text-muted-foreground">de 100 pontos</div>
          </div>
        </div>

        <div
          className="mt-1 inline-flex items-center gap-[7px] rounded-full px-[13px] py-[6px] text-[13px] font-bold"
          style={{ backgroundColor: verdict.soft, color: verdict.color }}
        >
          <verdict.Icon size={14} strokeWidth={2.4} />
          {verdict.label}
        </div>
        <div className="mt-3 max-w-[280px] text-[12.5px] text-muted-foreground">{note}</div>
      </div>

      {/* Pillars card */}
      <div className="rounded-xl border border-border bg-card shadow-sm">
        <div className="grid grid-cols-1 gap-3 p-[18px] sm:grid-cols-2">
          {PILLARS.map((pillar) => {
            const indicator = indicators.find((i) => i.key === pillar.key);
            const status: IndicatorStatus = indicator?.status ?? "sem_dados";
            const tag = STATUS_TAG[status];
            const { display, barPct } = indicator
              ? pillar.format(indicator)
              : { display: "—", barPct: 0 };

            return (
              <div
                key={pillar.key}
                className="rounded-[13px] border border-border bg-muted/40 px-[14px] py-[13px]"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <b className="text-[12.5px] font-bold text-foreground">{pillar.title}</b>
                  <span
                    className={cn(
                      "rounded-md px-2 py-[3px] text-[10.5px] font-extrabold uppercase tracking-[.02em]",
                      tag.className
                    )}
                  >
                    {tag.label}
                  </span>
                </div>
                <div className="tabular-nums text-xl font-bold text-foreground">
                  {display} <small className="text-xs font-semibold text-muted-foreground">{pillar.unitSuffix}</small>
                </div>
                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", FILL_CLASS[status])}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default HealthGauge;
