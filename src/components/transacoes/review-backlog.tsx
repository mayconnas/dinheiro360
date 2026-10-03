"use client";

import { BrainCircuit, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ReviewBacklogProps {
  /** Número de lançamentos aguardando revisão no período selecionado. */
  count: number;
  /** Chamado ao clicar em "Aplicar sugestões do período". */
  onApplyAll: () => void;
  /** Abre o diálogo "Categorizar com Jev" (TypeSafe) já no escopo "a revisar". Sem ele, o botão não aparece. */
  onCategorizeWithJev?: () => void;
  /** Desabilita o botão (ex: enquanto uma ação está em andamento). */
  pending?: boolean;
  className?: string;
}

/**
 * Banner âmbar exibido no topo da tela de Transações quando existem
 * lançamentos "a revisar" dentro do período selecionado. Só renderiza
 * algo quando `count > 0`.
 */
export function ReviewBacklog({
  count,
  onApplyAll,
  onCategorizeWithJev,
  pending = false,
  className,
}: ReviewBacklogProps) {
  if (count <= 0) return null;

  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning">
          <Sparkles className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-foreground">
            <span>{count}</span>{" "}
            {count === 1
              ? "lançamento aguardando revisão neste período"
              : "lançamentos aguardando revisão neste período"}
          </p>
          <p className="text-sm text-muted-foreground">
            O gestor já sugeriu categorias para a maioria deles. Aceite em
            massa em vez de um por um.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:pl-3">
        {onCategorizeWithJev && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={onCategorizeWithJev}
            className="w-full bg-warning text-warning-foreground hover:bg-warning/90 sm:w-auto"
          >
            <BrainCircuit className="h-4 w-4" />
            Categorizar com Jev
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onApplyAll}
          className="w-full border-warning/50 bg-transparent text-warning hover:bg-warning/15 hover:text-warning sm:w-auto"
        >
          Aplicar sugestões do período
        </Button>
      </div>
    </div>
  );
}
