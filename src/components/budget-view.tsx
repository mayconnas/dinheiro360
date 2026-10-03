"use client";

import { useState, useTransition } from "react";
import { Wand2, Check, X } from "lucide-react";
import { setBudget, removeBudget } from "@/app/actions/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatPercent, cn } from "@/lib/utils";
import type { BudgetLine, BudgetStatus } from "@/lib/engine/budget";

interface Props {
  lines: BudgetLine[];
  suggestions: { categoryId: string; categoryName: string; suggested: number }[];
}

const STATUS_META: Record<
  BudgetStatus,
  { label: string; variant: "success" | "warning" | "destructive" | "secondary"; bar: string }
> = {
  ok: { label: "No controle", variant: "success", bar: "bg-success" },
  alerta: { label: "Perto do teto", variant: "warning", bar: "bg-warning" },
  estourado: { label: "Estourado", variant: "destructive", bar: "bg-destructive" },
  sem_controle: { label: "Sem teto", variant: "secondary", bar: "bg-muted-foreground" },
};

export function BudgetView({ lines, suggestions }: Props) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Orçamento</h1>
        <p className="text-muted-foreground">
          Defina tetos por categoria. Alerta em 80%, estouro em 100%.
        </p>
      </div>

      {suggestions.length > 0 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 className="h-5 w-5 text-primary" />
              Tetos sugeridos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              Baseados na sua média dos últimos 3 meses. Aplique com um clique.
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <SuggestionChip key={s.categoryId} suggestion={s} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {lines.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              Registre transações para o orçamento aparecer aqui.
            </CardContent>
          </Card>
        ) : (
          lines.map((line) => <BudgetRow key={line.categoryId} line={line} />)
        )}
      </div>
    </div>
  );
}

function SuggestionChip({
  suggestion,
}: {
  suggestion: { categoryId: string; categoryName: string; suggested: number };
}) {
  const [pending, startTransition] = useTransition();
  function apply() {
    startTransition(() =>
      setBudget(suggestion.categoryId, suggestion.suggested)
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={apply}
      disabled={pending}
      className="gap-1.5"
    >
      {suggestion.categoryName}: {formatBRL(suggestion.suggested)}
      <Check className="h-3.5 w-3.5" />
    </Button>
  );
}

function BudgetRow({ line }: { line: BudgetLine }) {
  const meta = STATUS_META[line.status];
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(line.limit?.toString() ?? "");
  const [pending, startTransition] = useTransition();

  function save() {
    const num = parseFloat(value.replace(",", "."));
    if (isNaN(num) || num < 0) return;
    startTransition(() => {
      setBudget(line.categoryId, num);
      setEditing(false);
    });
  }
  function clear() {
    startTransition(() => {
      removeBudget(line.categoryId);
      setEditing(false);
    });
  }

  const pct = line.consumed !== null ? Math.min(line.consumed * 100, 100) : 0;

  return (
    <Card className={cn(pending && "opacity-60")}>
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ background: line.color }}
            />
            <span className="font-medium">{line.categoryName}</span>
            <Badge variant={meta.variant}>{meta.label}</Badge>
          </div>
          {!editing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setValue(line.limit?.toString() ?? "");
                setEditing(true);
              }}
            >
              {line.limit ? "Editar teto" : "Definir teto"}
            </Button>
          )}
        </div>

        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
              placeholder="Teto (R$)"
              className="h-9"
              autoFocus
            />
            <Button size="icon" className="h-9 w-9" onClick={save}>
              <Check className="h-4 w-4" />
            </Button>
            {line.limit !== null && (
              <Button
                size="icon"
                variant="outline"
                className="h-9 w-9"
                onClick={clear}
                title="Remover teto"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between text-sm">
              <span className="tabular">
                {formatBRL(line.spent)}
                {line.limit !== null && (
                  <span className="text-muted-foreground">
                    {" "}
                    de {formatBRL(line.limit)}
                  </span>
                )}
              </span>
              {line.consumed !== null && (
                <span className="tabular text-muted-foreground">
                  {formatPercent(line.consumed)}
                  {line.remaining !== null && line.remaining >= 0 && (
                    <> · resta {formatBRL(line.remaining)}</>
                  )}
                </span>
              )}
            </div>
            {line.limit !== null && (
              <Progress
                value={pct}
                className="mt-2"
                indicatorClassName={meta.bar}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
