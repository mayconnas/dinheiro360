import { AlertTriangle } from "lucide-react";
import { formatBRL } from "@/lib/utils";
import type { PatrimonioSummary } from "@/lib/data/dashboard";

/** Cores de marca fixas do mockup (mesma paleta "vermelho" de patrimonio-cartoes.tsx — é dívida). */
const ICO_BG = "rgba(225,29,72,0.12)";
const ICO_FG = "#E11D48";
const NEG = "#E11D48";

/**
 * Card "Cheque especial" do bloco "Visão 360" — só aparece quando alguma
 * conta bank está negativa (`data.overdraft.total > 0`). Mostra como
 * DÍVIDA (vermelho), separada do "Contas bancárias": quando uma conta
 * corrente fica negativa, o banco está cobrindo o buraco com cheque
 * especial — um empréstimo caro — e o próximo dinheiro que cair ali vai
 * pagar essa dívida antes de virar saldo disponível. Ver
 * src/lib/engine/indicators.ts (overdraftUsage) e
 * src/lib/data/dashboard.ts (buildPatrimonio) para a regra que separa
 * saldo negativo do saldo em caixa.
 *
 * Sem o limite do cheque especial (não temos essa coluna ainda — ver
 * comentário de `overdraftUsage`), não dá pra mostrar "% do limite
 * usado" como no card de cartões; mostramos só o valor em uso.
 */
export function PatrimonioChequeEspecial({ data }: { data: PatrimonioSummary }) {
  const { overdraft } = data;

  return (
    <div className="rounded-xl border border-[#E11D48]/30 bg-card p-4 shadow-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[12px] font-bold text-muted-foreground">
          Cheque especial
        </span>
        <span
          className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px]"
          style={{ backgroundColor: ICO_BG, color: ICO_FG }}
        >
          <AlertTriangle className="h-4 w-4" strokeWidth={2.4} />
        </span>
      </div>

      <div className="tabular-nums text-[24px] font-bold leading-tight" style={{ color: NEG }}>
        {formatBRL(overdraft.total)}
      </div>
      <div className="mt-1 text-[12px] font-semibold text-muted-foreground">
        {overdraft.accounts.length === 0
          ? "Nenhuma conta no vermelho"
          : "dívida cara — o próximo dinheiro que entrar paga isso primeiro"}
      </div>

      {overdraft.accounts.length > 0 && (
        <div className="mt-3">
          {overdraft.accounts.map((acc) => (
            <div
              key={acc.id}
              className="flex items-center justify-between gap-2 border-b border-dashed border-border py-2 last:border-b-0"
            >
              <span className="truncate text-[13px] font-bold text-foreground">
                {acc.institution}
                {acc.name !== acc.institution && (
                  <span className="ml-1 font-medium text-muted-foreground">· {acc.name}</span>
                )}
                {acc.isEstimated && (
                  <span className="ml-1.5 text-[10.5px] font-semibold text-muted-foreground">
                    · estimado
                  </span>
                )}
              </span>
              <span className="tabular-nums flex-none text-[13px] font-bold" style={{ color: NEG }}>
                {formatBRL(acc.usado)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default PatrimonioChequeEspecial;
