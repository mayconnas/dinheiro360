import { TrendingUp } from "lucide-react";
import { formatBRL } from "@/lib/utils";
import type { PatrimonioSummary } from "@/lib/data/dashboard";

/** Cores de marca fixas do mockup (mesma paleta de kpi-cards.tsx, tom "roxo"). */
const ICO_BG = "rgba(124,58,237,0.12)";
const ICO_FG = "#7C3AED";

/**
 * Coluna 3 do bloco "Visão 360": total em investimentos (soma
 * current_balance das contas type=investment). Sem contas do tipo
 * conectadas, mostra R$ 0,00 num estado vazio elegante em vez de
 * esconder a coluna — mantém a simetria das 3 colunas do bloco.
 */
export function PatrimonioInvestimentos({ data }: { data: PatrimonioSummary }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[12px] font-bold text-muted-foreground">
          Investimentos
        </span>
        <span
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px]"
          style={{ backgroundColor: ICO_BG, color: ICO_FG }}
        >
          <TrendingUp className="h-4 w-4" strokeWidth={2.4} />
        </span>
      </div>

      <div className="tabular-nums text-[24px] font-bold leading-tight text-foreground">
        {formatBRL(data.investmentsTotal)}
      </div>
      <div className="mt-1 text-[12px] font-semibold text-muted-foreground">
        {data.investments.length === 0
          ? "Nenhum investimento conectado ainda"
          : `${data.investments.length} conta${data.investments.length > 1 ? "s" : ""}`}
      </div>

      {data.investments.length === 0 ? (
        <p className="mt-4 py-3 text-center text-[12px] text-muted-foreground">
          Conecte uma corretora ou conta de investimento para acompanhar aqui.
        </p>
      ) : (
        <div className="mt-3">
          {data.investments.map((inv) => (
            <div
              key={inv.id}
              className="flex items-center justify-between gap-2 border-b border-dashed border-border py-2 last:border-b-0"
            >
              <span className="truncate text-[13px] font-bold text-foreground">
                {inv.institution}
              </span>
              <span className="tabular-nums flex-none text-[13px] font-bold text-foreground">
                {formatBRL(inv.balance)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PatrimonioInvestimentos;
