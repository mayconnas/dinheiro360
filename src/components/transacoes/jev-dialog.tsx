"use client";

// ─────────────────────────────────────────────────────────────
// Diálogo "Categorizar com Jev" (TypeSafe) da tela de Transações.
//
// Fluxo em 3 fases:
//  1. setup    — o usuário escolhe o escopo (a revisar / todas do
//                período / filtro atual / selecionadas).
//  2. running  — envia em lotes (JEV_CLIENT_BATCH_SIZE) para
//                categorizeWithJev, com barra de progresso e "Parar".
//                Cada lançamento vai com as categorias do seu tipo:
//                receitas p/ entradas, despesas p/ saídas.
//  3. results  — mostra a decisão do Jev por lançamento, agrupada por
//                confiança, com alternativas e troca manual. Nada é
//                gravado até "Aplicar" (applyJevDecisions).
//
// Pré-seleção: alta e média confiança já vêm marcadas (o diálogo é a
// confirmação que a TypeSafe recomenda para confiança média); baixa,
// "nenhuma" e as que só repetem a categoria atual vêm desmarcadas.
// ─────────────────────────────────────────────────────────────

import * as React from "react";
import { useTransition } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, BrainCircuit, Loader2, Settings2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn, formatBRL } from "@/lib/utils";
import type { Category, Transaction } from "@/lib/types";
import { applyJevDecisions, categorizeWithJev } from "@/app/actions/jev";
import {
  JEV_CLIENT_BATCH_SIZE,
  JEV_TIER_LABELS,
  type JevDecision,
  type JevTier,
} from "@/lib/ai/jev/config";
import { useToast } from "@/components/transacoes/use-toast";

export type JevScopeId = "revisar" | "periodo" | "filtradas" | "selecionadas";

export interface JevScope {
  id: JevScopeId;
  label: string;
  hint: string;
  ids: string[];
}

export interface JevDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialScope: JevScopeId;
  scopes: JevScope[];
  /** Há chave da TypeSafe (do usuário ou do servidor)? */
  configured: boolean;
  transactionsById: Map<string, Transaction>;
  categories: Category[];
  /** Transferências entre contas próprias / pagamentos de fatura — puladas por padrão. */
  internalIds: Set<string>;
  /** Chamado depois de aplicar com sucesso (ex: limpar a seleção da tela). */
  onApplied: () => void;
}

type Phase = "setup" | "running" | "results";

const TIER_ORDER: JevTier[] = ["alta", "media", "baixa", "nenhuma"];

const TIER_BADGE: Record<JevTier, string> = {
  alta: "bg-success/15 text-success",
  media: "bg-warning/15 text-warning",
  baixa: "bg-destructive/10 text-destructive",
  nenhuma: "bg-muted text-muted-foreground",
};

function isReviewCategory(c: Category | undefined): boolean {
  return !!c && c.name.trim().toLowerCase() === "a revisar";
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(y, m - 1, d));
}

export function JevCategorizeDialog({
  open,
  onOpenChange,
  initialScope,
  scopes,
  configured,
  transactionsById,
  categories,
  internalIds,
  onApplied,
}: JevDialogProps) {
  const { showToast } = useToast();
  const [phase, setPhase] = React.useState<Phase>("setup");
  const [scopeId, setScopeId] = React.useState<JevScopeId>(initialScope);
  const [skipInternal, setSkipInternal] = React.useState(true);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [decisions, setDecisions] = React.useState<JevDecision[]>([]);
  const [skippedCount, setSkippedCount] = React.useState(0);
  const [runError, setRunError] = React.useState<string | null>(null);
  const [model, setModel] = React.useState<string | null>(null);
  const [choices, setChoices] = React.useState<Record<string, string | null>>({});
  const [checked, setChecked] = React.useState<Set<string>>(new Set());
  const [learnRules, setLearnRules] = React.useState(true);
  const [applying, startApplying] = useTransition();
  // Erro de "Aplicar" fica DENTRO do diálogo: um toast fica fora do modal,
  // e tocar nele contaria como clique fora — fecharia o diálogo e jogaria
  // fora toda a revisão.
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [stopping, setStopping] = React.useState(false);
  // runId invalida envios em andamento quando o diálogo fecha/reabre;
  // stopRef é o botão "Parar" (mantém o que já foi analisado).
  const runIdRef = React.useRef(0);
  const stopRef = React.useRef(false);

  // Reinicia a cada abertura; fechar no meio interrompe o envio.
  React.useEffect(() => {
    runIdRef.current++;
    if (open) {
      setPhase("setup");
      setScopeId(initialScope);
      setDecisions([]);
      setChoices({});
      setChecked(new Set());
      setRunError(null);
      setApplyError(null);
      setStopping(false);
      setSkippedCount(0);
      setModel(null);
      setProgress({ done: 0, total: 0 });
    }
  }, [open, initialScope]);

  // ─── Categorias: rótulo com caminho ("Moradia > Aluguel") e listas por kind ───
  const catById = React.useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const labelById = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const c of categories) {
      const names = [c.name];
      const seen = new Set([c.id]);
      let parent = c.parentId ? catById.get(c.parentId) : undefined;
      while (parent && !seen.has(parent.id)) {
        names.unshift(parent.name);
        seen.add(parent.id);
        parent = parent.parentId ? catById.get(parent.parentId) : undefined;
      }
      out.set(c.id, names.join(" › "));
    }
    return out;
  }, [categories, catById]);
  const optionsByKind = React.useMemo(() => {
    const byLabel = (a: Category, b: Category) =>
      (labelById.get(a.id) ?? a.name).localeCompare(labelById.get(b.id) ?? b.name, "pt-BR");
    const valid = categories.filter((c) => !isReviewCategory(c));
    return {
      receita: valid.filter((c) => c.kind === "receita").sort(byLabel),
      despesa: valid.filter((c) => c.kind === "despesa").sort(byLabel),
    };
  }, [categories, labelById]);

  // ─── Escopo ───
  const scope = scopes.find((s) => s.id === scopeId) ?? scopes[0];
  const internalInScope = React.useMemo(
    () => (scope ? scope.ids.filter((id) => internalIds.has(id)).length : 0),
    [scope, internalIds]
  );
  const targetIds = React.useMemo(() => {
    if (!scope) return [];
    return skipInternal ? scope.ids.filter((id) => !internalIds.has(id)) : scope.ids;
  }, [scope, skipInternal, internalIds]);

  const isAlreadyCorrect = React.useCallback(
    (tx: Transaction, categoryId: string | null): boolean => {
      if (!categoryId || tx.categoryId !== categoryId) return false;
      return !tx.needsReview && !isReviewCategory(catById.get(tx.categoryId));
    },
    [catById]
  );

  function defaultChecked(d: JevDecision): boolean {
    const tx = transactionsById.get(d.transactionId);
    if (!tx || !d.categoryId || d.error) return false;
    if (d.tier !== "alta" && d.tier !== "media") return false;
    return !isAlreadyCorrect(tx, d.categoryId);
  }

  async function run() {
    const ids = targetIds;
    if (ids.length === 0) return;
    const runId = ++runIdRef.current;
    stopRef.current = false;
    setStopping(false);
    setRunError(null);
    setApplyError(null);
    setPhase("running");
    setProgress({ done: 0, total: ids.length });

    const collected: JevDecision[] = [];
    let skipped = 0;
    let firstSkipReason: string | null = null;
    let lastModel: string | null = null;
    let error: string | null = null;

    for (const part of chunk(ids, JEV_CLIENT_BATCH_SIZE)) {
      if (stopRef.current || runIdRef.current !== runId) break;
      try {
        const res = await categorizeWithJev(part);
        if (runIdRef.current !== runId) return; // diálogo fechado/reaberto: descarta
        if (!res.ok) {
          error = res.error ?? "Falha ao consultar o Jev.";
          break;
        }
        collected.push(...res.decisions);
        skipped += res.skipped.length;
        if (!firstSkipReason && res.skipped.length > 0) firstSkipReason = res.skipped[0].reason;
        if (res.model) lastModel = res.model;
      } catch (e) {
        error = e instanceof Error ? e.message : "Falha ao consultar o Jev.";
        break;
      }
      setProgress((p) => ({ ...p, done: Math.min(p.total, p.done + part.length) }));
    }

    if (runIdRef.current !== runId) return;

    // Nada analisado porque o servidor pulou tudo (ex: nenhuma categoria de
    // receita cadastrada) — explica em vez de voltar mudo para o início.
    if (!error && collected.length === 0 && skipped > 0) {
      error =
        skipped === 1
          ? firstSkipReason
          : `${firstSkipReason} (${skipped} lançamentos não enviados)`;
    }

    setStopping(false);
    setDecisions(collected);
    setSkippedCount(skipped);
    setModel(lastModel);
    setChoices(Object.fromEntries(collected.map((d) => [d.transactionId, d.categoryId])));
    setChecked(new Set(collected.filter(defaultChecked).map((d) => d.transactionId)));
    setRunError(error);
    setPhase(collected.length > 0 ? "results" : "setup");
  }

  // ─── Resultados ───
  const grouped = React.useMemo(() => {
    const groups: Record<JevTier | "erro", JevDecision[]> = {
      alta: [],
      media: [],
      baixa: [],
      nenhuma: [],
      erro: [],
    };
    for (const d of decisions) {
      if (!transactionsById.has(d.transactionId)) continue;
      if (d.error) groups.erro.push(d);
      else groups[d.tier].push(d);
    }
    const byDateDesc = (a: JevDecision, b: JevDecision) =>
      (transactionsById.get(b.transactionId)?.date ?? "").localeCompare(
        transactionsById.get(a.transactionId)?.date ?? ""
      );
    for (const key of Object.keys(groups) as (JevTier | "erro")[]) groups[key].sort(byDateDesc);
    return groups;
  }, [decisions, transactionsById]);

  const sameAsCurrentCount = React.useMemo(
    () =>
      decisions.filter((d) => {
        const tx = transactionsById.get(d.transactionId);
        return tx && !d.error && isAlreadyCorrect(tx, d.categoryId);
      }).length,
    [decisions, transactionsById, isAlreadyCorrect]
  );

  const applicable = [...checked].filter((id) => choices[id]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (choices[id]) next.add(id);
      return next;
    });
  }

  function choose(id: string, categoryId: string | null) {
    setChoices((prev) => ({ ...prev, [id]: categoryId }));
    setChecked((prev) => {
      const next = new Set(prev);
      if (categoryId) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function selectTiers(tiers: JevTier[]) {
    setChecked(
      new Set(
        decisions
          .filter((d) => {
            const tx = transactionsById.get(d.transactionId);
            return (
              tx &&
              !d.error &&
              tiers.includes(d.tier) &&
              choices[d.transactionId] &&
              !isAlreadyCorrect(tx, choices[d.transactionId])
            );
          })
          .map((d) => d.transactionId)
      )
    );
  }

  /** Marca (on) as linhas do grupo que mudam algo — as "igual à atual" só entram se não houver outras; desmarca (off) todas. */
  function toggleGroup(items: JevDecision[], on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (!on) {
        for (const d of items) next.delete(d.transactionId);
        return next;
      }
      const selectable = items.filter((d) => choices[d.transactionId]);
      const changing = selectable.filter((d) => {
        const tx = transactionsById.get(d.transactionId);
        return tx && !isAlreadyCorrect(tx, choices[d.transactionId]);
      });
      for (const d of changing.length > 0 ? changing : selectable) next.add(d.transactionId);
      return next;
    });
  }

  /**
   * Quais escolhas podem virar regra aprendida. Uma regra vale para toda
   * descrição igual, mas o Jev decide olhando contraparte, valor e conta —
   * então só aprende quando a escolha é sólida (alta confiança ou correção
   * sua) e TODOS os lançamentos do resultado com a mesma descrição e tipo
   * (marcados ou não) apontam para a mesma categoria.
   */
  function learnableIds(): Set<string> {
    // categoria que cada linha "defende": a escolha, se marcada; senão o palpite do Jev (null = nenhuma/erro)
    const rows = decisions
      .map((d) => {
        const tx = transactionsById.get(d.transactionId);
        if (!tx) return null;
        const category = checked.has(d.transactionId)
          ? choices[d.transactionId] ?? null
          : d.error
            ? null
            : d.categoryId;
        return { d, tx, text: tx.description.trim().toLowerCase(), category };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const out = new Set<string>();
    for (const r of rows) {
      if (!checked.has(r.d.transactionId) || !r.category || r.text.length < 3) continue;
      const override = choices[r.d.transactionId] !== r.d.categoryId;
      if (r.d.tier !== "alta" && !override) continue;
      // Regras casam por substring: conflita qualquer linha do mesmo tipo
      // cuja descrição CONTÉM esta e que defende outra categoria.
      const conflict = rows.some(
        (o) => o.tx.type === r.tx.type && o.text.includes(r.text) && o.category !== r.category
      );
      if (!conflict) out.add(r.d.transactionId);
    }
    return out;
  }

  function apply() {
    const learnable = learnRules ? learnableIds() : new Set<string>();
    const assignments = applicable.map((id) => ({
      id,
      categoryId: choices[id] as string,
      learn: learnable.has(id),
    }));
    if (assignments.length === 0) return;
    setApplyError(null);
    startApplying(async () => {
      try {
        const res = await applyJevDecisions(assignments, { learnRules });
        if (res.ok) {
          const n = res.count ?? 0;
          const parts = [`${n} lançamento${n === 1 ? "" : "s"} categorizado${n === 1 ? "" : "s"} com o Jev`];
          if (res.skipped) parts.push(`${res.skipped} ignorado${res.skipped === 1 ? "" : "s"}`);
          if (res.learned) parts.push(`${res.learned} regra${res.learned === 1 ? "" : "s"} criada${res.learned === 1 ? "" : "s"}`);
          showToast(`${parts.join(" · ")}.`, { variant: "success" });
          onApplied();
          onOpenChange(false);
        } else {
          const error = res.error ?? "Erro ao aplicar as categorias.";
          setApplyError(
            res.count
              ? `${res.count} lançamento${res.count === 1 ? " já foi gravado" : "s já foram gravados"} antes do erro: ${error}`
              : error
          );
        }
      } catch (e) {
        setApplyError(e instanceof Error ? e.message : "Erro ao aplicar as categorias.");
      }
    });
  }

  const running = phase === "running";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && applying) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="space-y-1.5 border-b border-border px-6 pb-4 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
              <BrainCircuit className="h-4 w-4" />
            </span>
            Categorizar com Jev
          </DialogTitle>
          <DialogDescription>
            O Jev (TypeSafe) escolhe a melhor categoria para cada lançamento entre as suas —
            categorias de receita para entradas, de despesa para saídas. Você revisa antes de aplicar.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {phase === "setup" && (
            <SetupStep
              configured={configured}
              scopes={scopes}
              scopeId={scope?.id ?? initialScope}
              onScope={setScopeId}
              internalInScope={internalInScope}
              skipInternal={skipInternal}
              onSkipInternal={setSkipInternal}
              targetCount={targetIds.length}
              error={runError}
            />
          )}

          {running && (
            <div className="space-y-3 py-8 text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
              <p className="text-sm font-semibold" role="status">
                {stopping
                  ? "Terminando o lote atual…"
                  : `Analisando ${progress.done} de ${progress.total} lançamento${progress.total === 1 ? "" : "s"}…`}
              </p>
              <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
              <p className="text-xs text-muted-foreground">
                Cada lançamento é avaliado isoladamente, com as suas categorias como opções.
              </p>
            </div>
          )}

          {phase === "results" && (
            // fieldset desabilitado durante "Aplicar": o que foi enviado não pode mudar na tela
            <fieldset disabled={applying} className="m-0 min-w-0 space-y-4 border-0 p-0">
              {runError && (
                <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    O envio parou antes do fim: {runError} Os resultados abaixo são dos lançamentos que
                    já tinham sido analisados.
                  </span>
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2 text-xs">
                {TIER_ORDER.map((tier) =>
                  grouped[tier].length > 0 ? (
                    <span key={tier} className={cn("rounded-full px-2.5 py-1 font-semibold", TIER_BADGE[tier])}>
                      {JEV_TIER_LABELS[tier]}: {grouped[tier].length}
                    </span>
                  ) : null
                )}
                {grouped.erro.length > 0 && (
                  <span className="rounded-full bg-destructive/10 px-2.5 py-1 font-semibold text-destructive">
                    Com erro: {grouped.erro.length}
                  </span>
                )}
                {sameAsCurrentCount > 0 && (
                  <span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground">
                    Iguais à categoria atual: {sameAsCurrentCount}
                  </span>
                )}
                {skippedCount > 0 && (
                  <span className="rounded-full bg-muted px-2.5 py-1 font-semibold text-muted-foreground">
                    Não enviados: {skippedCount}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
                  Marcar
                </span>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => selectTiers(["alta"])}>
                  Só alta confiança
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => selectTiers(["alta", "media"])}>
                  Alta + média
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={() => selectTiers(["alta", "media", "baixa"])}>
                  Todas com sugestão
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => setChecked(new Set())}>
                  Nenhuma
                </Button>
              </div>

              {([...TIER_ORDER, "erro"] as const).map((key) => {
                const items = grouped[key];
                if (items.length === 0) return null;
                const selectable = items.filter((d) => choices[d.transactionId]);
                const nChecked = selectable.filter((d) => checked.has(d.transactionId)).length;
                const allChecked = selectable.length > 0 && nChecked === selectable.length;
                const title = key === "erro" ? "Com erro" : JEV_TIER_LABELS[key];
                return (
                  <section key={key} className="overflow-hidden rounded-lg border border-border">
                    <header className="flex items-center gap-3 bg-muted/40 px-3 py-2">
                      {key !== "erro" && selectable.length > 0 && (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[hsl(var(--primary))]"
                          ref={(el) => {
                            if (el) el.indeterminate = nChecked > 0 && !allChecked;
                          }}
                          checked={allChecked}
                          // com algo marcado, o clique limpa o grupo; sem nada, marca
                          onChange={() => toggleGroup(items, nChecked === 0)}
                          aria-label={`Marcar todos: ${title}`}
                        />
                      )}
                      <span className="text-sm font-bold">{title}</span>
                      <span className="text-xs text-muted-foreground">
                        {items.length} lançamento{items.length === 1 ? "" : "s"}
                      </span>
                    </header>
                    <ul className="divide-y divide-border">
                      {items.map((d) => {
                        const tx = transactionsById.get(d.transactionId)!;
                        return (
                          <ResultRow
                            key={d.transactionId}
                            tx={tx}
                            decision={d}
                            choice={choices[d.transactionId] ?? null}
                            checked={checked.has(d.transactionId)}
                            currentCategory={tx.categoryId ? catById.get(tx.categoryId) : undefined}
                            options={tx.type === "entrada" ? optionsByKind.receita : optionsByKind.despesa}
                            labelById={labelById}
                            catById={catById}
                            alreadyCorrect={isAlreadyCorrect(tx, choices[d.transactionId] ?? null)}
                            onToggle={() => toggle(d.transactionId)}
                            onChoose={(categoryId) => choose(d.transactionId, categoryId)}
                          />
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </fieldset>
          )}
        </div>

        {phase === "results" && applyError && (
          <div className="border-t border-border px-6 pt-3">
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="block">{applyError}</span>
                <span className="block text-xs opacity-80">Sua revisão continua aqui — tente aplicar de novo.</span>
              </span>
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          {phase === "results" ? (
            <>
              <label className="flex items-start gap-2 text-xs text-muted-foreground sm:max-w-[55%]">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
                  checked={learnRules}
                  disabled={applying}
                  onChange={(e) => setLearnRules(e.target.checked)}
                />
                <span>
                  Criar regras a partir das escolhas de alta confiança e das que você corrigiu — só
                  para descrições sem ambiguidade. Lançamentos parecidos no futuro já entram categorizados.
                  {model && <span className="block opacity-70">Modelo: {model}</span>}
                </span>
              </label>
              <div className="flex gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setApplyError(null);
                    setRunError(null);
                    setPhase("setup");
                  }}
                  disabled={applying}
                >
                  Refazer
                </Button>
                <Button type="button" onClick={apply} disabled={applying || applicable.length === 0}>
                  {applying && <Loader2 className="h-4 w-4 animate-spin" />}
                  Aplicar {applicable.length} categoria{applicable.length === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          ) : running ? (
            <div className="flex w-full justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={stopping}
                onClick={() => {
                  stopRef.current = true;
                  setStopping(true);
                }}
              >
                {stopping && <Loader2 className="h-4 w-4 animate-spin" />}
                {stopping ? "Parando…" : "Parar e ver resultados"}
              </Button>
            </div>
          ) : (
            <div className="flex w-full justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="button" onClick={run} disabled={!configured || targetIds.length === 0}>
                <BrainCircuit className="h-4 w-4" />
                Categorizar {targetIds.length} com o Jev
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Fase 1: escolha do escopo ───

function SetupStep({
  configured,
  scopes,
  scopeId,
  onScope,
  internalInScope,
  skipInternal,
  onSkipInternal,
  targetCount,
  error,
}: {
  configured: boolean;
  scopes: JevScope[];
  scopeId: JevScopeId;
  onScope: (id: JevScopeId) => void;
  internalInScope: number;
  skipInternal: boolean;
  onSkipInternal: (v: boolean) => void;
  targetCount: number;
  error: string | null;
}) {
  if (!configured) {
    return (
      <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
        <p className="font-semibold">Conecte sua conta da TypeSafe para usar o Jev.</p>
        <p className="text-muted-foreground">
          Cadastre sua chave de API em Configurações &gt; Inteligência (IA). Ela fica salva no servidor e
          nunca é reexibida.
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href="/configuracoes?tab=ia">
            <Settings2 className="h-4 w-4" />
            Configurar TypeSafe
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <fieldset className="space-y-2">
        <legend className="mb-2 text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">
          O que categorizar
        </legend>
        {scopes.map((s) => {
          const disabled = s.ids.length === 0;
          const active = s.id === scopeId;
          return (
            <label
              key={s.id}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
                disabled && "cursor-not-allowed opacity-50"
              )}
            >
              <input
                type="radio"
                name="jev-scope"
                className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]"
                checked={active}
                disabled={disabled}
                onChange={() => onScope(s.id)}
              />
              <span className="flex-1">
                <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                  {s.label}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                    {s.ids.length}
                  </span>
                </span>
                <span className="block text-xs text-muted-foreground">{s.hint}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {internalInScope > 0 && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
            checked={skipInternal}
            onChange={(e) => onSkipInternal(e.target.checked)}
          />
          <span>
            Pular {internalInScope} transferência{internalInScope === 1 ? "" : "s"} entre contas próprias /
            pagamento{internalInScope === 1 ? "" : "s"} de fatura
            <span className="block text-xs text-muted-foreground">
              Não são receita nem despesa — o dinheiro só mudou de conta.
            </span>
          </span>
        </label>
      )}

      <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        Para cada lançamento são enviados à TypeSafe: descrição, estabelecimento/destinatário, forma de
        pagamento, valor e conta — junto com os nomes das suas categorias e exemplos do seu histórico.
        Nada é alterado até você revisar e aplicar.
        {targetCount > 0 && ` Serão analisados ${targetCount} lançamento${targetCount === 1 ? "" : "s"}.`}
      </p>
    </div>
  );
}

// ─── Fase 3: uma linha de resultado ───

function ResultRow({
  tx,
  decision,
  choice,
  checked,
  currentCategory,
  options,
  labelById,
  catById,
  alreadyCorrect,
  onToggle,
  onChoose,
}: {
  tx: Transaction;
  decision: JevDecision;
  choice: string | null;
  checked: boolean;
  currentCategory: Category | undefined;
  options: Category[];
  labelById: Map<string, string>;
  catById: Map<string, Category>;
  alreadyCorrect: boolean;
  onToggle: () => void;
  onChoose: (categoryId: string | null) => void;
}) {
  const chosen = choice ? catById.get(choice) : undefined;
  const isOverride = choice !== decision.categoryId;
  const pct = Math.round(decision.confidence * 100);
  const alternatives = decision.alternatives.filter((a) => a.categoryId !== choice && catById.has(a.categoryId));
  // Se o Jev sugeriu e o usuário trocou, oferece voltar para a sugestão original.
  const original = decision.categoryId && isOverride ? catById.get(decision.categoryId) : undefined;

  return (
    <li className={cn("flex gap-3 px-3 py-3", checked && "bg-primary/[0.04]")}>
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
        checked={checked}
        disabled={!choice}
        onChange={onToggle}
        aria-label={`Aplicar categoria em ${tx.description}`}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold">
            <span className="mr-1.5 text-xs font-medium text-muted-foreground">{formatShortDate(tx.date)}</span>
            {tx.description}
          </p>
          <span
            className={cn(
              "shrink-0 text-sm font-bold tabular-nums",
              tx.type === "entrada" ? "text-success" : "text-foreground"
            )}
          >
            {tx.type === "entrada" ? "+" : "−"}
            {formatBRL(tx.amount)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <CategoryPill category={currentCategory} fallback={tx.type === "entrada" ? "Sem categoria" : "A revisar"} muted />
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <select
            value={choice ?? ""}
            onChange={(e) => onChoose(e.target.value || null)}
            className="h-7 max-w-[240px] rounded-full border border-input bg-background px-2.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-ring"
            style={chosen ? { color: chosen.color, borderColor: `${chosen.color}66` } : undefined}
            aria-label="Categoria a aplicar"
          >
            <option value="">— escolher —</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {labelById.get(c.id) ?? c.name}
              </option>
            ))}
          </select>
          {decision.error ? null : isOverride ? (
            <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">sua escolha</span>
          ) : decision.categoryId ? (
            <span className={cn("rounded-full px-2 py-0.5 font-semibold tabular-nums", TIER_BADGE[decision.tier])}>
              {pct}% confiança
            </span>
          ) : null}
          {alreadyCorrect && (
            <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">igual à atual</span>
          )}
        </div>

        {decision.error ? (
          <p className="text-xs text-destructive">{decision.error}</p>
        ) : !decision.categoryId && !isOverride ? (
          <p className="text-xs text-muted-foreground">
            O Jev não achou uma categoria que se encaixe. Escolha manualmente
            {alternatives.length > 0 ? " ou use uma das mais próximas:" : "."}
          </p>
        ) : null}

        {(alternatives.length > 0 || original) && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {original && (
              <button
                type="button"
                onClick={() => onChoose(original.id)}
                className="rounded-full border border-dashed border-primary/60 px-2 py-0.5 font-semibold text-primary hover:bg-primary/10"
              >
                ↺ sugestão do Jev: {labelById.get(original.id) ?? original.name}
              </button>
            )}
            {alternatives.length > 0 && <span className="text-muted-foreground">ou</span>}
            {alternatives.map((a) => {
              const c = catById.get(a.categoryId)!;
              return (
                <button
                  key={a.categoryId}
                  type="button"
                  onClick={() => onChoose(a.categoryId)}
                  className="rounded-full border border-border px-2 py-0.5 font-semibold text-muted-foreground hover:border-primary/50 hover:text-foreground"
                >
                  <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: c.color }} />
                  {labelById.get(c.id) ?? c.name}{" "}
                  <span className="tabular-nums opacity-70">{Math.round(a.probability * 100)}%</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </li>
  );
}

function CategoryPill({
  category,
  fallback,
  muted,
}: {
  category: Category | undefined;
  fallback: string;
  muted?: boolean;
}) {
  if (!category) {
    return (
      <span className="rounded-full border border-dashed border-border px-2 py-0.5 font-semibold text-muted-foreground">
        {fallback}
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold", muted && "opacity-80")}
      style={{ background: `${category.color}1F`, color: category.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: category.color }} />
      {category.name}
    </span>
  );
}
