import type { BudgetLine } from "@/lib/engine/budget";
import { cn } from "@/lib/utils";

interface BudgetListProps {
  budgetLines: BudgetLine[];
}

/** BRL sem casas decimais, como no mockup (BRL0). */
function formatBRL0(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value);
}

/** Cor da barra de progresso conforme % consumido / estouro. */
function fillColor(consumed: number | null, status: BudgetLine["status"]): string {
  if (status === "estourado") return "#E11D48"; // --neg
  if (status === "sem_controle") return "#9AA9A1"; // --faint
  // usa o status "alerta" do motor (limiar oficial de 80%), não um
  // threshold próprio, para bater com a lógica de orçamento do resto do app.
  if (status === "alerta") return "#D97706"; // --warn
  return "#10B981"; // --brand-2
}

/**
 * Lista "Orçamento por categoria" — reproduz o bloco .brow do mockup:
 * nome com marcador colorido, gasto/limite em BRL0 e barra de progresso
 * (verde/âmbar/vermelho conforme % consumido e estouro).
 */
export function BudgetList({ budgetLines }: BudgetListProps) {
  if (budgetLines.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Nenhum orçamento configurado para este mês.
      </p>
    );
  }

  return (
    <div>
      {budgetLines.map((b) => {
        const hasLimit = b.limit !== null && b.limit > 0;
        const pct = b.consumed !== null ? Math.min(b.consumed * 100, 100) : 0;
        const over = b.status === "estourado";
        const fill = fillColor(b.consumed, b.status);

        return (
          <div
            key={b.categoryId}
            className="flex flex-col gap-1.5 border-b border-dashed border-border py-2.5 last:border-b-0"
          >
            <div className="flex items-center justify-between gap-2.5">
              <span className="flex items-center gap-2 text-[13px] font-bold text-foreground">
                <span
                  className="h-[9px] w-[9px] flex-none rounded-[3px]"
                  style={{ backgroundColor: b.color }}
                />
                {b.categoryName}
              </span>
              <span
                className={cn(
                  "text-right text-[12.5px] font-semibold text-muted-foreground tabular-nums",
                  over && "font-semibold"
                )}
                style={over ? { color: "#E11D48" } : undefined}
              >
                <b className="font-bold text-foreground" style={over ? { color: "#E11D48" } : undefined}>
                  {formatBRL0(b.spent)}
                </b>
                {hasLimit ? (
                  <>
                    {" / "}
                    {formatBRL0(b.limit as number)}
                    {over ? " · estourou" : ""}
                  </>
                ) : (
                  " · sem limite"
                )}
              </span>
            </div>
            <div className="h-[7px] overflow-hidden rounded-full bg-[#EDF2EF] dark:bg-[#1B2620]">
              {hasLimit ? (
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, backgroundColor: fill }}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
