"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  Loader2,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  FolderTree,
  CornerDownRight,
} from "lucide-react";
import {
  addCategory,
  updateCategory,
  deleteCategory,
  type AccountTreeUsageNode,
} from "@/app/actions/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Category, CategoryKind, CategoryNature } from "@/lib/types";
import {
  ToastProvider,
  ToastHost,
  useToast,
} from "@/components/transacoes/use-toast";

// ─────────────────────────────────────────────────────────────
// Plano de Contas — renderiza a árvore (AccountTreeUsageNode, vinda
// de listAccountTree em src/app/actions/config.ts) como uma lista
// recolhível/expansível com indentação por nível. Profundidade
// ilimitada: cada nó pode ter "+ subconta" recursivamente.
//
// O total mostrado em cada nó é `totalTxCount` (contagem de
// lançamentos do próprio nó + soma recursiva dos descendentes),
// calculado no servidor por aggregateTree (src/lib/engine/
// account-tree.ts) — este componente só exibe, não recalcula nada.
// ─────────────────────────────────────────────────────────────

/** Paleta curada — mesmo tom das categorias padrão semeadas na migration 0001, para consistência visual. */
const COLOR_PALETTE = [
  "#10b981",
  "#22c55e",
  "#6366f1",
  "#8b5cf6",
  "#f59e0b",
  "#06b6d4",
  "#ef4444",
  "#f97316",
  "#ec4899",
  "#a855f7",
  "#3b82f6",
  "#14b8a6",
  "#84cc16",
  "#eab308",
  "#94a3b8",
  "#64748b",
];

const NATURE_META: Record<CategoryNature, string> = {
  fixa: "Fixa",
  variavel: "Variável",
  discricionaria: "Discricionária",
  receita: "Receita",
};

/** Achata a árvore de volta numa lista plana de Category — usado para popular o select de "conta-pai" nos formulários. */
function flattenCategories(nodes: AccountTreeUsageNode[]): Category[] {
  const out: Category[] = [];
  function visit(n: AccountTreeUsageNode) {
    out.push(n.category);
    for (const child of n.children) visit(child);
  }
  for (const n of nodes) visit(n);
  return out;
}

export function CategoriasView({ tree }: { tree: AccountTreeUsageNode[] }) {
  return (
    <ToastProvider>
      <CategoriasViewInner tree={tree} />
      <ToastHost />
    </ToastProvider>
  );
}

function CategoriasViewInner({ tree }: { tree: AccountTreeUsageNode[] }) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<AccountTreeUsageNode | null>(null);
  const [deleting, setDeleting] = useState<AccountTreeUsageNode | null>(null);
  const [creatingUnder, setCreatingUnder] = useState<AccountTreeUsageNode | null>(
    null
  );
  const [creatingRootKind, setCreatingRootKind] = useState<CategoryKind | null>(
    null
  );
  // Nós recolhidos (por id). Por padrão tudo expandido — mais fácil
  // ver "profundidade ilimitada" funcionando de cara.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const allCategories = useMemo(() => flattenCategories(tree), [tree]);

  const receitas = useMemo(
    () => tree.filter((n) => n.category.kind === "receita"),
    [tree]
  );
  const despesas = useMemo(
    () => tree.filter((n) => n.category.kind === "despesa"),
    [tree]
  );

  function toggleCollapsed(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleDelete(node: AccountTreeUsageNode) {
    startTransition(async () => {
      const result = await deleteCategory(node.category.id);
      if (result.ok) {
        const parts: string[] = [];
        if (result.reparentedCount > 0) {
          parts.push(
            `${result.reparentedCount} subconta${result.reparentedCount === 1 ? "" : "s"} movida${result.reparentedCount === 1 ? "" : "s"} para o nível acima`
          );
        }
        if (result.movedCount > 0) {
          parts.push(
            `${result.movedCount} lançamento${result.movedCount === 1 ? "" : "s"} movido${result.movedCount === 1 ? "" : "s"} para "A revisar"`
          );
        }
        showToast(
          parts.length > 0 ? `Conta excluída. ${parts.join("; ")}.` : "Conta excluída.",
          { variant: "success" }
        );
        setDeleting(null);
      } else {
        showToast(result.error ?? "Erro ao excluir conta.", { variant: "error" });
      }
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FolderTree className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Plano de Contas</h1>
            <p className="text-muted-foreground">
              Organize contas e subcontas em camadas. Uma transação sempre
              fica presa numa conta; o total de uma conta-pai soma tudo o
              que está dentro dela.
            </p>
          </div>
        </div>
      </div>

      <AccountGroup
        title="Receitas"
        icon={TrendingUp}
        iconClass="text-success"
        nodes={receitas}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onEdit={setEditing}
        onDelete={setDeleting}
        onAddChild={setCreatingUnder}
        onAddRoot={() => setCreatingRootKind("receita")}
      />
      <AccountGroup
        title="Despesas"
        icon={TrendingDown}
        iconClass="text-destructive"
        nodes={despesas}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        onEdit={setEditing}
        onDelete={setDeleting}
        onAddChild={setCreatingUnder}
        onAddRoot={() => setCreatingRootKind("despesa")}
      />

      <CategoryFormDialog
        mode="create"
        parentNode={creatingUnder}
        defaultKind={creatingRootKind ?? "despesa"}
        allCategories={allCategories}
        open={creatingUnder !== null || creatingRootKind !== null}
        onOpenChange={(v) => {
          if (!v) {
            setCreatingUnder(null);
            setCreatingRootKind(null);
          }
        }}
        onSaved={(label) =>
          showToast(label ? `"${label}" criada.` : "Conta criada.", {
            variant: "success",
          })
        }
      />

      <CategoryFormDialog
        mode="edit"
        node={editing}
        allCategories={allCategories}
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        onSaved={() => {
          showToast("Conta atualizada.", { variant: "success" });
          setEditing(null);
        }}
      />

      <Dialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-warning" />
              Excluir &quot;{deleting?.category.name}&quot;?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm text-muted-foreground">
            {deleting && deleting.children.length > 0 && (
              <p>
                Essa conta tem{" "}
                <strong className="text-foreground">
                  {deleting.children.length} subconta
                  {deleting.children.length === 1 ? "" : "s"}
                </strong>
                . {deleting.children.length === 1 ? "Ela" : "Elas"} não{" "}
                {deleting.children.length === 1 ? "será excluída" : "serão excluídas"}:{" "}
                {deleting.children.length === 1 ? "sobe" : "sobem"} um nível na árvore.
              </p>
            )}
            {deleting && deleting.directTxCount > 0 ? (
              <p>
                Essa conta tem{" "}
                <strong className="text-foreground">
                  {deleting.directTxCount} lançamento
                  {deleting.directTxCount === 1 ? "" : "s"}
                </strong>{" "}
                presos diretamente a ela. Ao excluir,{" "}
                {deleting.directTxCount === 1 ? "ele será movido" : "eles serão movidos"}{" "}
                para <strong className="text-foreground">&quot;A revisar&quot;</strong> —
                nenhuma transação fica sem categoria.
              </p>
            ) : (
              <p>Nenhum lançamento preso diretamente a essa conta.</p>
            )}
            <p>Essa ação não pode ser desfeita.</p>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleting && handleDelete(deleting)}
              disabled={pending}
              className="gap-2"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountGroup({
  title,
  icon: Icon,
  iconClass,
  nodes,
  collapsed,
  onToggleCollapsed,
  onEdit,
  onDelete,
  onAddChild,
  onAddRoot,
}: {
  title: string;
  icon: typeof TrendingUp;
  iconClass: string;
  nodes: AccountTreeUsageNode[];
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onEdit: (n: AccountTreeUsageNode) => void;
  onDelete: (n: AccountTreeUsageNode) => void;
  onAddChild: (n: AccountTreeUsageNode) => void;
  onAddRoot: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={cn("h-4 w-4", iconClass)} />
          <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            {title}
          </h2>
          <span className="text-xs text-muted-foreground">({nodes.length})</span>
        </div>
        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={onAddRoot}>
          <Plus className="h-3.5 w-3.5" />
          Nova conta de {title.toLowerCase()}
        </Button>
      </div>

      {nodes.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          Nenhuma conta de {title.toLowerCase()} ainda.
        </p>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {nodes.map((node) => (
              <AccountRow
                key={node.category.id}
                node={node}
                collapsed={collapsed}
                onToggleCollapsed={onToggleCollapsed}
                onEdit={onEdit}
                onDelete={onDelete}
                onAddChild={onAddChild}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AccountRow({
  node,
  collapsed,
  onToggleCollapsed,
  onEdit,
  onDelete,
  onAddChild,
}: {
  node: AccountTreeUsageNode;
  collapsed: Set<string>;
  onToggleCollapsed: (id: string) => void;
  onEdit: (n: AccountTreeUsageNode) => void;
  onDelete: (n: AccountTreeUsageNode) => void;
  onAddChild: (n: AccountTreeUsageNode) => void;
}) {
  const { category, children, depth, directTxCount, totalTxCount } = node;
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(category.id);

  return (
    <div>
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ paddingLeft: `${16 + depth * 24}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggleCollapsed(category.id)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={isCollapsed ? `Expandir ${category.name}` : `Recolher ${category.name}`}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground/40">
            {depth > 0 ? <CornerDownRight className="h-3.5 w-3.5" /> : null}
          </span>
        )}

        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ background: category.color }}
          aria-hidden
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate font-medium">{category.name}</span>
            {category.code && (
              <span className="text-xs text-muted-foreground">{category.code}</span>
            )}
            {hasChildren && (
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {children.length} subconta{children.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {NATURE_META[category.nature]} · {totalTxCount} lançamento
            {totalTxCount === 1 ? "" : "s"}
            {hasChildren && directTxCount !== totalTxCount && (
              <> ({directTxCount} direto{directTxCount === 1 ? "" : "s"})</>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onAddChild(node)}
            aria-label={`Adicionar subconta em ${category.name}`}
            title="Adicionar subconta"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => onEdit(node)}
            aria-label={`Editar ${category.name}`}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={() => onDelete(node)}
            aria-label={`Excluir ${category.name}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {hasChildren && !isCollapsed && (
        <div className="divide-y divide-border border-t border-border">
          {children.map((child) => (
            <AccountRow
              key={child.category.id}
              node={child}
              collapsed={collapsed}
              onToggleCollapsed={onToggleCollapsed}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddChild={onAddChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface CategoryFormDialogProps {
  mode: "create" | "edit";
  /** modo create: nó sob o qual a nova conta nasce (undefined/null = raiz). */
  parentNode?: AccountTreeUsageNode | null;
  /** modo create, quando não há parentNode: kind da nova conta-raiz. */
  defaultKind?: CategoryKind;
  /** modo edit: nó sendo editado. */
  node?: AccountTreeUsageNode | null;
  /** lista plana de todas as categorias — para o select de "mover para". */
  allCategories: Category[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (label?: string) => void;
}

/** "Salário > Salário CLT" — label indentado por profundidade, pro select de conta-pai. */
function buildParentLabel(cat: Category, byId: Map<string, Category>): string {
  const parts: string[] = [cat.name];
  let current = cat.parentId;
  const seen = new Set<string>([cat.id]);
  while (current && !seen.has(current)) {
    const parent = byId.get(current);
    if (!parent) break;
    parts.unshift(parent.name);
    seen.add(current);
    current = parent.parentId;
  }
  return parts.join(" › ");
}

/** ids de `cat` + todos os seus descendentes — usado pra excluir do select de "mover para" (não pode virar filho do próprio filho). */
function selfAndDescendantIds(catId: string, all: Category[]): Set<string> {
  const out = new Set<string>([catId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of all) {
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        changed = true;
      }
    }
  }
  return out;
}

function CategoryFormDialog({
  mode,
  parentNode,
  defaultKind,
  node,
  allCategories,
  open,
  onOpenChange,
  onSaved,
}: CategoryFormDialogProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const category = node?.category ?? null;

  const kind: CategoryKind =
    mode === "create"
      ? parentNode?.category.kind ?? defaultKind ?? "despesa"
      : category?.kind ?? "despesa";

  const [name, setName] = useState(category?.name ?? "");
  const [nature, setNature] = useState<CategoryNature>(category?.nature ?? "variavel");
  const [color, setColor] = useState(category?.color ?? COLOR_PALETTE[0]);
  const [parentId, setParentId] = useState<string | null>(
    mode === "create" ? parentNode?.category.id ?? null : category?.parentId ?? null
  );

  // Reidrata o form sempre que o dialog abre com um alvo diferente
  // (edição de outra conta, criação sob outro pai, ou reabertura em
  // branco) — evita reaproveitar estado do form anterior.
  const targetKey =
    mode === "edit"
      ? category?.id ?? null
      : `new:${parentNode?.category.id ?? "root"}:${defaultKind ?? ""}`;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (open && targetKey !== loadedFor) {
    setLoadedFor(targetKey);
    setError(null);
    if (mode === "edit" && category) {
      setName(category.name);
      setNature(category.nature);
      setColor(category.color);
      setParentId(category.parentId);
    } else {
      setName("");
      setNature(kind === "receita" ? "receita" : "variavel");
      setColor(COLOR_PALETTE[0]);
      setParentId(parentNode?.category.id ?? null);
    }
  }

  const byId = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of allCategories) m.set(c.id, c);
    return m;
  }, [allCategories]);

  // Opções de "conta-pai": mesmo kind, e nunca a própria conta nem um
  // descendente dela (criaria ciclo — updateCategory também valida
  // isso no servidor, mas filtrar aqui evita a viagem de rede inútil).
  const excludedIds = useMemo(
    () =>
      mode === "edit" && category
        ? selfAndDescendantIds(category.id, allCategories)
        : new Set<string>(),
    [mode, category, allCategories]
  );
  const parentOptions = useMemo(
    () =>
      allCategories
        .filter((c) => c.kind === kind && !excludedIds.has(c.id))
        .map((c) => ({ id: c.id, label: buildParentLabel(c, byId) }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [allCategories, kind, excludedIds, byId]
  );

  const natureOptions: CategoryNature[] =
    kind === "receita" ? ["receita"] : ["fixa", "variavel", "discricionaria"];

  function handleSubmit() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Informe um nome para a conta.");
      return;
    }
    startTransition(async () => {
      try {
        if (mode === "create") {
          await addCategory({ name: trimmed, kind, nature, color, parentId });
          onOpenChange(false);
          onSaved(trimmed);
        } else if (category) {
          const result = await updateCategory(category.id, {
            name: trimmed,
            color,
            nature,
            parentId,
          });
          if (result.ok) {
            onOpenChange(false);
            onSaved(trimmed);
          } else {
            setError(result.error ?? "Erro ao atualizar conta.");
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao salvar conta.");
      }
    });
  }

  const isReviewCategory = category?.name.trim().toLowerCase() === "a revisar";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? parentNode
                ? `Nova subconta em "${parentNode.category.name}"`
                : "Nova conta"
              : `Editar "${category?.name}"`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cat-name">Nome</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Streaming, Pet, Educação…"
              autoFocus
              disabled={isReviewCategory}
            />
          </div>

          {mode === "create" && parentNode && (
            <p className="text-xs text-muted-foreground">
              Tipo: <strong>{kind === "receita" ? "Receita" : "Despesa"}</strong>{" "}
              (herdado de &quot;{parentNode.category.name}&quot;)
            </p>
          )}
          {mode === "create" && !parentNode && (
            <p className="text-xs text-muted-foreground">
              Tipo: <strong>{kind === "receita" ? "Receita" : "Despesa"}</strong>
            </p>
          )}

          {kind === "despesa" && (
            <div className="space-y-2">
              <Label>Natureza</Label>
              <Select value={nature} onValueChange={(v) => setNature(v as CategoryNature)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {natureOptions.map((n) => (
                    <SelectItem key={n} value={n}>
                      {NATURE_META[n]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {!isReviewCategory && (
            <div className="space-y-2">
              <Label>Conta-pai (opcional)</Label>
              <Select
                value={parentId ?? "__root__"}
                onValueChange={(v) => setParentId(v === "__root__" ? null : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">Nenhuma (conta de nível raiz)</SelectItem>
                  {parentOptions.map((opt) => (
                    <SelectItem key={opt.id} value={opt.id}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Mover para dentro de outra conta soma esta como subconta —
                os totais sobem automaticamente.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Selecionar cor ${c}`}
                  className={cn(
                    "h-7 w-7 rounded-full ring-offset-2 ring-offset-background transition-transform hover:scale-110",
                    color === c && "ring-2 ring-foreground"
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={pending} className="w-full gap-2">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "create" ? "Criar conta" : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
