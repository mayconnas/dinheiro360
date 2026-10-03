"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Tag, Wand2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/types";

export interface CategoryMenuSuggestion {
  categoryId: string;
  categoryName: string;
}

export interface CategoryMenuProps {
  /** Categorias disponíveis para escolha (já filtradas por kind se aplicável). */
  categories: Category[];
  /** Sugestão a destacar no topo (só faz sentido quando multiCount não está definido, i.e. 1 item). */
  suggestion?: CategoryMenuSuggestion;
  /** Quando definido (>1), o menu assume o modo "aplicar a N itens". */
  multiCount?: number;
  /**
   * Nome do destinatário da transação (modo single apenas) — quando
   * presente, o menu mostra o checkbox "Aplicar a todo(a) <nome>", que
   * muda o resultado de onPick de "só esta transação" para "amarrar o
   * destinatário à categoria" (ver onPick abaixo).
   */
  payeeName?: string;
  /**
   * Chamado quando o usuário escolhe uma categoria. `applyToPayee`
   * reflete o estado do checkbox "Aplicar a todo(a) <payeeName>" no
   * momento do clique — o chamador decide se despacha
   * updateTransactionCategory/bulkUpdateCategory (false) ou
   * applyCategoryToPayeeOfTransaction (true).
   */
  onPick: (categoryId: string, applyToPayee: boolean) => void;
  /** Chamado quando o usuário clica em "Criar regra automática para itens parecidos". Se omitido, a opção não aparece. */
  onCreateRule?: () => void;
  open: boolean;
  onClose: () => void;
  /** Elemento âncora usado para posicionar o popover (getBoundingClientRect). */
  anchor: HTMLElement | null;
}

/**
 * Popover de escolha de categoria. Usa portal + getBoundingClientRect para
 * posicionamento (não há Popover/DropdownMenu do shadcn instalado no projeto).
 */
export function CategoryMenu({
  categories,
  suggestion,
  multiCount,
  payeeName,
  onPick,
  onCreateRule,
  open,
  onClose,
  anchor,
}: CategoryMenuProps) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const [applyToPayee, setApplyToPayee] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reseta o checkbox toda vez que o popover reabre (nunca deve
  // "vazar" o estado marcado de uma transação para a próxima).
  useEffect(() => {
    if (open) setApplyToPayee(false);
  }, [open]);

  const isMulti = (multiCount ?? 0) > 1;
  const title = isMulti ? `Aplicar a ${multiCount} itens` : "Escolher categoria";

  // Sugestão só se aplica ao modo single-item.
  const activeSuggestion = !isMulti ? suggestion : undefined;

  // Checkbox "aplicar a todo o destinatário" só faz sentido no modo
  // single (uma transação por vez) e quando há um nome de destinatário
  // resolvido para ela.
  const showPayeeToggle = !isMulti && !!payeeName;

  const restCategories = useMemo(() => {
    if (!activeSuggestion) return categories;
    return categories.filter((c) => c.id !== activeSuggestion.categoryId);
  }, [categories, activeSuggestion]);

  useLayoutEffect(() => {
    if (!open || !anchor || !popRef.current) return;

    function place() {
      const r = anchor!.getBoundingClientRect();
      const pop = popRef.current!;
      const pw = pop.offsetWidth;
      const ph = pop.offsetHeight;
      let left = r.left;
      let top = r.bottom + 6;
      if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
      if (top + ph > window.innerHeight - 12) top = r.top - ph - 6;
      setPos({ top: Math.max(12, top), left: Math.max(12, left) });
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;

    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (anchor?.contains(target)) return;
      onClose();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, anchor, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={popRef}
      role="menu"
      className={cn(
        "fixed z-50 min-w-[230px] rounded-2xl border border-border bg-card p-2 shadow-lg",
        !pos && "invisible"
      )}
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
    >
      <div className="px-2.5 pb-2 pt-1.5 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>

      {activeSuggestion ? (
        <>
          <button
            type="button"
            role="menuitem"
            onClick={() => onPick(activeSuggestion.categoryId, applyToPayee)}
            className="flex w-full items-center gap-2.5 rounded-lg bg-warning/15 px-2.5 py-2 text-left text-sm font-semibold hover:bg-warning/25"
          >
            <CategoryDot color={findColor(categories, activeSuggestion.categoryId)} />
            <span className="truncate">{activeSuggestion.categoryName}</span>
            <span className="ml-auto flex items-center gap-1 text-[10px] font-extrabold uppercase text-warning">
              <Check className="size-3" />
              sugerido
            </span>
          </button>
          <div className="mx-1 my-1.5 h-px bg-border" />
        </>
      ) : null}

      <div className="max-h-[320px] overflow-y-auto">
        {restCategories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            role="menuitem"
            onClick={() => onPick(cat.id, applyToPayee)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-semibold hover:bg-accent"
          >
            <CategoryDot color={cat.color} />
            <span className="truncate">{cat.name}</span>
          </button>
        ))}
        {restCategories.length === 0 && !activeSuggestion ? (
          <div className="px-2.5 py-3 text-sm text-muted-foreground">
            Nenhuma categoria disponível.
          </div>
        ) : null}
      </div>

      {showPayeeToggle ? (
        <>
          <div className="mx-1 my-1.5 h-px bg-border" />
          <label className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-accent">
            <input
              type="checkbox"
              checked={applyToPayee}
              onChange={(e) => setApplyToPayee(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold">
                <Users className="size-3.5 text-muted-foreground" />
                Aplicar a todo(a) {payeeName}
              </span>
              <span className="text-[11px] font-normal text-muted-foreground">
                Categoriza também os lançamentos passados e futuros deste destinatário.
              </span>
            </span>
          </label>
        </>
      ) : null}

      {onCreateRule ? (
        <>
          <div className="mx-1 my-1.5 h-px bg-border" />
          <button
            type="button"
            role="menuitem"
            onClick={onCreateRule}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Wand2 className="size-[15px]" />
            Criar regra automática para itens parecidos
          </button>
        </>
      ) : null}
    </div>,
    document.body
  );
}

function findColor(categories: Category[], id: string): string {
  return categories.find((c) => c.id === id)?.color ?? "hsl(var(--muted-foreground))";
}

function CategoryDot({ color }: { color: string }) {
  return (
    <span
      className="grid size-[26px] flex-none place-items-center rounded-lg text-white"
      style={{ background: color }}
    >
      <Tag className="size-3.5" />
    </span>
  );
}
