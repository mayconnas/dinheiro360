"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth/session";
import type { DbClient, TablesUpdate } from "@/lib/supabase/database.types";
import {
  accountKind,
  categoryKind,
  categoryNature,
  employmentType,
  hexColor,
  isoDate,
  money,
  parseInput,
  trimmedText,
  uuid,
} from "@/lib/validation";
import { z } from "zod";
import { toCategory } from "@/lib/data/mappers";
import type { Category, CategoryNature, EmploymentType } from "@/lib/types";
import {
  buildAccountTree,
  aggregateTree,
  type AccountTreeNode,
} from "@/lib/engine/account-tree";


// ─── Schemas de entrada (Server Actions são endpoints públicos) ───
const ProfileInput = z.object({
  displayName: z.string().trim().max(80, "Nome muito longo.").optional(),
  monthlyIncome: money.optional(),
  employmentType: employmentType.optional(),
  dependents: z.number().int().min(0).max(30).optional(),
});
const GoalInput = z.object({
  name: trimmedText(80, "Nome da meta"),
  targetAmount: money,
  currentAmount: money.optional(),
  deadline: isoDate.nullable().optional(),
});
const GoalPatch = GoalInput.pick({ targetAmount: true, currentAmount: true, deadline: true }).partial();
const AccountInput = z.object({
  name: trimmedText(80, "Nome da conta"),
  kind: accountKind,
  openingBalance: z.number().finite().optional(),
});
const CategoryInput = z.object({
  name: trimmedText(60, "Nome da categoria"),
  kind: categoryKind,
  nature: categoryNature,
  color: hexColor.optional(),
  parentId: uuid.nullable().optional(),
});
const CategoryPatch = z.object({
  name: trimmedText(60, "Nome da categoria").optional(),
  color: hexColor.optional(),
  nature: categoryNature.optional(),
  parentId: uuid.nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
});
const RulePattern = z.string().trim().min(3, "O padrão precisa de ao menos 3 caracteres.").max(120);

/**
 * category_id de TODOS os lançamentos categorizados do usuário, paginado
 * (o PostgREST corta acima de max-rows sem erro — sem o loop, a contagem
 * de uso por categoria ficaria errada em históricos grandes).
 */
async function fetchCategorizedTxIds(
  supabase: DbClient,
  userId: string
): Promise<{ data: { category_id: string | null }[]; error: { message: string } | null }> {
  const PAGE = 1000;
  const out: { category_id: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("transactions")
      .select("category_id")
      .eq("user_id", userId)
      .not("category_id", "is", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return { data: out, error: null };
  }
}

// ─── Perfil ───
export async function updateProfile(input: {
  displayName?: string;
  monthlyIncome?: number;
  employmentType?: EmploymentType;
  dependents?: number;
}) {
  input = parseInput(ProfileInput, input);
  const userId = await requireUserId();
  const supabase = await createClient();
  const patch: TablesUpdate<"profiles"> = {};
  if (input.displayName !== undefined) patch.display_name = input.displayName;
  if (input.monthlyIncome !== undefined)
    patch.monthly_income = input.monthlyIncome;
  if (input.employmentType !== undefined)
    patch.employment_type = input.employmentType;
  if (input.dependents !== undefined) patch.dependents = input.dependents;

  const { error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/perfil");
  revalidatePath("/");
}

// ─── Orçamento ───
export async function setBudget(categoryId: string, limit: number) {
  categoryId = parseInput(uuid, categoryId);
  limit = parseInput(money, limit);
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("budgets").upsert(
    { user_id: userId, category_id: categoryId, monthly_limit: limit },
    { onConflict: "user_id,category_id" }
  );
  if (error) throw new Error(error.message);
  revalidatePath("/orcamento");
  revalidatePath("/");
}

export async function removeBudget(categoryId: string) {
  categoryId = parseInput(uuid, categoryId);
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("budgets")
    .delete()
    .eq("user_id", userId)
    .eq("category_id", categoryId);
  if (error) throw new Error(error.message);
  revalidatePath("/orcamento");
  revalidatePath("/");
}

// ─── Metas ───
export async function addGoal(input: {
  name: string;
  targetAmount: number;
  currentAmount?: number;
  deadline?: string | null;
}) {
  input = parseInput(GoalInput, input);
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("goals").insert({
    user_id: userId,
    name: input.name,
    target_amount: input.targetAmount,
    current_amount: input.currentAmount ?? 0,
    deadline: input.deadline ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/metas");
  revalidatePath("/");
}

export async function updateGoal(
  goalId: string,
  input: { currentAmount?: number; targetAmount?: number; deadline?: string | null }
) {
  goalId = parseInput(uuid, goalId);
  input = parseInput(GoalPatch, input);
  const userId = await requireUserId();
  const supabase = await createClient();
  const patch: TablesUpdate<"goals"> = {};
  if (input.currentAmount !== undefined)
    patch.current_amount = input.currentAmount;
  if (input.targetAmount !== undefined) patch.target_amount = input.targetAmount;
  if (input.deadline !== undefined) patch.deadline = input.deadline;
  const { error } = await supabase
    .from("goals")
    .update(patch)
    .eq("id", goalId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/metas");
  revalidatePath("/");
}

export async function deleteGoal(goalId: string) {
  goalId = parseInput(uuid, goalId);
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("goals")
    .delete()
    .eq("id", goalId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  revalidatePath("/metas");
  revalidatePath("/");
}

// ─── Contas ───
export async function addAccount(rawInput: {
  name: string;
  kind: string;
  openingBalance?: number;
}) {
  const input = parseInput(AccountInput, rawInput);
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("accounts").insert({
    user_id: userId,
    name: input.name,
    kind: input.kind,
    opening_balance: input.openingBalance ?? 0,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/perfil");
  revalidatePath("/");
}

// ─── Categorias / Plano de contas ───

/**
 * Cria uma categoria (nó do plano de contas). `parentId`, quando
 * informado, faz o novo nó nascer como FILHO daquele nó — e o `kind`
 * do filho é forçado a ser o MESMO do pai (um filho de uma conta de
 * despesa é sempre despesa; não faz sentido um plano de contas com
 * receita dentro de despesa). `nature`/`color` continuam livres por
 * nó, inclusive entre pai e filho.
 */
export async function addCategory(input: {
  name: string;
  kind: "receita" | "despesa";
  nature: "fixa" | "variavel" | "discricionaria" | "receita";
  color?: string;
  parentId?: string | null;
}) {
  input = parseInput(CategoryInput, input);
  const userId = await requireUserId();
  const supabase = await createClient();

  // "A revisar" é o destino sentinela de deleteCategory (busca por
  // ilike + no máximo 1 linha) — impedir uma 2ª categoria com esse nome
  // aqui evita a mesma classe de problema coberta em updateCategory.
  const trimmed = input.name.trim();
  if (trimmed.toLowerCase() === "a revisar") {
    throw new Error(
      '"A revisar" é um nome reservado (destino das transações ao excluir uma categoria) — escolha outro nome.'
    );
  }

  let kind = input.kind;
  const parentId: string | null = input.parentId ?? null;
  if (parentId) {
    const { data: parent, error: parentErr } = await supabase
      .from("categories")
      .select("id, kind")
      .eq("id", parentId)
      .eq("user_id", userId)
      .single();
    if (parentErr || !parent) {
      throw new Error("Categoria-pai não encontrada.");
    }
    // Filho herda o kind do pai — nunca cria um nó de kind diferente
    // dentro de uma subárvore (evita "Despesa" dentro de "Receita").
    kind = parent.kind;
  }

  const { error } = await supabase.from("categories").insert({
    user_id: userId,
    name: trimmed,
    kind,
    nature: input.nature,
    color: input.color ?? "#64748b",
    is_system: false,
    parent_id: parentId,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/transacoes");
  revalidatePath("/orcamento");
  revalidatePath("/categorias");
}

export interface CategoryActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Lista as categorias do usuário (ordenadas por nome) — usado pela tela
 * de gestão de categorias. Fina o suficiente para não precisar reusar o
 * getCategories() cacheado do repository (que é "use server-only" e já
 * é consumido em RSC); esta é uma server action chamável do client.
 */
export async function listCategories(): Promise<Category[]> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", userId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map(toCategory);
}

export interface CategoryWithUsage extends Category {
  /** Nº de transações do usuário atualmente nessa categoria — usado pela tela de gestão de categorias (contagem de uso + aviso na exclusão). */
  txCount: number;
}

/**
 * Lista as categorias do usuário já com a contagem de transações em
 * cada uma (para a tela de gestão de categorias mostrar "N lançamentos"
 * e avisar, antes de excluir, quantas transações serão movidas para
 * "A revisar"). Uma query agregada em vez de N+1: busca todos os
 * category_id de transactions do usuário e conta em memória — a tabela
 * de categorias é pequena (dezenas de linhas), então isso é mais barato
 * que 33 queries `count` separadas.
 */
export async function listCategoriesWithUsage(): Promise<CategoryWithUsage[]> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const [{ data: cats, error: catErr }, { data: txs, error: txErr }] =
    await Promise.all([
      supabase.from("categories").select("*").eq("user_id", userId).order("name"),
      fetchCategorizedTxIds(supabase, userId),
    ]);
  if (catErr) throw new Error(catErr.message);
  if (txErr) throw new Error(txErr.message);

  const counts = new Map<string, number>();
  for (const row of txs ?? []) {
    const id = row.category_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return (cats ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    kind: r.kind,
    nature: r.nature,
    color: r.color,
    isSystem: r.is_system,
    parentId: r.parent_id ?? null,
    sortOrder: r.sort_order ?? 0,
    code: r.code ?? null,
    txCount: counts.get(r.id) ?? 0,
  }));
}

/**
 * Sobe a árvore a partir de `startId` seguindo parent_id; true se
 * `targetId` aparece no caminho (ou seja, mover `startId` para dentro
 * de `targetId` criaria um ciclo). Também para (retornando true, por
 * segurança) se detectar um ciclo pré-existente nos dados — nunca
 * entra em loop infinito. Uma query por nível de profundidade (a
 * árvore de categorias de um usuário é pequena — dezenas de nós — e
 * mover um nó é uma ação humana pouco frequente, não um hot path).
 */
async function wouldCreateCycle(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  startId: string,
  targetParentId: string
): Promise<boolean> {
  let current: string | null = targetParentId;
  const seen = new Set<string>();
  while (current) {
    if (current === startId) return true;
    if (seen.has(current)) return true; // ciclo pré-existente nos dados; não trava, mas bloqueia o move
    seen.add(current);
    const { data, error }: { data: { parent_id: string | null } | null; error: unknown } =
      await supabase
        .from("categories")
        .select("parent_id")
        .eq("id", current)
        .eq("user_id", userId)
        .single();
    if (error || !data) return false; // pai não encontrado: caminho termina, sem ciclo
    current = data.parent_id ?? null;
  }
  return false;
}

/**
 * Renomeia / muda cor / muda natureza / MOVE (parentId) / reordena
 * (sortOrder) uma categoria. Permitido também para categorias de
 * sistema (is_system=true) — decisão de produto: as categorias
 * padrão podem ser customizadas e reposicionadas na árvore pelo
 * usuário, só não podem ter o `kind` trocado diretamente aqui (mudar
 * receita↔despesa quebraria os filtros já aplicados nas transações
 * existentes; se o usuário quiser isso, é "criar categoria nova" +
 * mover as transações). Mover um nó (`parentId`) TAMBÉM não muda o
 * `kind` do nó nem dos descendentes automaticamente — só é permitido
 * mover para um novo pai do MESMO kind (ou para raiz), exatamente
 * pelo mesmo motivo.
 * `.eq("user_id", userId)` é defesa em profundidade: a RLS já impede
 * cross-user, mas escopamos explicitamente mesmo assim.
 */
export async function updateCategory(
  id: string,
  input: {
    name?: string;
    color?: string;
    nature?: CategoryNature;
    /** novo pai; `null` move o nó para raiz (top-level). */
    parentId?: string | null;
    sortOrder?: number;
  }
): Promise<CategoryActionResult> {
  try {
    id = parseInput(uuid, id);
    input = parseInput(CategoryPatch, input);
    const userId = await requireUserId();
    const supabase = await createClient();

    const { data: current, error: curErr } = await supabase
      .from("categories")
      .select("id, name, kind")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (curErr) throw new Error(curErr.message);
    if (!current) throw new Error("Categoria não encontrada.");

    const patch: TablesUpdate<"categories"> = {};
    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (!trimmed) throw new Error("Nome da categoria não pode ficar vazio.");

      // "A revisar" é o destino sentinela usado por deleteCategory (via
      // ilike + .maybeSingle()) para migrar transações órfãs — precisa
      // permanecer ÚNICO e presente. Bloqueamos as duas formas de quebrar
      // essa invariante pelo formulário de edição: (1) renomear QUALQUER
      // outra categoria para "A revisar" (criaria duplicata → .maybeSingle()
      // em deleteCategory passaria a lançar erro para TODA exclusão, não só
      // desta categoria); (2) renomear a própria "A revisar" para outro nome
      // (deixaria de existir o destino sentinela → deleteCategory bloquearia
      // toda exclusão por "não encontrada").
      const isCurrentReview = current.name.trim().toLowerCase() === "a revisar";
      const wantsReviewName = trimmed.toLowerCase() === "a revisar";
      if (wantsReviewName && !isCurrentReview) {
        throw new Error(
          '"A revisar" é um nome reservado (destino das transações ao excluir uma categoria) — escolha outro nome.'
        );
      }
      if (isCurrentReview && !wantsReviewName) {
        throw new Error(
          'A categoria "A revisar" não pode ser renomeada — é o destino padrão das transações órfãs.'
        );
      }
      patch.name = trimmed;
    }
    if (input.color !== undefined) patch.color = input.color;
    if (input.nature !== undefined) patch.nature = input.nature;
    if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder;

    if (input.parentId !== undefined) {
      const newParentId = input.parentId;
      if (newParentId === id) {
        throw new Error("Uma categoria não pode ser pai de si mesma.");
      }
      if (newParentId === null) {
        patch.parent_id = null;
      } else {
        const { data: parent, error: parentErr } = await supabase
          .from("categories")
          .select("id, kind, name")
          .eq("id", newParentId)
          .eq("user_id", userId)
          .single();
        if (parentErr || !parent) {
          throw new Error("Categoria-pai não encontrada.");
        }
        if (parent.kind !== current.kind) {
          throw new Error(
            `Não é possível mover para dentro de "${parent.name}": tipos diferentes (receita/despesa).`
          );
        }
        if (await wouldCreateCycle(supabase, userId, id, newParentId)) {
          throw new Error(
            "Não é possível mover uma categoria para dentro de uma de suas próprias subcategorias."
          );
        }
        patch.parent_id = newParentId;
      }
    }

    if (Object.keys(patch).length === 0) return { ok: true };

    const { error } = await supabase
      .from("categories")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);

    revalidatePath("/transacoes");
    revalidatePath("/orcamento");
    revalidatePath("/categorias");
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Erro ao atualizar categoria.",
    };
  }
}

export interface DeleteCategoryResult {
  ok: boolean;
  movedCount: number;
  /** nº de subcategorias diretas que foram REPARENTADAS (não excluídas). */
  reparentedCount: number;
  error?: string;
}

/**
 * Exclui uma categoria (nó do plano de contas). NUNCA deixa transação
 * órfã e NUNCA deixa a árvore quebrada:
 *
 *  1. Se o nó tem FILHOS diretos, eles são REPARENTADOS para o AVÔ
 *     (parent_id do nó excluído) — ou viram raiz, se o nó excluído já
 *     era raiz. A subárvore inteira continua existindo, só "sobe um
 *     nível"; nenhuma subcategoria é apagada nem fica órfã.
 *  2. As TRANSAÇÕES amarradas diretamente a este nó (não às
 *     subcategorias — essas continuam com as delas) migram para "A
 *     revisar", marcando needs_review=true (reentram no fluxo normal
 *     de revisão) — igual ao comportamento pré-hierarquia.
 *  3. Só então o nó é excluído.
 *
 * Essa é a escolha seguravel entre as duas opções cogitadas
 * (reparentar vs. bloquear exclusão se tiver filhos/transações):
 * bloquear obrigaria o usuário a excluir a árvore de baixo para cima
 * manualmente; reparentar preserva todo o trabalho de organização
 * already feito nos netos e é reversível (o usuário pode mover de
 * volta). Documentado aqui por ser a decisão de produto do plano de
 * contas (migration 0009).
 *
 * Payees que tinham essa categoria como default_category_id caem para
 * NULL sozinhos via ON DELETE SET NULL (migration 0007). Regras
 * (category_rules) referenciam a categoria com ON DELETE CASCADE
 * (migration 0001), então são removidas junto.
 *
 * Recusa excluir a própria categoria "A revisar" (não há para onde
 * migrar as transações dela); categorias de sistema não são um caso
 * especial — seguem a mesma regra segura.
 */
export async function deleteCategory(id: string): Promise<DeleteCategoryResult> {
  try {
    id = parseInput(uuid, id);
    const userId = await requireUserId();
    const supabase = await createClient();

    const { data: target, error: targetErr } = await supabase
      .from("categories")
      .select("id, name, parent_id")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    if (targetErr) throw new Error(targetErr.message);
    if (!target) throw new Error("Categoria não encontrada.");

    const isReviewCategory = target.name.trim().toLowerCase() === "a revisar";

    // .limit(1) em vez de .maybeSingle(): updateCategory já impede duas
    // categorias chamadas "A revisar" (nome reservado), mas esta query não
    // pode virar um erro 500 (PGRST116, "multiple rows") se essa invariante
    // for violada por qualquer outro caminho (edição direta no banco,
    // dado legado) — degrada para "usa a primeira encontrada" em vez de
    // travar toda e qualquer exclusão de categoria do usuário.
    const { data: revisarRows, error: revisarErr } = await supabase
      .from("categories")
      .select("id")
      .eq("user_id", userId)
      .ilike("name", "a revisar")
      .limit(1);
    if (revisarErr) throw new Error(revisarErr.message);
    const revisar = revisarRows?.[0] ?? null;

    if (isReviewCategory) {
      throw new Error(
        "A categoria \"A revisar\" não pode ser excluída — é o destino padrão das transações órfãs."
      );
    }
    if (!revisar) {
      throw new Error(
        "Categoria \"A revisar\" não encontrada — exclusão bloqueada para não deixar transações órfãs."
      );
    }

    // 1) Reparenta os FILHOS diretos para o AVÔ (parent_id do nó
    // excluído — pode ser null, e aí os filhos viram raiz). Antes de
    // excluir o nó, para nunca existir uma janela com parent_id
    // apontando para categoria inexistente.
    const { data: reparented, error: reparentErr } = await supabase
      .from("categories")
      .update({ parent_id: target.parent_id })
      .eq("user_id", userId)
      .eq("parent_id", id)
      .select("id");
    if (reparentErr) throw new Error(reparentErr.message);

    // 2) Migra as transações amarradas DIRETAMENTE a este nó (não às
    // subcategorias, que já foram reparentadas e mantêm as próprias
    // transações intactas) para "A revisar", ANTES de excluir.
    const { data: moved, error: moveErr } = await supabase
      .from("transactions")
      .update({ category_id: revisar.id, needs_review: true })
      .eq("user_id", userId)
      .eq("category_id", id)
      .select("id");
    if (moveErr) throw new Error(moveErr.message);

    // 3) Só agora exclui o nó — filhos já reparentados, transações já migradas.
    const { error: delErr } = await supabase
      .from("categories")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (delErr) throw new Error(delErr.message);

    revalidatePath("/");
    revalidatePath("/transacoes");
    revalidatePath("/orcamento");
    revalidatePath("/categorias");
    return {
      ok: true,
      movedCount: moved?.length ?? 0,
      reparentedCount: reparented?.length ?? 0,
    };
  } catch (e) {
    return {
      ok: false,
      movedCount: 0,
      reparentedCount: 0,
      error: e instanceof Error ? e.message : "Erro ao excluir categoria.",
    };
  }
}

// ─── Plano de contas (árvore) ───

export interface AccountTreeUsageNode {
  category: Category;
  children: AccountTreeUsageNode[];
  depth: number;
  /** nº de transações amarradas DIRETAMENTE a este nó. */
  directTxCount: number;
  /** directTxCount + soma recursiva dos filhos — "total da conta". */
  totalTxCount: number;
}

/**
 * Monta o plano de contas completo do usuário (todas as categorias,
 * já em árvore) com a contagem de transações de cada nó — direta (só
 * as amarradas nele) e total (ele + todos os descendentes). Usa
 * buildAccountTree/aggregateTree (src/lib/engine/account-tree.ts),
 * puros e testados isoladamente; esta action só busca os dados e
 * empacota o resultado para a tela de plano de contas.
 */
export async function listAccountTree(): Promise<AccountTreeUsageNode[]> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const [{ data: cats, error: catErr }, { data: txs, error: txErr }] =
    await Promise.all([
      supabase.from("categories").select("*").eq("user_id", userId).order("name"),
      fetchCategorizedTxIds(supabase, userId),
    ]);
  if (catErr) throw new Error(catErr.message);
  if (txErr) throw new Error(txErr.message);

  const categories: Category[] = (cats ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    kind: r.kind,
    nature: r.nature,
    color: r.color,
    isSystem: r.is_system,
    parentId: r.parent_id ?? null,
    sortOrder: r.sort_order ?? 0,
    code: r.code ?? null,
  }));

  const directCounts = new Map<string, number>();
  for (const row of txs ?? []) {
    const catId = row.category_id as string;
    directCounts.set(catId, (directCounts.get(catId) ?? 0) + 1);
  }

  const tree = buildAccountTree(categories);
  const totals = aggregateTree(tree, directCounts);

  function toUsageNode(node: AccountTreeNode): AccountTreeUsageNode {
    const t = totals.get(node.category.id) ?? { direct: 0, total: 0 };
    return {
      category: node.category,
      children: node.children.map(toUsageNode),
      depth: node.depth,
      directTxCount: t.direct,
      totalTxCount: t.total,
    };
  }

  return tree.roots.map(toUsageNode);
}

// ─── Regras de categorização (manual) ───
export async function addRule(pattern: string, categoryId: string) {
  pattern = parseInput(RulePattern, pattern);
  categoryId = parseInput(uuid, categoryId);
  const userId = await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase.from("category_rules").insert({
    user_id: userId,
    pattern,
    category_id: categoryId,
    source: "manual",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/transacoes");
}
