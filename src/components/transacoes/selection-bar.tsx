"use client";

import { Tags, Sparkles, CheckCheck, Trash2, X, BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatBRL } from "@/lib/utils";

export interface SelectionBarProps {
  count: number;
  sum: number;
  onCategorize: () => void;
  /** Abre "Categorizar com Jev" (TypeSafe) com os itens selecionados. Sem ele, o botão não aparece. */
  onCategorizeWithJev?: () => void;
  onCreateRule: () => void;
  onMarkReviewed: () => void;
  onDelete: () => void;
  onClear: () => void;
  className?: string;
}

/**
 * Barra flutuante de ações em massa para a tela de Transações.
 * Fixa no rodapé, centralizada horizontalmente. Renderiza sempre
 * (para permitir a transição de entrada/saída), mas fica com
 * pointer-events desabilitado e translúcida/deslocada quando count=0.
 */
export function SelectionBar({
  count,
  sum,
  onCategorize,
  onCategorizeWithJev,
  onCreateRule,
  onMarkReviewed,
  onDelete,
  onClear,
  className,
}: SelectionBarProps) {
  const visible = count > 0;
  const signedSum = sum > 0 ? `+${formatBRL(sum)}` : sum < 0 ? `−${formatBRL(Math.abs(sum))}` : formatBRL(0);

  return (
    <div
      role="toolbar"
      aria-label="Ações em massa"
      aria-hidden={!visible}
      className={cn(
        "fixed inset-x-0 bottom-6 z-50 flex justify-center px-4",
        "transition-all duration-200 ease-out",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-6 opacity-0",
        className
      )}
    >
      <div
        className={cn(
          "flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-white/10 py-2.5 pl-5 pr-2.5 shadow-2xl",
          "bg-neutral-900 text-neutral-50 dark:bg-neutral-800",
          "sm:flex-nowrap"
        )}
      >
        <span className="whitespace-nowrap text-sm font-semibold">
          {count} selecionada{count === 1 ? "" : "s"}
          <small className="ml-1.5 font-semibold text-neutral-400">{signedSum}</small>
        </span>

        <span className="mx-1 hidden h-6 w-px bg-white/15 sm:block" aria-hidden="true" />

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={onCategorize}
            className="h-8 gap-1.5 rounded-lg bg-emerald-400 px-3 text-xs font-bold text-emerald-950 hover:bg-emerald-300"
          >
            <Tags className="size-3.5" />
            Categorizar como…
          </Button>

          {onCategorizeWithJev && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={onCategorizeWithJev}
              className="h-8 gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-bold text-neutral-50 hover:bg-white/20 hover:text-neutral-50"
            >
              <BrainCircuit className="size-3.5" />
              Jev
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCreateRule}
            className="h-8 gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-bold text-neutral-50 hover:bg-white/20 hover:text-neutral-50"
          >
            <Sparkles className="size-3.5" />
            Criar regra
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onMarkReviewed}
            className="h-8 gap-1.5 rounded-lg bg-white/10 px-3 text-xs font-bold text-neutral-50 hover:bg-white/20 hover:text-neutral-50"
          >
            <CheckCheck className="size-3.5" />
            Marcar revisada
          </Button>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onDelete}
            aria-label="Excluir selecionadas"
            title="Excluir selecionadas"
            className="h-8 w-8 rounded-lg bg-white/10 text-neutral-50 hover:bg-destructive hover:text-destructive-foreground"
          >
            <Trash2 className="size-3.5" />
          </Button>

          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={onClear}
            aria-label="Limpar seleção"
            title="Limpar seleção"
            className="h-8 w-8 rounded-lg text-neutral-300 hover:bg-white/10 hover:text-neutral-50"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
