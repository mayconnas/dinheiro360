"use client";

import { useState, useTransition } from "react";
import { Plus, Target, Trash2, Pencil } from "lucide-react";
import { addGoal, updateGoal, deleteGoal } from "@/app/actions/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatBRL, formatDate, cn } from "@/lib/utils";
import type { Goal } from "@/lib/types";

export function GoalsView({ goals }: { goals: Goal[] }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Metas</h1>
          <p className="text-muted-foreground">Para onde o seu dinheiro está indo.</p>
        </div>
        <NewGoalDialog />
      </div>

      {goals.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Target className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              Nenhuma meta ainda. Que tal a reserva de emergência ou os 100k?
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function GoalCard({ goal }: { goal: Goal }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(goal.currentAmount.toString());

  const pct =
    goal.targetAmount > 0
      ? Math.min((goal.currentAmount / goal.targetAmount) * 100, 100)
      : 0;
  const done = goal.currentAmount >= goal.targetAmount && goal.targetAmount > 0;

  function saveProgress() {
    const num = parseFloat(current.replace(",", "."));
    if (isNaN(num) || num < 0) return;
    startTransition(() => {
      updateGoal(goal.id, { currentAmount: num });
      setEditing(false);
    });
  }
  function remove() {
    startTransition(() => deleteGoal(goal.id));
  }

  return (
    <Card className={cn(pending && "opacity-60")}>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold">{goal.name}</p>
            {goal.deadline && (
              <p className="text-xs text-muted-foreground">
                até {formatDate(goal.deadline)}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={remove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-semibold tabular">
              {formatBRL(goal.currentAmount)}
            </span>
            <span className="text-muted-foreground tabular">
              de {formatBRL(goal.targetAmount)}
            </span>
          </div>
          <Progress
            value={pct}
            className="mt-2"
            indicatorClassName={done ? "bg-success" : "bg-primary"}
          />
          <p className="mt-1 text-right text-xs text-muted-foreground">
            {Math.round(pct)}%{done && " · concluída 🎉"}
          </p>
        </div>

        {editing ? (
          <div className="flex gap-2">
            <Input
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              inputMode="decimal"
              className="h-9"
              placeholder="Valor acumulado"
              autoFocus
            />
            <Button size="sm" className="h-9" onClick={saveProgress}>
              Salvar
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => {
              setCurrent(goal.currentAmount.toString());
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
            Atualizar progresso
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function NewGoalDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    setError(null);
    const target = parseFloat(
      String(formData.get("target")).replace(",", ".")
    );
    if (isNaN(target) || target <= 0) {
      setError("Informe um valor-alvo válido.");
      return;
    }
    const current = parseFloat(
      String(formData.get("current") || "0").replace(",", ".")
    );
    startTransition(async () => {
      try {
        await addGoal({
          name: String(formData.get("name")),
          targetAmount: target,
          currentAmount: isNaN(current) ? 0 : current,
          deadline: String(formData.get("deadline")) || null,
        });
        setOpen(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao salvar.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Nova meta
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova meta</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              name="name"
              placeholder="Ex: Reserva de emergência, 100k…"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="target">Valor-alvo (R$)</Label>
              <Input id="target" name="target" inputMode="decimal" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="current">Já acumulado (R$)</Label>
              <Input id="current" name="current" inputMode="decimal" placeholder="0" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="deadline">Prazo (opcional)</Label>
            <Input id="deadline" name="deadline" type="date" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Salvando…" : "Criar meta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
