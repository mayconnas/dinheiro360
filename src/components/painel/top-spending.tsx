import { formatBRL } from "@/lib/utils";
import type { DashboardSpendingCategory } from "@/lib/data/dashboard";

interface TopSpendingProps {
  /**
   * Quebra por categoria da visão CONTROLE DE GASTOS (ver
   * `DashboardData.spending.byCategory`), já ordenada do maior gasto pro
   * menor — inclui compra no cartão categorizada, exclui pagamento de
   * fatura (senão dobraria a contagem das compras que a formaram).
   */
  data: DashboardSpendingCategory[];
}

/**
 * Ranking "Maiores gastos do mês" — reproduz o bloco .rank do mockup:
 * número de posição, nome da categoria, barra proporcional ao maior
 * gasto e valor em BRL. Top 5 de `data`, que já vem ordenada.
 */
export function TopSpending({ data }: TopSpendingProps) {
  const items = data.slice(0, 5);
  const max = items[0]?.total ?? 0;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 pt-[18px]">
        <h3 className="text-[15px] font-bold tracking-tight text-foreground">
          Maiores gastos do mês
        </h3>
        <span className="text-[12px] font-semibold text-muted-foreground">top 5</span>
      </div>
      <div className="px-5 pb-5 pt-4">
        {items.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] font-medium text-muted-foreground">
            Nenhum gasto categorizado neste mês.
          </p>
        ) : (
          items.map((item, idx) => {
            const pct = max > 0 ? (item.total / max) * 100 : 0;
            return (
              <div
                key={item.categoryId}
                className="flex items-center gap-3 border-b border-border py-2.5 last:border-b-0"
              >
                <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] border border-border bg-muted/40 text-[11px] font-extrabold text-muted-foreground">
                  {idx + 1}
                </span>
                <span className="flex-1 truncate text-[13px] font-semibold text-foreground">
                  {item.categoryName}
                </span>
                <span className="h-[6px] w-[36%] flex-none overflow-hidden rounded-full bg-[#EDF2EF] dark:bg-[#1B2620]">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: item.color || "#10B981" }}
                  />
                </span>
                <span className="w-[82px] flex-none text-right text-[12.5px] font-bold tabular-nums text-foreground">
                  {formatBRL(item.total)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
