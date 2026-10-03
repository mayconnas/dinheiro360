"use client";

import * as React from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  PERIOD_PRESETS,
  formatRange,
  type PeriodPresetKey,
} from "@/lib/transactions/view-helpers";

const PRESET_LABELS: Record<PeriodPresetKey, string> = {
  mes_atual: "Mês atual",
  mes_inteiro: "Mês inteiro",
  mes_passado: "Mês passado",
  ult7: "Últimos 7 dias",
  ult30: "Últimos 30 dias",
  ano: "Este ano",
};

const PRESET_ORDER: PeriodPresetKey[] = [
  "mes_atual",
  "mes_inteiro",
  "mes_passado",
  "ult7",
  "ult30",
  "ano",
];

export interface PeriodPickerProps {
  from: string;
  to: string;
  today: Date;
  onChange: (from: string, to: string, presetKey: string) => void;
}

export function PeriodPicker({ from, to, today, onChange }: PeriodPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [customFrom, setCustomFrom] = React.useState(from);
  const [customTo, setCustomTo] = React.useState(to);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const presets = React.useMemo(() => PERIOD_PRESETS(today), [today]);

  const activePresetKey = React.useMemo(() => {
    const match = PRESET_ORDER.find((key) => {
      const p = presets[key];
      return p.from === from && p.to === to;
    });
    return match ?? null;
  }, [presets, from, to]);

  React.useEffect(() => {
    if (open) {
      setCustomFrom(from);
      setCustomTo(to);
    }
  }, [open, from, to]);

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

  function handlePresetClick(key: PeriodPresetKey) {
    const p = presets[key];
    onChange(p.from, p.to, key);
    setOpen(false);
  }

  function handleApplyCustom() {
    if (!customFrom || !customTo) return;
    const f = customFrom <= customTo ? customFrom : customTo;
    const t = customFrom <= customTo ? customTo : customFrom;
    onChange(f, t, "custom");
    setOpen(false);
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <Button
        type="button"
        variant="outline"
        className="gap-2"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Calendar className="size-4 text-muted-foreground" />
        <span>{formatRange(from, to)}</span>
        <ChevronDown className="size-3.5 opacity-50" />
      </Button>

      {open && (
        <div
          role="dialog"
          aria-label="Selecionar período"
          className={cn(
            "absolute left-0 top-[calc(100%+6px)] z-50 w-[300px] rounded-xl border border-border",
            "bg-popover text-popover-foreground p-2 shadow-lg"
          )}
        >
          <div className="px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Período
          </div>
          <div className="flex flex-col">
            {PRESET_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => handlePresetClick(key)}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-colors",
                  "hover:bg-accent",
                  activePresetKey === key && "bg-primary/10 text-primary"
                )}
              >
                <Calendar className="size-3.5 shrink-0 text-muted-foreground" />
                {PRESET_LABELS[key]}
              </button>
            ))}
          </div>

          <div className="mt-1 border-t border-border px-1 pt-3">
            <div className="px-1.5 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Personalizado
            </div>
            <div className="flex items-center gap-2 px-1">
              <div className="flex-1">
                <label className="mb-1 block text-[10.5px] font-semibold text-muted-foreground">
                  De
                </label>
                <Input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-9 px-2 text-xs"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-[10.5px] font-semibold text-muted-foreground">
                  Até
                </label>
                <Input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-9 px-2 text-xs"
                />
              </div>
            </div>
            <Button
              type="button"
              className="mt-2.5 w-full"
              size="sm"
              disabled={!customFrom || !customTo}
              onClick={handleApplyCustom}
            >
              Aplicar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
