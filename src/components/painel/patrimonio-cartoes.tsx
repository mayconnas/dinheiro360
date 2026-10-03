import { CreditCard } from "lucide-react";
import { formatBRL, formatPercent } from "@/lib/utils";
import type { PatrimonioSummary } from "@/lib/data/dashboard";

/** Cores de marca fixas do mockup (mesma paleta de kpi-cards.tsx, tom "vermelho" — é dívida). */
const ICO_BG = "rgba(225,29,72,0.12)";
const ICO_FG = "#E11D48";
const NEG = "#E11D48";
const WARN = "#D97706";
const POS = "#059669";

/** Cor da barra de utilização do limite, mesmo padrão de fillColor em budget-list.tsx. */
function utilizationColor(pct: number): string {
  if (pct >= 0.8) return NEG;
  if (pct >= 0.5) return WARN;
  return POS;
}

/**
 * Coluna 2 do bloco "Visão 360": total DEVIDO nos cartões (soma
 * current_balance das contas type=credit — a dívida, não uma despesa de
 * fluxo de caixa), % do limite utilizado e lista por cartão — ex.
 * "gold ****6163 R$ 1.582,48".
 */
export function PatrimonioCartoes({ data }: { data: PatrimonioSummary }) {
  const pct = data.cardUtilizationPct;
  const pctClamped = pct !== null ? Math.min(Math.max(pct, 0), 1) : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[12px] font-bold text-muted-foreground">
          Cartões de crédito
        </span>
        <span
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px]"
          style={{ backgroundColor: ICO_BG, color: ICO_FG }}
        >
          <CreditCard className="h-4 w-4" strokeWidth={2.4} />
        </span>
      </div>

      <div className="tabular-nums text-[24px] font-bold leading-tight" style={{ color: data.cardDebtTotal > 0 ? NEG : undefined }}>
        {formatBRL(data.cardDebtTotal)}
      </div>
      <div className="mt-1 text-[12px] font-semibold text-muted-foreground">
        {data.cardLimitTotal > 0
          ? `de ${formatBRL(data.cardLimitTotal)} de limite total`
          : data.cards.length === 0
          ? "Nenhum cartão conectado"
          : "limite total não informado"}
      </div>

      {pct !== null && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
            <span>Limite utilizado</span>
            <span className="tabular-nums font-bold" style={{ color: utilizationColor(pct) }}>
              {formatPercent(pct, 0)}
            </span>
          </div>
          <div className="h-[7px] overflow-hidden rounded-full bg-[#EDF2EF] dark:bg-[#1B2620]">
            <div
              className="h-full rounded-full"
              style={{ width: `${pctClamped * 100}%`, backgroundColor: utilizationColor(pct) }}
            />
          </div>
        </div>
      )}

      {data.cards.length > 0 && (
        <div className="mt-3">
          {data.cards.map((card) => (
            <div
              key={card.id}
              className="flex items-center justify-between gap-2 border-b border-dashed border-border py-2 last:border-b-0"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-bold text-foreground">
                <span className="truncate">{card.name}</span>
                {card.last4 && (
                  <span className="flex-none font-mono text-[11px] font-semibold text-muted-foreground">
                    ····{card.last4}
                  </span>
                )}
                {card.brand && (
                  <span className="flex-none rounded-md bg-muted px-1.5 py-[1px] text-[9.5px] font-extrabold uppercase tracking-wide text-muted-foreground">
                    {card.brand}
                  </span>
                )}
              </span>
              <span
                className="tabular-nums flex-none text-[13px] font-bold"
                style={{ color: card.balance > 0 ? NEG : undefined }}
              >
                {formatBRL(card.balance)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PatrimonioCartoes;
