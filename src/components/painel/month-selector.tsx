"use client";

// ─────────────────────────────────────────────────────────────
// Seletor de mês do Painel. Diferente da tela de Transações (que
// escolhe um período/range livre), o Painel sempre olha para UM mês —
// então aqui é só "mês anterior / próximo / escolher entre os últimos
// 12" navegando pela querystring (?mes=AAAA-MM). Nunca deixa avançar
// além do mês corrente.
// ─────────────────────────────────────────────────────────────
import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, ChevronDown, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, monthLabel } from "@/lib/utils";

export interface MonthSelectorProps {
  /** Mês selecionado (AAAA-MM). */
  month: string;
  /** Mês corrente (AAAA-MM) — teto de navegação, nunca deixa ir ao futuro. */
  currentMonth: string;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Últimos `count` meses (incl. o corrente), do mais recente ao mais antigo. */
function lastMonths(currentMonth: string, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(shiftMonth(currentMonth, -i));
  return out;
}

export function MonthSelector({ month, currentMonth }: MonthSelectorProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const isCurrent = month === currentMonth;
  const options = React.useMemo(() => lastMonths(currentMonth, 12), [currentMonth]);

  function go(nextMonth: string) {
    if (nextMonth > currentMonth) return; // nunca navega pro futuro
    const params = new URLSearchParams();
    if (nextMonth !== currentMonth) params.set("mes", nextMonth);
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/");
  }

  React.useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative inline-flex items-center gap-1" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7"
        aria-label="Mês anterior"
        onClick={() => go(shiftMonth(month, -1))}
      >
        <ChevronLeft className="size-3.5" />
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-xs font-semibold capitalize"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <Calendar className="size-3.5 text-muted-foreground" />
        {monthLabel(month)}
        <ChevronDown className="size-3 opacity-50" />
      </Button>

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7"
        aria-label="Próximo mês"
        disabled={isCurrent}
        onClick={() => go(shiftMonth(month, 1))}
      >
        <ChevronRight className="size-3.5" />
      </Button>

      {open && (
        <div
          role="listbox"
          aria-label="Selecionar mês"
          className={cn(
            "absolute left-0 top-[calc(100%+6px)] z-50 max-h-72 w-52 overflow-y-auto",
            "rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
          )}
        >
          {options.map((m) => (
            <button
              key={m}
              type="button"
              role="option"
              aria-selected={m === month}
              onClick={() => {
                go(m);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-sm font-medium capitalize transition-colors",
                "hover:bg-accent",
                m === month && "bg-primary/10 text-primary"
              )}
            >
              {monthLabel(m)}
              {m === currentMonth && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  atual
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
