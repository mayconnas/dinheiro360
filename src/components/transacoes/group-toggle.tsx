"use client";

import { CalendarDays, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export type GroupMode = "data" | "destinatario";

export interface GroupToggleProps {
  value: GroupMode;
  onChange: (value: GroupMode) => void;
  className?: string;
}

const OPTIONS: { key: GroupMode; label: string; icon: typeof CalendarDays }[] = [
  { key: "data", label: "Por data", icon: CalendarDays },
  { key: "destinatario", label: "Por destinatário", icon: Users },
];

/** Segmented control para alternar o agrupamento da lista de transações. */
export function GroupToggle({ value, onChange, className }: GroupToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Agrupar lançamentos"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-xl border bg-muted/40 p-0.5",
        className
      )}
    >
      {OPTIONS.map(({ key, label, icon: Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
