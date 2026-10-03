import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IndicatorStatus, Trend } from "@/lib/engine/indicators";

const STATUS_STYLES: Record<IndicatorStatus, string> = {
  bom: "bg-success/15 text-success border-success/30",
  atencao: "bg-warning/15 text-warning border-warning/40",
  critico: "bg-destructive/15 text-destructive border-destructive/30",
  sem_dados: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABEL: Record<IndicatorStatus, string> = {
  bom: "Bom",
  atencao: "Atenção",
  critico: "Crítico",
  sem_dados: "Sem dados",
};

export function StatusPill({ status }: { status: IndicatorStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold",
        STATUS_STYLES[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function TrendIcon({ trend }: { trend: Trend }) {
  if (trend === "subindo")
    return <TrendingUp className="h-4 w-4 text-success" />;
  if (trend === "caindo")
    return <TrendingDown className="h-4 w-4 text-destructive" />;
  if (trend === "estavel")
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  return null;
}
