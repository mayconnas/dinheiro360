"use client";

import * as React from "react";
import { Check, ChevronDown, Tags, AlertTriangle, Building2, CreditCard, PiggyBank } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/types";

export type StatusFilter = "todas" | "revisar" | "entradas" | "saidas";

/**
 * Uma opção de banco/conta no filtro: o id da conta + o rótulo de exibição
 * (já resolvido pelo chamador — ver bankOptions em transactions-view.tsx,
 * que usa `institution`/`cardLast4` quando disponíveis e cai para o `name`
 * cru quando não).
 */
export interface BankOption {
  id: string;
  name: string;
  /**
   * Grupo pra seção do dropdown — separa CONTAS de CARTÕES (e
   * investimentos), pra não misturar "Mercado Pago" (conta) com
   * "Mercado Pago" (cartão) como se fossem a mesma coisa. Opcional: se
   * ausente, ou se todas as opções caem no mesmo grupo, o dropdown
   * renderiza uma lista simples sem cabeçalhos de seção (fallback
   * gracioso pra quando o chamador não tem essa info).
   */
  group?: "conta" | "cartao" | "investimento" | "outra";
}

const BANK_GROUP_LABELS: Record<NonNullable<BankOption["group"]>, string> = {
  conta: "Contas",
  cartao: "Cartões",
  investimento: "Investimentos",
  outra: "Outras",
};

const BANK_GROUP_ORDER: NonNullable<BankOption["group"]>[] = [
  "conta",
  "cartao",
  "investimento",
  "outra",
];

function bankGroupIcon(group: BankOption["group"]) {
  if (group === "cartao") return <CreditCard className="size-3.5" />;
  if (group === "investimento") return <PiggyBank className="size-3.5" />;
  return <Building2 className="size-3.5" />;
}

export interface FilterChipsProps {
  counts: {
    todas: number;
    revisar: number;
    entradas: number;
    saidas: number;
  };
  categories: Category[];
  categoryCounts: Record<string, number>;
  activeStatus: StatusFilter;
  activeCategory: string | null;
  onStatus: (status: StatusFilter) => void;
  onCategory: (categoryId: string | null) => void;
  /** Bancos/contas disponíveis para filtrar (opcional). */
  banks?: BankOption[];
  /** Contagem de lançamentos por accountId no período. */
  bankCounts?: Record<string, number>;
  /** accountId ativo no filtro, ou null (todos). */
  activeBank?: string | null;
  onBank?: (accountId: string | null) => void;
}

const STATUS_OPTIONS: { key: StatusFilter; label: string }[] = [
  { key: "todas", label: "Todas" },
  { key: "revisar", label: "A revisar" },
  { key: "entradas", label: "Entradas" },
  { key: "saidas", label: "Saídas" },
];

/** Sentinel usado para representar "A revisar" dentro do dropdown de categoria. */
const REVIEW_SENTINEL = "__revisar";

export function FilterChips({
  counts,
  categories,
  categoryCounts,
  activeStatus,
  activeCategory,
  onStatus,
  onCategory,
  banks,
  bankCounts,
  activeBank = null,
  onBank,
}: FilterChipsProps) {
  const [open, setOpen] = React.useState(false);
  const [bankOpen, setBankOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const bankRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  React.useEffect(() => {
    if (!bankOpen) return;
    function handleClick(e: MouseEvent) {
      if (bankRef.current && !bankRef.current.contains(e.target as Node)) {
        setBankOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setBankOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [bankOpen]);

  const activeBankLabel = React.useMemo(() => {
    if (!activeBank) return "Banco";
    return banks?.find((b) => b.id === activeBank)?.name ?? "Banco";
  }, [activeBank, banks]);

  /**
   * Seções do dropdown de banco. Só separa em "Contas"/"Cartões"/... quando
   * há de fato mais de um grupo distinto entre as opções — uma lista com só
   * contas (ou sem `group` informado) continua um dropdown simples, sem
   * cabeçalho redundante.
   */
  const bankGroups = React.useMemo(() => {
    if (!banks || banks.length === 0) return [];
    const distinct = new Set(banks.map((b) => b.group ?? "outra"));
    if (distinct.size <= 1) return [{ label: null as string | null, items: banks }];
    return BANK_GROUP_ORDER.map((g) => ({
      label: BANK_GROUP_LABELS[g],
      items: banks.filter((b) => (b.group ?? "outra") === g),
    })).filter((g) => g.items.length > 0);
  }, [banks]);

  const activeCategoryLabel = React.useMemo(() => {
    if (activeCategory === REVIEW_SENTINEL) return "A revisar";
    if (!activeCategory) return "Categoria";
    return categories.find((c) => c.id === activeCategory)?.name ?? "Categoria";
  }, [activeCategory, categories]);

  const categoryChipActive = activeCategory !== null;

  function handleSelectCategory(value: string | null) {
    onCategory(value);
    setOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {STATUS_OPTIONS.map(({ key, label }) => {
        const isActive = activeStatus === key;
        const isWarn = key === "revisar";
        return (
          <button
            key={key}
            type="button"
            onClick={() => onStatus(key)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors",
              isActive
                ? isWarn
                  ? "border-warning bg-warning text-warning-foreground"
                  : "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            )}
          >
            {label}
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                isActive
                  ? isWarn
                    ? "bg-white/25 text-warning-foreground"
                    : "bg-background/20 text-background"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {counts[key]}
            </span>
          </button>
        );
      })}

      <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />

      <div className="relative" ref={containerRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors",
            categoryChipActive
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
          )}
        >
          <Tags className="size-3.5" />
          {activeCategoryLabel}
          <ChevronDown className="size-3 opacity-60" />
        </button>

        {open && (
          <div className="absolute left-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
            <div className="max-h-80 overflow-y-auto p-1">
              <CategoryOption
                label="Todas as categorias"
                count={counts.todas}
                active={activeCategory === null}
                onClick={() => handleSelectCategory(null)}
              />
              <CategoryOption
                label="A revisar"
                count={counts.revisar}
                active={activeCategory === REVIEW_SENTINEL}
                onClick={() => handleSelectCategory(REVIEW_SENTINEL)}
                icon={<AlertTriangle className="size-3.5" />}
                iconColor="hsl(var(--warning))"
                warn
              />
              <div className="my-1 h-px bg-border" />
              {categories.map((cat) => (
                <CategoryOption
                  key={cat.id}
                  label={cat.name}
                  count={categoryCounts[cat.id] ?? 0}
                  active={activeCategory === cat.id}
                  onClick={() => handleSelectCategory(cat.id)}
                  iconColor={cat.color}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filtro por banco/conta — só aparece quando há bancos e um handler. */}
      {onBank && banks && banks.length > 0 && (
        <div className="relative" ref={bankRef}>
          <button
            type="button"
            onClick={() => setBankOpen((v) => !v)}
            aria-expanded={bankOpen}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors",
              activeBank
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            )}
          >
            <Building2 className="size-3.5" />
            {activeBankLabel}
            <ChevronDown className="size-3 opacity-60" />
          </button>

          {bankOpen && (
            <div className="absolute left-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
              <div className="max-h-80 overflow-y-auto p-1">
                <CategoryOption
                  label="Todos os bancos"
                  count={counts.todas}
                  active={activeBank === null}
                  onClick={() => {
                    onBank(null);
                    setBankOpen(false);
                  }}
                />
                <div className="my-1 h-px bg-border" />
                {bankGroups.map((grp) => (
                  <React.Fragment key={grp.label ?? "flat"}>
                    {grp.label && (
                      <div className="px-2.5 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground/70">
                        {grp.label}
                      </div>
                    )}
                    {grp.items.map((b) => (
                      <CategoryOption
                        key={b.id}
                        label={b.name}
                        count={bankCounts?.[b.id] ?? 0}
                        active={activeBank === b.id}
                        onClick={() => {
                          onBank(b.id);
                          setBankOpen(false);
                        }}
                        icon={bankGroupIcon(b.group)}
                      />
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryOption({
  label,
  count,
  active,
  onClick,
  icon,
  iconColor,
  warn,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  iconColor?: string;
  warn?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
        warn && !active && "text-warning"
      )}
    >
      <span
        className="flex size-5 shrink-0 items-center justify-center rounded-full text-white"
        style={{ backgroundColor: iconColor ?? "hsl(var(--muted-foreground))" }}
      >
        {icon}
      </span>
      <span className="flex-1 truncate font-medium">{label}</span>
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">{count}</span>
      {active && <Check className="size-3.5 shrink-0 text-primary" />}
    </button>
  );
}
