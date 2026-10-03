import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatBRL, cn } from "@/lib/utils";
import type { Transaction, Category } from "@/lib/types";

interface RecentTxProps {
  transactions: Transaction[];
  categories: Category[];
}

/** Cores de marca fixas do mockup (funcionam nos dois temas). */
const POS = "#059669";

/** Data curta no padrão do mockup: "19 jul" (sem "de", sem ano, sem ponto). */
function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const month = new Intl.DateTimeFormat("pt-BR", { month: "short" })
    .format(date)
    .replace(".", "");
  return `${String(d).padStart(2, "0")} ${month}`;
}

/** Nome da categoria a partir do id, com fallback para transações sem categoria. */
function categoryName(categoryId: string | null, categories: Category[]): string {
  if (!categoryId) return "Sem categoria";
  return categories.find((c) => c.id === categoryId)?.name ?? "Sem categoria";
}

export function RecentTx({ transactions, categories }: RecentTxProps) {
  const items = transactions.slice(0, 6);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 px-5 pt-[18px]">
        <h3 className="text-[15px] font-bold tracking-tight text-foreground">
          Últimas transações
        </h3>
        <span className="text-[12px] font-semibold text-muted-foreground">ver todas →</span>
      </div>
      <div className="px-5 pb-5 pt-4">
        {items.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] font-medium text-muted-foreground">
            Nenhuma transação registrada ainda.
          </p>
        ) : (
          items.map((tx, idx) => {
            const isEntrada = tx.type === "entrada";
            const Icon = isEntrada ? ArrowUpRight : ArrowDownRight;
            return (
              <div
                key={tx.id}
                className={cn(
                  "flex items-center gap-3 py-[11px]",
                  idx !== items.length - 1 && "border-b border-border"
                )}
              >
                <div className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[10px] border border-border bg-muted/40">
                  <Icon
                    className={cn("h-4 w-4", !isEntrada && "text-muted-foreground")}
                    strokeWidth={2.2}
                    style={isEntrada ? { color: POS } : undefined}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[13px] font-bold text-foreground">
                    {tx.description}
                  </b>
                  <small className="flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
                    <span className="rounded-md border border-border bg-muted/40 px-[7px] py-[2px] text-[10.5px] font-bold text-muted-foreground">
                      {categoryName(tx.categoryId, categories)}
                    </span>
                    · {formatShortDate(tx.date)}
                  </small>
                </div>
                <div
                  className={cn(
                    "tabular-nums whitespace-nowrap text-[13.5px] font-bold",
                    !isEntrada && "text-foreground"
                  )}
                  style={isEntrada ? { color: POS } : undefined}
                >
                  {isEntrada ? "+ " : "- "}
                  {formatBRL(Math.abs(tx.amount))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
