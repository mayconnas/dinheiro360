import { formatBRL } from "@/lib/utils";
import type { PatrimonioSummary } from "@/lib/data/dashboard";

/** Cores de marca fixas do mockup (mesmas de kpi-cards.tsx). */
const POS = "#059669";
const NEG = "#E11D48";

/**
 * Faixa-resumo do bloco "Visão 360": "Você TEM" (saldo em bancos +
 * investimentos) vs "Você DEVE" (fatura dos cartões + cheque especial em
 * uso) vs o líquido dos dois — a leitura de 3 segundos que o usuário
 * pediu ("bater o olho na saúde financeira"). Puramente derivada de
 * PatrimonioSummary (saldo REAL das contas via Pluggy); não é o mesmo
 * número do KPI "Patrimônio líquido" (que soma o histórico de
 * transações) — por isso o rótulo "Líquido 360" (não "patrimônio
 * líquido") evita confundir os dois.
 *
 * `bankTotal` já vem só com saldos POSITIVOS (contas negativas viraram
 * `overdraft`, uma dívida) — por isso "Você DEVE" soma `overdraft.total`
 * junto com `cardDebtTotal`: cheque especial usado é dívida cara, do
 * mesmo jeito que fatura de cartão, e precisa aparecer aqui pra não sumir
 * do "o que devo".
 */
export function PatrimonioResumo({ data }: { data: PatrimonioSummary }) {
  const tenho = data.bankTotal + data.investmentsTotal;
  const devo = data.cardDebtTotal + data.overdraft.total;
  const liquido = tenho - devo;

  return (
    <div className="flex flex-wrap items-center gap-x-7 gap-y-2.5 rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm">
      <Stat label="Você TEM" value={tenho} color={POS} />
      <span className="hidden h-8 w-px bg-border sm:block" />
      <Stat label="Você DEVE" value={devo} color={devo > 0 ? NEG : undefined} />
      <span className="hidden h-8 w-px bg-border sm:block" />
      <Stat
        label="Líquido 360"
        value={liquido}
        color={liquido >= 0 ? POS : NEG}
        emphasized
      />
    </div>
  );
}

function Stat({
  label,
  value,
  color,
  emphasized,
}: {
  label: string;
  value: number;
  color?: string;
  emphasized?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </span>
      <span
        className="tabular-nums font-bold leading-tight text-foreground"
        style={{
          color: color,
          fontSize: emphasized ? "22px" : "19px",
        }}
      >
        {formatBRL(value)}
      </span>
    </div>
  );
}

export default PatrimonioResumo;
