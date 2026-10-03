import { ChevronDown, Landmark } from "lucide-react";
import { formatBRL } from "@/lib/utils";
import type { PatrimonioSummary } from "@/lib/data/dashboard";

/** Cores de marca fixas do mockup (mesma paleta de kpi-cards.tsx, tom "azul"). */
const ICO_BG = "rgba(2,132,199,0.12)";
const ICO_FG = "#0284C7";

/**
 * Coluna 1 do bloco "Visão 360": total em contas bancárias (soma
 * current_balance das contas type=bank COM SALDO POSITIVO — dinheiro de
 * verdade) agrupado por instituição — ex. "Mercado Pago R$ 185,04",
 * "Bradesco R$ 6,84". Instituições com mais de uma conta ficam
 * expansíveis (<details>, sem JS) para mostrar a quebra por conta
 * individual. Contas com saldo NEGATIVO (cheque especial em uso) NÃO
 * entram aqui — aparecem como dívida no card "Cheque especial"
 * (`PatrimonioChequeEspecial`), separado deste.
 */
export function PatrimonioContas({ data }: { data: PatrimonioSummary }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[12px] font-bold text-muted-foreground">
          Contas bancárias
        </span>
        <span
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px]"
          style={{ backgroundColor: ICO_BG, color: ICO_FG }}
        >
          <Landmark className="h-4 w-4" strokeWidth={2.4} />
        </span>
      </div>

      <div className="tabular-nums text-[24px] font-bold leading-tight text-foreground">
        {formatBRL(data.bankTotal)}
      </div>
      <div className="mt-1 text-[12px] font-semibold text-muted-foreground">
        {data.bankGroups.length === 0
          ? "Nenhuma conta bancária conectada"
          : `${data.bankGroups.length} instituição${data.bankGroups.length > 1 ? "ões" : ""}`}
      </div>

      {data.bankGroups.length > 0 && (
        <div className="mt-3">
          {data.bankGroups.map((group) =>
            group.accounts.length > 1 ? (
              <details
                key={group.institution}
                className="group border-b border-dashed border-border py-2 last:border-b-0"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                    <ChevronDown
                      className="h-3 w-3 flex-none text-muted-foreground transition-transform group-open:rotate-180"
                      strokeWidth={2.4}
                    />
                    {group.institution}
                  </span>
                  <span className="tabular-nums text-[13px] font-bold text-foreground">
                    {formatBRL(group.total)}
                  </span>
                </summary>
                <div className="ml-[18px] mt-1.5 space-y-1">
                  {group.accounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground"
                    >
                      <span className="truncate">
                        {acc.name}
                        {acc.isEstimated ? " · estimado" : ""}
                      </span>
                      <span className="tabular-nums flex-none font-semibold">
                        {formatBRL(acc.balance)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <div
                key={group.institution}
                className="flex items-center justify-between gap-2 border-b border-dashed border-border py-2 last:border-b-0"
              >
                <span className="text-[13px] font-bold text-foreground">
                  {group.institution}
                  {group.accounts[0]?.isEstimated && (
                    <span className="ml-1.5 text-[10.5px] font-semibold text-muted-foreground">
                      · estimado
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-[13px] font-bold text-foreground">
                  {formatBRL(group.total)}
                </span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

export default PatrimonioContas;
