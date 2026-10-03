import { Target, Plane, Laptop, Home, Car, GraduationCap, Heart, PiggyBank } from "lucide-react";
import type { Goal } from "@/lib/types";
import { formatBRL } from "@/lib/utils";

/**
 * Escolhe um ícone para a meta com base no nome (heurística simples por
 * palavras-chave), com fallback para um alvo genérico (Target).
 */
function pickGoalIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("emerg") || n.includes("reserva")) return PiggyBank;
  if (n.includes("viage") || n.includes("passa") || n.includes("nordeste") || n.includes("praia")) return Plane;
  if (n.includes("notebook") || n.includes("computador") || n.includes("pc") || n.includes("celular")) return Laptop;
  if (n.includes("casa") || n.includes("apart") || n.includes("imóv") || n.includes("imov")) return Home;
  if (n.includes("carro") || n.includes("moto") || n.includes("veícul") || n.includes("veicul")) return Car;
  if (n.includes("curso") || n.includes("facul") || n.includes("estud")) return GraduationCap;
  if (n.includes("saúde") || n.includes("saude") || n.includes("médic") || n.includes("medic")) return Heart;
  return Target;
}

export interface GoalsListProps {
  goals: Goal[];
}

/**
 * Lista de metas financeiras, réplica do bloco "Metas" (#goalsList) do
 * mockup: ícone + nome, percentual concluído, barra de progresso em
 * gradiente e "R$ atual de R$ alvo · faltam R$ diferença".
 */
export function GoalsList({ goals }: GoalsListProps) {
  if (goals.length === 0) {
    return (
      <div className="py-6 text-center text-sm font-medium text-muted-foreground">
        Nenhuma meta cadastrada ainda.
      </div>
    );
  }

  return (
    <div>
      {goals.map((goal) => {
        const Icon = pickGoalIcon(goal.name);
        const pct =
          goal.targetAmount > 0
            ? Math.round((goal.currentAmount / goal.targetAmount) * 100)
            : 0;
        const clampedPct = Math.min(Math.max(pct, 0), 100);
        const remaining = Math.max(goal.targetAmount - goal.currentAmount, 0);

        return (
          <div
            key={goal.id}
            className="flex flex-col gap-2 border-b border-dashed border-border py-[13px] last:border-b-0"
          >
            <div className="flex items-center justify-between gap-2.5">
              <span className="flex items-center gap-2.5 text-[13px] font-bold text-foreground">
                <span
                  className="grid h-[30px] w-[30px] flex-none place-items-center rounded-[9px]"
                  style={{
                    background: "var(--goal-brand-soft, #E7F5EF)",
                    color: "var(--goal-brand, #059669)",
                  }}
                >
                  <Icon size={16} strokeWidth={1.9} />
                </span>
                {goal.name}
              </span>
              <span
                className="text-xs font-extrabold tabular-nums"
                style={{ color: "var(--goal-brand, #059669)" }}
              >
                {clampedPct}%
              </span>
            </div>

            <div className="h-[7px] overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${clampedPct}%`,
                  background:
                    "linear-gradient(90deg, var(--goal-brand-2, #10B981), var(--goal-brand, #059669))",
                }}
              />
            </div>

            <div className="text-[11.5px] font-semibold text-muted-foreground tabular-nums">
              {formatBRL(goal.currentAmount)} de {formatBRL(goal.targetAmount)} · faltam{" "}
              {formatBRL(remaining)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default GoalsList;
