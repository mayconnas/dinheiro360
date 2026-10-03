// ─────────────────────────────────────────────────────────────
// Bloco "Projeção de fechamento" do painel — reproduz o .proj do
// mockup gestor360-painel.html: 3 células (sobra projetada com
// barra de "runway" + marcador de hoje, disponível por dia, dias
// restantes). Server component: só formata e desenha os dados
// que a página já calculou via loadDashboard().
// ─────────────────────────────────────────────────────────────
import { formatBRL, monthLabel } from "@/lib/utils";
import type { Projection } from "@/lib/engine/projection";

export interface ProjectionCardProps {
  projection: Projection;
  /**
   * true quando o mês exibido já fechou (é anterior ao mês corrente).
   * `projection` já vem calculada como "100% realizado" nesse caso
   * (projectCashflow trata `today` fora do mês como mês inteiro decorrido),
   * então aqui é só ajustar os rótulos: nada de falar em "projeção" ou
   * "hoje" para um mês que já passou.
   */
  isClosedMonth?: boolean;
}

export function ProjectionCard({ projection, isClosedMonth = false }: ProjectionCardProps) {
  const {
    projectedMonthEnd,
    dailyAllowance,
    daysRemaining,
    currentDay,
    daysInMonth,
    signal,
    month,
  } = projection;

  const isPositive = signal === "verde";
  const pctElapsed = daysInMonth > 0
    ? Math.min(100, Math.max(0, (currentDay / daysInMonth) * 100))
    : 0;

  const closingLabel = closingDateLabel(month, daysInMonth);
  const monthFirstWord = monthLabel(month).split(" de ")[0];

  return (
    <div className="rounded-xl border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-[18px]">
        <h3 className="m-0 text-[15px] font-bold tracking-tight">
          {isClosedMonth
            ? `Como ${monthFirstWord} terminou`
            : `Como ${monthFirstWord} deve terminar`}
        </h3>
        <span className="text-xs font-semibold text-muted-foreground">
          {isClosedMonth
            ? "resultado realizado do mês (já fechado)"
            : "baseado no seu ritmo de gasto e receitas fixas previstas"}
        </span>
      </div>

      <div className="px-5 pb-5 pt-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.4fr_1fr_1fr] sm:gap-0">
          {/* Célula 1: sobra (projetada ou realizada) + runway */}
          <div className="border-b pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6">
            <div className="mb-1.5 text-xs font-bold text-muted-foreground">
              {isClosedMonth ? "Sobra no fim do mês" : "Sobra projetada no fim do mês"}
            </div>
            <div
              className="tabular-nums text-[26px] font-bold"
              style={{ color: isPositive ? "#059669" : "#E11D48" }}
            >
              {isPositive ? "+ " : "− "}
              {formatBRL(Math.abs(projectedMonthEnd))}
            </div>
            <div className="mt-1 text-xs font-semibold text-muted-foreground">
              {isClosedMonth ? "resultado final do mês" : "se mantiver o ritmo atual de gastos"}
            </div>

            <div className="relative mt-3.5 h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${pctElapsed}%`,
                  background: "linear-gradient(90deg, #10B981, #059669)",
                }}
              />
              {!isClosedMonth && (
                <span
                  className="absolute -top-[3px] -bottom-[3px] w-[2px] bg-foreground/50"
                  style={{ left: `${pctElapsed}%` }}
                />
              )}
            </div>
            <div className="mt-1 text-xs font-semibold text-muted-foreground">
              {isClosedMonth
                ? "mês encerrado (100% percorrido)"
                : `${Math.round(pctElapsed)}% do mês percorrido · marcador = hoje`}
            </div>
          </div>

          {/* Célula 2: disponível por dia */}
          <div className="border-b pb-3 sm:border-b-0 sm:border-r sm:px-6 sm:pb-0">
            <div className="mb-1.5 text-xs font-bold text-muted-foreground">
              Disponível por dia
            </div>
            <div className="tabular-nums text-[26px] font-bold">
              {isClosedMonth || dailyAllowance == null ? "—" : formatBRL(dailyAllowance)}
            </div>
            <div className="mt-1 text-xs font-semibold text-muted-foreground">
              {isClosedMonth ? "não se aplica a mês fechado" : "para não estourar o orçamento"}
            </div>
          </div>

          {/* Célula 3: dias restantes */}
          <div className="sm:pl-6">
            <div className="mb-1.5 text-xs font-bold text-muted-foreground">
              {isClosedMonth ? "Dias no mês" : "Dias restantes"}
            </div>
            <div className="tabular-nums text-[26px] font-bold">
              {isClosedMonth ? daysInMonth : daysRemaining}
            </div>
            <div className="mt-1 text-xs font-semibold text-muted-foreground">
              {isClosedMonth ? `encerrado em ${closingLabel}` : `até o fechamento (${closingLabel})`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Data (dd/mm) do último dia do mês, a partir da chave AAAA-MM. */
function closingDateLabel(month: string, totalDays: number): string {
  const [, m] = month.split("-");
  return `${String(totalDays).padStart(2, "0")}/${m}`;
}
