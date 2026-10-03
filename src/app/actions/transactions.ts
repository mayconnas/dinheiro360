"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  getCategories,
  getRules,
  getTransactions,
  buildMemory,
} from "@/lib/data/repository";
import { normalize } from "@/lib/engine/normalizer";
import { categorize } from "@/lib/engine/categorizer";
import { upsertLearnedRule } from "@/lib/data/learned-rules";
import { dedupeAgainstExisting, dedupeWithinBatch } from "@/lib/engine/dedup";
import { manualConnector, importCSVConnector } from "@/lib/engine/connectors";
import { computeSuggestions, type SuggestionEntry } from "@/lib/engine/suggestions";
import {
  resolvePayeeIdForTransactionWithCategory,
  commitPayeeAggregates,
} from "@/lib/data/payees-repo";
import type { TransactionType } from "@/lib/types";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  return user.id;
}

export interface AddTransactionInput {
  date: string;
  amount: number;
  type: TransactionType;
  description: string;
  accountId?: string | null;
  categoryId?: string | null;
}

/**
 * Adiciona uma transação manual. Roda a esteira completa da camada 1→2:
 * conector → normalizador → (categorizador se não veio categoria) → dedup.
 */
export async function addTransaction(input: AddTransactionInput) {
  const userId = await requireUserId();
  const supabase = await createClient();

  const raw = manualConnector({
    date: input.date,
    amount: Math.abs(input.amount),
    type: input.type,
    description: input.description,
  });
  const norm = normalize(raw);

  // Destinatário: cria/vincula automaticamente (idempotente por
  // normalized_name) e já traz o default_category_id, se houver —
  // nunca bloqueia a gravação da transação (falha aqui é engolida).
  // VÍNCULO AUTOMÁTICO FUTURO (payee → categoria): resolvido ANTES do
  // categorizador para que, se o payee tiver categoria padrão amarrada
  // (setPayeeCategory em src/app/actions/payees.ts), ela tenha
  // precedência sobre o categorizador automático abaixo.
  let payeeId: string | null = null;
  let payeeDefaultCategoryId: string | null = null;
  try {
    const resolved = await resolvePayeeIdForTransactionWithCategory(supabase, userId, {
      counterpartyName: undefined,
      counterpartyDocument: undefined,
      rawDescription: norm.rawDescription,
      type: norm.type,
    });
    if (resolved) {
      payeeId = resolved.payeeId;
      payeeDefaultCategoryId = resolved.defaultCategoryId;
    }
  } catch {
    // falha ao resolver payee não deve impedir o registro da transação
  }

  // categoria: escolha explícita do usuário > categoria padrão do
  // destinatário > categorizador automático (regras/memória/IA).
  let categoryId = input.categoryId ?? payeeDefaultCategoryId ?? null;
  let needsReview = false;
  if (!categoryId) {
    const [categories, rules, existing] = await Promise.all([
      getCategories(),
      getRules(),
      getTransactions(),
    ]);
    const result = categorize({
      description: norm.description,
      rawDescription: norm.rawDescription,
      categories: categories.filter((c) =>
        input.type === "entrada" ? c.kind === "receita" : c.kind === "despesa"
      ),
      rules,
      memory: buildMemory(existing),
    });
    categoryId = result.categoryId;
    needsReview = result.needsReview;
  }

  const { error } = await supabase.from("transactions").insert({
    user_id: userId,
    date: norm.date,
    amount: norm.amount,
    type: norm.type,
    description: norm.description,
    raw_description: norm.rawDescription,
    category_id: categoryId,
    account_id: input.accountId ?? null,
    origin: "manual",
    needs_review: needsReview,
    payee_id: payeeId,
  });
  if (error) throw new Error(error.message);

  // Commita os agregados do payee agora que a transação foi inserida de
  // fato (mesma disciplina de resolvePayeeForTransaction: só incrementa
  // tx_count/totais quando a transação É gravada, nunca antes).
  if (payeeId) {
    try {
      await commitPayeeAggregates(supabase, payeeId, {
        date: norm.date,
        amount: norm.amount,
        type: norm.type,
      });
    } catch {
      // não deve derrubar a criação da transação
    }
  }

  revalidatePath("/");
  revalidatePath("/transacoes");
}

export async function updateTransactionCategory(
  transactionId: string,
  categoryId: string
) {
  const userId = await requireUserId();
  const supabase = await createClient();

  // busca a transação para aprender a regra (R5)
  const { data: tx } = await supabase
    .from("transactions")
    .select("description")
    .eq("id", transactionId)
    .single();

  const { error } = await supabase
    .from("transactions")
    .update({ category_id: categoryId, needs_review: false })
    .eq("id", transactionId);
  if (error) throw new Error(error.message);

  // aprendizado: correção vira regra automática 'learned'
  if (tx?.description) {
    await upsertLearnedRule(supabase, userId, tx.description, categoryId);
  }

  revalidatePath("/");
  revalidatePath("/transacoes");
}

export async function deleteTransaction(transactionId: string) {
  await requireUserId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", transactionId);
  if (error) throw new Error(error.message);
  revalidatePath("/");
  revalidatePath("/transacoes");
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: string[];
}

/** Importa um CSV: conector → normaliza → dedup interno e vs. existentes → categoriza → grava. */
export async function importCSV(csvText: string): Promise<ImportResult> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const parsed = importCSVConnector(csvText);
  if (parsed.transactions.length === 0) {
    return { inserted: 0, skipped: 0, errors: parsed.errors };
  }

  const normalized = parsed.transactions.map(normalize);
  const withinBatch = dedupeWithinBatch(normalized);

  const [categories, rules, existing] = await Promise.all([
    getCategories(),
    getRules(),
    getTransactions(),
  ]);
  const { toInsert, skipped } = dedupeAgainstExisting(withinBatch, existing);
  const memory = buildMemory(existing);

  // destinatários: resolve por linha, para que cada transação conte
  // corretamente nos agregados do payee (tx_count/total_paid/
  // total_received) — resolvePayeeForTransaction já faz upsert
  // idempotente por normalized_name, então repetir o mesmo nome no
  // lote apenas incrementa o mesmo registro.
  // VÍNCULO AUTOMÁTICO FUTURO (payee → categoria): resolvido ANTES do
  // categorizador — se o payee já tem default_category_id (amarrado via
  // setPayeeCategory), essa categoria tem precedência sobre o
  // categorizador automático desta linha.
  interface TransactionRow {
    user_id: string;
    date: string;
    amount: number;
    type: TransactionType;
    description: string;
    raw_description: string;
    category_id: string | null;
    origin: "import";
    needs_review: boolean;
    external_id: string | null;
    payee_id: string | null;
  }
  const rows: TransactionRow[] = [];
  for (const n of toInsert) {
    let payeeId: string | null = null;
    let payeeDefaultCategoryId: string | null = null;
    try {
      const resolved = await resolvePayeeIdForTransactionWithCategory(supabase, userId, {
        rawDescription: n.rawDescription,
        type: n.type,
      });
      if (resolved) {
        payeeId = resolved.payeeId;
        payeeDefaultCategoryId = resolved.defaultCategoryId;
      }
    } catch {
      // falha ao resolver payee não deve impedir a importação da linha
    }

    let categoryId: string | null;
    let needsReview: boolean;
    if (payeeDefaultCategoryId) {
      categoryId = payeeDefaultCategoryId;
      needsReview = false;
    } else {
      const cats = categories.filter((c) =>
        n.type === "entrada" ? c.kind === "receita" : c.kind === "despesa"
      );
      const cat = categorize({
        description: n.description,
        rawDescription: n.rawDescription,
        categories: cats,
        rules,
        memory,
      });
      categoryId = cat.categoryId;
      needsReview = cat.needsReview;
    }

    rows.push({
      user_id: userId,
      date: n.date,
      amount: n.amount,
      type: n.type,
      description: n.description,
      raw_description: n.rawDescription,
      category_id: categoryId,
      origin: "import" as const,
      needs_review: needsReview,
      external_id: n.externalId ?? null,
      payee_id: payeeId,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("transactions").insert(rows);
    if (error) throw new Error(error.message);

    // Commita os agregados do payee só APÓS a inserção confirmada — cada
    // linha do CSV é uma transação nova de fato (dedup já rodou acima),
    // então é seguro incrementar 1x por linha aqui (mesma disciplina de
    // resolvePayeeForTransaction, sem o risco de reprocessamento que
    // existe no sync Pluggy).
    for (const r of rows) {
      if (!r.payee_id) continue;
      try {
        await commitPayeeAggregates(supabase, r.payee_id, {
          date: r.date,
          amount: r.amount,
          type: r.type,
        });
      } catch {
        // não deve derrubar a importação
      }
    }
  }

  revalidatePath("/");
  revalidatePath("/transacoes");
  return {
    inserted: rows.length,
    skipped: skipped.length,
    errors: parsed.errors,
  };
}

// ─────────────────────────────────────────────────────────────
// Ações em massa (tela de Transações nova) — todas retornam o
// formato padronizado { ok, error?, count? } em vez de dar throw
// cru, pois a UI usa isso pra decidir o toast.
// ─────────────────────────────────────────────────────────────

export interface BulkActionResult {
  ok: boolean;
  error?: string;
  count?: number;
}

/**
 * Categoriza várias transações de uma vez (uma query .in()) e limpa
 * needs_review. Também aprende uma regra 'learned' por descrição
 * distinta entre as selecionadas (mesma lógica de updateTransactionCategory).
 */
export async function bulkUpdateCategory(
  ids: string[],
  categoryId: string
): Promise<BulkActionResult> {
  if (ids.length === 0) return { ok: true, count: 0 };
  try {
    const userId = await requireUserId();
    const supabase = await createClient();

    const { data: txs } = await supabase
      .from("transactions")
      .select("description")
      .eq("user_id", userId)
      .in("id", ids);

    const { error } = await supabase
      .from("transactions")
      .update({ category_id: categoryId, needs_review: false })
      .eq("user_id", userId)
      .in("id", ids);
    if (error) throw new Error(error.message);

    // uma regra 'learned' por descrição distinta
    const distinctDescriptions = [
      ...new Set((txs ?? []).map((t) => t.description).filter(Boolean)),
    ];
    for (const description of distinctDescriptions) {
      await upsertLearnedRule(supabase, userId, description, categoryId);
    }

    revalidatePath("/");
    revalidatePath("/transacoes");
    return { ok: true, count: ids.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao categorizar." };
  }
}

/** Exclui várias transações de uma vez. */
export async function bulkDeleteTransactions(ids: string[]): Promise<BulkActionResult> {
  if (ids.length === 0) return { ok: true, count: 0 };
  try {
    const userId = await requireUserId();
    const supabase = await createClient();
    const { error } = await supabase
      .from("transactions")
      .delete()
      .eq("user_id", userId)
      .in("id", ids);
    if (error) throw new Error(error.message);

    revalidatePath("/");
    revalidatePath("/transacoes");
    return { ok: true, count: ids.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao excluir." };
  }
}

/**
 * Marca como revisada aplicando a sugestão já calculada no client
 * (via getSuggestions). Escolha de assinatura: em vez de recalcular a
 * sugestão no servidor (o que exigiria repetir getCategories/getRules/
 * getTransactions/buildMemory a cada chamada), o client já tem o mapa
 * de sugestões carregado (de getSuggestions) e manda os pares
 * {id, categoryId} prontos — mais barato e mantém a UI e o "aplicar
 * sugestões" (individual ou em massa) no mesmo caminho de código.
 * Agrupa os updates por categoryId para minimizar queries.
 */
export async function bulkMarkReviewed(
  assignments: { id: string; categoryId: string }[]
): Promise<BulkActionResult> {
  if (assignments.length === 0) return { ok: true, count: 0 };
  try {
    const userId = await requireUserId();
    const supabase = await createClient();

    const byCategory = new Map<string, string[]>();
    for (const a of assignments) {
      const arr = byCategory.get(a.categoryId);
      if (arr) arr.push(a.id);
      else byCategory.set(a.categoryId, [a.id]);
    }

    let total = 0;
    for (const [categoryId, ids] of byCategory) {
      const { error } = await supabase
        .from("transactions")
        .update({ category_id: categoryId, needs_review: false })
        .eq("user_id", userId)
        .in("id", ids);
      if (error) throw new Error(error.message);
      total += ids.length;
    }

    revalidatePath("/");
    revalidatePath("/transacoes");
    return { ok: true, count: total };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao marcar revisada." };
  }
}

/** Aceita a sugestão de UM item: seta categoria + needs_review=false + aprende regra. */
export async function acceptSuggestion(
  id: string,
  categoryId: string
): Promise<BulkActionResult> {
  try {
    await updateTransactionCategory(id, categoryId);
    return { ok: true, count: 1 };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao aceitar sugestão." };
  }
}

/**
 * Cria regra(s) 'manual' a partir das descrições dos itens
 * selecionados — uma regra por descrição distinta. Reusa o mesmo
 * padrão de addRule (config.ts), mas em lote e escopado aos ids dados.
 */
export async function createRuleFromSelection(
  ids: string[],
  categoryId: string
): Promise<BulkActionResult> {
  if (ids.length === 0) return { ok: true, count: 0 };
  try {
    const userId = await requireUserId();
    const supabase = await createClient();

    const { data: txs, error: fetchError } = await supabase
      .from("transactions")
      .select("description")
      .eq("user_id", userId)
      .in("id", ids);
    if (fetchError) throw new Error(fetchError.message);

    const distinctDescriptions = [
      ...new Set((txs ?? []).map((t) => t.description.trim()).filter((d) => d.length >= 3)),
    ];

    let created = 0;
    for (const pattern of distinctDescriptions) {
      const { data: existing } = await supabase
        .from("category_rules")
        .select("id")
        .eq("user_id", userId)
        .eq("pattern", pattern)
        .eq("source", "manual")
        .maybeSingle();
      if (existing) {
        await supabase
          .from("category_rules")
          .update({ category_id: categoryId })
          .eq("id", existing.id);
      } else {
        const { error } = await supabase.from("category_rules").insert({
          user_id: userId,
          pattern,
          category_id: categoryId,
          source: "manual",
        });
        if (error) throw new Error(error.message);
      }
      created++;
    }

    revalidatePath("/transacoes");
    return { ok: true, count: created };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro ao criar regra." };
  }
}

export type SuggestionsMap = Record<string, SuggestionEntry>;

/**
 * Monta os parâmetros (categorias/regras/transações/memória) no
 * servidor e devolve um objeto serializável {[transactionId]:
 * {categoryId, categoryName}} para o client consumir — client
 * components não podem chamar buildMemory/getRules (server-only)
 * diretamente, então essa action é a ponte.
 */
export async function getSuggestions(): Promise<SuggestionsMap> {
  await requireUserId();
  const [categories, rules, allTransactions] = await Promise.all([
    getCategories(),
    getRules(),
    getTransactions(),
  ]);
  const memory = buildMemory(allTransactions);

  const revisarCategoryId =
    categories.find((c) => c.name.toLowerCase() === "a revisar")?.id ?? null;
  const toReview = allTransactions.filter(
    (t) => t.needsReview || (revisarCategoryId !== null && t.categoryId === revisarCategoryId)
  );

  const suggestions = computeSuggestions(toReview, categories, rules, memory);

  const out: SuggestionsMap = {};
  for (const [id, entry] of suggestions) {
    out[id] = entry;
  }
  return out;
}
