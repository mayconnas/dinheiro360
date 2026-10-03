// ─────────────────────────────────────────────────────────────
// Camada 3 — Plano de Contas hierárquico (árvore de categorias).
//
// Uma "categoria" (gestor360.categories, migration 0009) agora pode
// ter um parent_id: cada linha é um NÓ do plano de contas, com
// profundidade ilimitada (conta → subconta → sub-subconta → ...).
//
// Uma TRANSAÇÃO amarra numa única categoria (category_id) — igual a
// hoje. Idealmente uma FOLHA (nó sem filhos), mas o sistema TOLERA
// amarrar num nó que tem filhos: esse nó soma os lançamentos diretos
// dele com o total agregado dos filhos (ver aggregateTree). Nada no
// motor (aggregate/budget/indicators/anomalies/recurrences/
// categorizer) precisa saber de hierarquia — eles continuam somando
// por category_id exato; ESTE módulo é quem sobe os totais na árvore
// para quem quiser ver o "total da conta-pai" (ex: tela de plano de
// contas, ou um filtro "ver Moradia e todas as subcategorias").
//
// Puro, sem IO. Testável isoladamente.
// ─────────────────────────────────────────────────────────────
import type { Category } from "@/lib/types";

export interface AccountTreeNode {
  category: Category;
  children: AccountTreeNode[];
  /** Profundidade a partir da raiz (raiz = 0). */
  depth: number;
}

export interface BuildTreeResult {
  /** Nós de nível raiz (parentId null OU cujo pai não existe/está em ciclo). */
  roots: AccountTreeNode[];
  /** Todos os nós, indexados por category id — acesso O(1) a qualquer nó. */
  byId: Map<string, AccountTreeNode>;
  /**
   * ids de categorias cujo parentId participava de um ciclo (A→B→A) e
   * por isso foram "cortadas" e viraram raiz para a árvore ainda assim
   * ficar bem formada. Vazio no caminho normal — só não-vazio se dado
   * foi corrompido por fora da aplicação (ver comentário na migration
   * 0009 sobre o CHECK cobrir só ciclo de profundidade 1).
   */
  brokenCycleIds: string[];
}

/**
 * Monta a árvore do plano de contas a partir da lista PLANA de
 * categorias (como vem do banco). Detecta e neutraliza ciclos: se
 * parent_id formar um laço (ex A é pai de B, B é pai de A), a
 * categoria onde o ciclo é detectado é tratada como raiz em vez de
 * travar a montagem — a árvore sempre termina sendo bem formada.
 *
 * Não muta `categories`. Preserva a ordem relativa de entrada como
 * desempate secundário; ordena cada nível por (sortOrder, name).
 */
export function buildAccountTree(categories: Category[]): BuildTreeResult {
  const byId = new Map<string, AccountTreeNode>();
  for (const category of categories) {
    byId.set(category.id, { category, children: [], depth: 0 });
  }

  const brokenCycleIds: string[] = [];

  /** true se `id` alcança `startId` de novo subindo por parentId (ciclo). */
  function wouldCycle(startId: string, parentId: string): boolean {
    let current: string | null = parentId;
    const seen = new Set<string>();
    while (current) {
      if (current === startId) return true;
      if (seen.has(current)) return true; // ciclo entre outros nós, ainda assim para
      seen.add(current);
      const parentNode: AccountTreeNode | undefined = byId.get(current);
      current = parentNode?.category.parentId ?? null;
    }
    return false;
  }

  const roots: AccountTreeNode[] = [];

  for (const node of byId.values()) {
    const parentId = node.category.parentId;
    if (!parentId) {
      roots.push(node);
      continue;
    }
    const parentNode = byId.get(parentId);
    if (!parentNode) {
      // parent_id aponta para categoria inexistente (ex: de outro
      // usuário, ou já excluída sem reparent) — trata como raiz em
      // vez de perder o nó da árvore.
      roots.push(node);
      continue;
    }
    if (wouldCycle(node.category.id, parentId)) {
      brokenCycleIds.push(node.category.id);
      roots.push(node);
      continue;
    }
    parentNode.children.push(node);
  }

  // depth: BFS a partir das raízes.
  const queue: AccountTreeNode[] = roots.map((r) => ({ ...r, depth: 0 }));
  // Reaplica depth diretamente nos objetos já referenciados em byId
  // (não recriamos nós — só atualizamos depth in place via fila).
  const visit: AccountTreeNode[] = [...roots];
  for (const r of visit) r.depth = 0;
  let i = 0;
  while (i < visit.length) {
    const current = visit[i];
    i++;
    for (const child of current.children) {
      child.depth = current.depth + 1;
      visit.push(child);
    }
  }

  const bySortThenName = (a: AccountTreeNode, b: AccountTreeNode) =>
    a.category.sortOrder - b.category.sortOrder ||
    a.category.name.localeCompare(b.category.name, "pt-BR");

  roots.sort(bySortThenName);
  for (const node of byId.values()) node.children.sort(bySortThenName);

  return { roots, byId, brokenCycleIds };
}

export interface NodeTotals {
  /** Soma dos lançamentos amarrados DIRETAMENTE a este nó. */
  direct: number;
  /** direct + soma recursiva de todos os descendentes. */
  total: number;
}

/**
 * Calcula, para cada nó da árvore, o total agregado (lançamentos
 * diretos do nó + soma recursiva dos filhos) a partir de um mapa
 * categoryId → valor direto (ex: saída de expenseByCategory() do
 * aggregate.ts, ou qualquer Map<categoryId, number> equivalente —
 * este módulo não sabe nem precisa saber a origem do valor: pode ser
 * gasto, receita, contagem de transações, etc.).
 *
 * Retorna Map<categoryId, NodeTotals> cobrindo TODOS os nós da
 * árvore, inclusive os que não têm valor direto (ficam com direct=0).
 */
export function aggregateTree(
  tree: BuildTreeResult,
  amountByCategoryId: Map<string, number>
): Map<string, NodeTotals> {
  const totals = new Map<string, NodeTotals>();

  function visit(node: AccountTreeNode): number {
    const direct = amountByCategoryId.get(node.category.id) ?? 0;
    let total = direct;
    for (const child of node.children) {
      total += visit(child);
    }
    totals.set(node.category.id, { direct, total });
    return total;
  }

  for (const root of tree.roots) visit(root);
  return totals;
}

/** true se o nó não tem filhos — candidato natural a receber transações. */
export function isLeaf(node: AccountTreeNode): boolean {
  return node.children.length === 0;
}

/** Profundidade do nó a partir da raiz (raiz = 0). */
export function depth(node: AccountTreeNode): number {
  return node.depth;
}

/** Achata a árvore de volta numa lista (pré-ordem: pai antes dos filhos). */
export function flattenTree(tree: BuildTreeResult): AccountTreeNode[] {
  const out: AccountTreeNode[] = [];
  function visit(node: AccountTreeNode) {
    out.push(node);
    for (const child of node.children) visit(child);
  }
  for (const root of tree.roots) visit(root);
  return out;
}

/**
 * ids de todos os descendentes de `categoryId` (não inclui o próprio).
 * Útil para "ao filtrar por uma conta-pai, incluir lançamentos de
 * todas as subcontas" — ex: filtrar transações por
 * [categoryId, ...getDescendants(tree, categoryId)].
 */
export function getDescendants(
  tree: BuildTreeResult,
  categoryId: string
): string[] {
  const node = tree.byId.get(categoryId);
  if (!node) return [];
  const out: string[] = [];
  function visit(n: AccountTreeNode) {
    for (const child of n.children) {
      out.push(child.category.id);
      visit(child);
    }
  }
  visit(node);
  return out;
}

/**
 * ids dos ancestrais de `categoryId`, do pai imediato até a raiz
 * (não inclui o próprio). Útil para breadcrumb ("Moradia > Aluguel")
 * ou para subir o total até a raiz ao exibir uma transação.
 */
export function getAncestors(
  tree: BuildTreeResult,
  categoryId: string
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([categoryId]);
  let current = tree.byId.get(categoryId)?.category.parentId ?? null;
  while (current && !seen.has(current)) {
    const node: AccountTreeNode | undefined = tree.byId.get(current);
    if (!node) break;
    out.push(current);
    seen.add(current);
    current = node.category.parentId;
  }
  return out;
}

/**
 * [categoryId, ...getDescendants(...)] — atalho comum para "filtre
 * transações desta conta OU de qualquer subconta dela".
 */
export function selfAndDescendants(
  tree: BuildTreeResult,
  categoryId: string
): string[] {
  return [categoryId, ...getDescendants(tree, categoryId)];
}
