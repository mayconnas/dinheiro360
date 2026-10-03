"use server";

// ─────────────────────────────────────────────────────────────
// Server actions da integração TypeSafe (Jev).
//
//  • Configurações > Inteligência (IA): getJevStatus / saveJevCredential
//    / removeJevCredential / testJevConnection. A chave reaproveita
//    gestor360.ai_credentials com provider = 'typesafe' (migration 0011)
//    e, como as demais, NUNCA volta pro client — só a versão mascarada.
//  • Transações: categorizeWithJev(ids) pergunta ao Jev a melhor
//    categoria de cada lançamento (receitas p/ entradas, despesas p/
//    saídas) e devolve as decisões SEM gravar nada; applyJevDecisions
//    grava só o que o usuário confirmou no diálogo de revisão (camada 4
//    sugere, o usuário decide — ver arquitetura-gestor-financeiro.md).
//
// Mesmo formato das ações em massa da tela de Transações: retornam
// { ok, error?, ... } em vez de dar throw, pra UI decidir o toast.
// ─────────────────────────────────────────────────────────────

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getAccounts, getCategories } from "@/lib/data/repository";
import { upsertLearnedRule } from "@/lib/data/learned-rules";
import { isNoiseOnlyDescription } from "@/lib/engine/normalizer";
import { dictionaryCategoryId } from "@/lib/engine/categorizer";
import { getTypeSafeCredential, TYPESAFE_PROVIDER } from "@/lib/ai/jev/credentials";
import { listModels, systemOne, TypeSafeError } from "@/lib/ai/jev/client";
import {
  CATEGORY_QUESTION_ID,
  buildCategoryOptions,
  buildCategoryQuestion,
  buildExamplesByCategory,
  buildTransactionState,
  interpretCategoryAnswer,
  isReviewSentinel,
  normalizeText,
  type CategoryOptionSet,
  type JevTransactionInput,
} from "@/lib/ai/jev/prompt";
import {
  JEV_CONCURRENCY,
  JEV_DEFAULT_MODEL,
  JEV_MAX_IDS_PER_CALL,
  type JevApplyAssignment,
  type JevCategorizeResult,
  type JevDecision,
  type JevStatus,
} from "@/lib/ai/jev/config";
import type { Account, CategoryKind, TransactionType } from "@/lib/types";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  return user.id;
}

/** "ts_abc123XYZ" -> "ts_...3XYZ" — mesma regra de ai-credentials.ts. */
function maskKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length || 4);
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL_RE = /^[A-Za-z0-9._:-]{1,64}$/;
/** PostgREST manda filtros .in() na URL — lotes pequenos evitam URLs gigantes. */
const IN_CHUNK = 150;

const MIGRATION_HINT =
  "O banco ainda não aceita a credencial da TypeSafe. Aplique a migration supabase/migrations/0011_typesafe_jev.sql no Supabase (SQL Editor) e tente de novo.";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Escapa curingas do LIKE/ILIKE (%, _ e \) para buscar o texto literal. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => "\\" + ch);
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Mesmo fallback de getTypeSafeCredential: TYPESAFE_MODEL do servidor, senão jev-latest. */
function serverDefaultModel(): string {
  return process.env.TYPESAFE_MODEL?.trim() || JEV_DEFAULT_MODEL;
}

// ─────────────────────────────────────────────────────────────
// Configurações
// ─────────────────────────────────────────────────────────────

export async function getJevStatus(): Promise<{ ok: boolean; data: JevStatus; error?: string }> {
  const defaultModel = serverDefaultModel();
  const empty: JevStatus = { configured: false, source: null, maskedKey: null, model: null, defaultModel };
  try {
    const userId = await requireUserId();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ai_credentials")
      .select("api_key,model")
      .eq("user_id", userId)
      .eq("provider", TYPESAFE_PROVIDER)
      .maybeSingle();
    if (error) throw new Error(error.message);

    if (data?.api_key) {
      return {
        ok: true,
        data: {
          configured: true,
          source: "user",
          maskedKey: maskKey(String(data.api_key)),
          model: (data.model as string | null)?.trim() || null,
          defaultModel,
        },
      };
    }
    if (process.env.TYPESAFE_API_KEY?.trim()) {
      return {
        ok: true,
        data: {
          configured: true,
          source: "env",
          maskedKey: null,
          model: null,
          defaultModel,
        },
      };
    }
    return { ok: true, data: empty };
  } catch (e) {
    return { ok: false, data: empty, error: errorMessage(e, "Erro ao ler a configuração da TypeSafe.") };
  }
}

/**
 * Salva (upsert) a chave da TypeSafe do usuário. Antes de gravar, valida
 * a chave com GET /v1/models (não consome tokens): chave recusada (401/
 * 403) não é salva; falha de rede/instabilidade salva com um aviso.
 */
export async function saveJevCredential(input: {
  apiKey: string;
  model?: string | null;
}): Promise<{ ok: boolean; error?: string; warning?: string }> {
  const apiKey = input.apiKey?.trim() ?? "";
  const model = input.model?.trim() || null;
  if (!apiKey) return { ok: false, error: "Informe a chave de API da TypeSafe." };
  if (apiKey.length < 8 || /\s/.test(apiKey)) {
    return { ok: false, error: "Essa chave não parece válida. Copie-a de novo em console.typesafe.ai/keys." };
  }
  if (model && !MODEL_RE.test(model)) {
    return { ok: false, error: "Nome de modelo inválido. Use, por exemplo, jev-latest ou jev-1.13.0." };
  }

  try {
    const userId = await requireUserId();

    let warning: string | undefined;
    try {
      await listModels(apiKey);
    } catch (e) {
      if (e instanceof TypeSafeError && e.isAuthError) return { ok: false, error: e.message };
      warning = `Chave salva, mas não foi possível validá-la agora (${errorMessage(e, "erro desconhecido")}).`;
    }

    const supabase = await createClient();
    const { error } = await supabase.from("ai_credentials").upsert(
      {
        user_id: userId,
        provider: TYPESAFE_PROVIDER,
        api_key: apiKey,
        model,
        is_active: false,
      },
      { onConflict: "user_id,provider" }
    );
    if (error) {
      if (error.code === "23514") return { ok: false, error: MIGRATION_HINT };
      throw new Error(error.message);
    }

    revalidatePath("/configuracoes");
    revalidatePath("/transacoes");
    return { ok: true, warning };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "Erro ao salvar a chave da TypeSafe.") };
  }
}

/** Troca só o modelo da chave já salva (a chave nunca volta ao client, então não dá pra reenviá-la). null = volta ao padrão. */
export async function updateJevModel(model: string | null): Promise<{ ok: boolean; error?: string }> {
  const value = model?.trim() || null;
  if (value && !MODEL_RE.test(value)) {
    return { ok: false, error: "Nome de modelo inválido. Use, por exemplo, jev-latest ou jev-1.13.0." };
  }
  try {
    const userId = await requireUserId();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ai_credentials")
      .update({ model: value })
      .eq("user_id", userId)
      .eq("provider", TYPESAFE_PROVIDER)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) {
      return { ok: false, error: "Nenhuma chave da TypeSafe salva — cole a chave para salvar." };
    }
    revalidatePath("/configuracoes");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "Erro ao salvar o modelo.") };
  }
}

export async function removeJevCredential(): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await requireUserId();
    const supabase = await createClient();
    const { error } = await supabase
      .from("ai_credentials")
      .delete()
      .eq("user_id", userId)
      .eq("provider", TYPESAFE_PROVIDER);
    if (error) throw new Error(error.message);
    revalidatePath("/configuracoes");
    revalidatePath("/transacoes");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "Erro ao remover a chave da TypeSafe.") };
  }
}

/**
 * Faz uma pergunta mínima ao Jev com a credencial em uso (do usuário ou
 * do servidor) — valida chave E nome do modelo de uma vez. Custa algumas
 * centenas de tokens (frações de centavo).
 */
export async function testJevConnection(): Promise<{ ok: boolean; error?: string; message?: string }> {
  try {
    const userId = await requireUserId();
    const cred = await getTypeSafeCredential(userId);
    if (!cred) return { ok: false, error: "Nenhuma chave da TypeSafe configurada." };

    const res = await systemOne(
      cred.apiKey,
      {
        state: { transaction: { description: "Supermercado Pão de Açúcar", direction: "money out (expense)" } },
        model: cred.model,
        questions: {
          groceries: { type: "noul", instructions: "Is `transaction` a grocery purchase?" },
        },
      },
      { maxRetries: 1, timeoutMs: 15_000 }
    );
    const origem = cred.source === "env" ? " (chave do servidor)" : "";
    return { ok: true, message: `Conexão OK — respondido por ${res.model}${origem}.` };
  } catch (e) {
    return { ok: false, error: errorMessage(e, "Falha ao testar a conexão com a TypeSafe.") };
  }
}

// ─────────────────────────────────────────────────────────────
// Transações — categorização
// ─────────────────────────────────────────────────────────────

interface TxRow extends JevTransactionInput {
  id: string;
  accountId: string | null;
  payeeId: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toTxRow(r: any): TxRow {
  return {
    id: r.id,
    type: r.type as TransactionType,
    amount: Number(r.amount),
    description: r.description ?? "",
    rawDescription: r.raw_description ?? "",
    rawPayload: r.raw_payload ?? null,
    merchantName: r.merchant_name ?? null,
    counterpartyName: r.counterparty_name ?? null,
    counterpartyDocument: r.counterparty_document ?? null,
    paymentMethod: r.payment_method ?? null,
    pluggyCategory: r.pluggy_category ?? null,
    accountId: r.account_id ?? null,
    payeeId: r.payee_id ?? null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Executa `fn` sobre `items` com no máximo `limit` promessas simultâneas; `stop()` interrompe o que ainda não começou. */
async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  shouldStop: () => boolean
): Promise<void> {
  let next = 0;
  async function worker() {
    while (next < items.length && !shouldStop()) {
      const item = items[next++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Pergunta ao Jev a melhor categoria de cada lançamento em `ids`. NÃO
 * grava nada — devolve as decisões para a tela de revisão.
 *
 * O client chama em lotes (JEV_CLIENT_BATCH_SIZE) para mostrar progresso
 * e permitir cancelar; aqui dentro, cada lançamento vira uma requisição
 * (state = só aquele lançamento), feitas com concorrência limitada.
 * Lançamentos com state idêntico (ex: a mesma assinatura todo mês)
 * compartilham uma única requisição.
 */
export async function categorizeWithJev(ids: string[]): Promise<JevCategorizeResult> {
  const base: JevCategorizeResult = { ok: false, decisions: [], skipped: [], requests: 0, inputTokens: 0 };
  const uniqueIds = [...new Set(Array.isArray(ids) ? ids : [])].filter(
    (id): id is string => typeof id === "string" && UUID_RE.test(id)
  );
  if (uniqueIds.length === 0) return { ...base, ok: true };
  if (uniqueIds.length > JEV_MAX_IDS_PER_CALL) {
    return { ...base, error: `Envie no máximo ${JEV_MAX_IDS_PER_CALL} lançamentos por vez.` };
  }

  try {
    const userId = await requireUserId();
    const cred = await getTypeSafeCredential(userId);
    if (!cred) {
      return {
        ...base,
        error: "Configure sua chave da TypeSafe em Configurações > Inteligência (IA) para usar o Jev.",
      };
    }

    const supabase = await createClient();
    const [txRes, categories, accounts, historyRes] = await Promise.all([
      supabase
        .from("transactions")
        .select(
          "id,type,amount,description,raw_description,raw_payload,merchant_name,counterparty_name,counterparty_document,payment_method,pluggy_category,account_id,payee_id"
        )
        .eq("user_id", userId)
        .in("id", uniqueIds),
      getCategories(),
      getAccounts(),
      // Histórico já categorizado → exemplos por categoria.
      supabase
        .from("transactions")
        .select("id,type,description,raw_description,merchant_name,category_id")
        .eq("user_id", userId)
        .eq("needs_review", false)
        .not("category_id", "is", null)
        .order("date", { ascending: false })
        .limit(2000),
    ]);
    if (txRes.error) throw new Error(txRes.error.message);
    if (historyRes.error) throw new Error(historyRes.error.message);

    const txs = (txRes.data ?? []).map(toTxRow);
    const found = new Set(txs.map((t) => t.id));
    const skipped: JevCategorizeResult["skipped"] = uniqueIds
      .filter((id) => !found.has(id))
      .map((transactionId) => ({ transactionId, reason: "Lançamento não encontrado." }));

    // Nome do destinatário (payees.name) — ajuda quando a descrição é genérica ("Pix enviado").
    const payeeIds = [...new Set(txs.map((t) => t.payeeId).filter((id): id is string => Boolean(id)))];
    const payeeNameById = new Map<string, string>();
    if (payeeIds.length > 0) {
      const { data: payees } = await supabase
        .from("payees")
        .select("id,name")
        .eq("user_id", userId)
        .in("id", payeeIds);
      for (const p of payees ?? []) if (p.name) payeeNameById.set(p.id, p.name);
    }

    // Exemplos: exclui os próprios lançamentos do lote (evita "colar" na
    // categoria atual quando o usuário pede para recategorizar), "A revisar"
    // e o que só está naquela categoria porque o dicionário embutido casou
    // uma substring (ex "mercado" em MERCADOLIVRE) — isso não é evidência
    // do usuário e ensinaria o erro ao Jev.
    const reviewIds = new Set(categories.filter(isReviewSentinel).map((c) => c.id));
    const categoriesOfKind = {
      receita: categories.filter((c) => c.kind === "receita"),
      despesa: categories.filter((c) => c.kind === "despesa"),
    };
    const history = (historyRes.data ?? [])
      .filter((r) => !found.has(r.id) && !reviewIds.has(r.category_id))
      .filter((r) => {
        const cats = r.type === "entrada" ? categoriesOfKind.receita : categoriesOfKind.despesa;
        const dictId = dictionaryCategoryId(String(r.description ?? ""), String(r.raw_description ?? ""), cats);
        return dictId !== r.category_id;
      })
      .map((r) => ({
        description: r.description as string | null,
        merchantName: r.merchant_name as string | null,
        categoryId: r.category_id as string | null,
      }));
    const examples = buildExamplesByCategory(history);

    const optionsByKind: Record<CategoryKind, CategoryOptionSet> = {
      receita: buildCategoryOptions(categories, "receita", examples),
      despesa: buildCategoryOptions(categories, "despesa", examples),
    };
    const accountById = new Map<string, Account>(accounts.map((a) => [a.id, a]));

    // Agrupa lançamentos com state idêntico → uma requisição por grupo.
    const groups = new Map<string, { kind: CategoryKind; state: ReturnType<typeof buildTransactionState>; txIds: string[] }>();
    for (const t of txs) {
      const kind: CategoryKind = t.type === "entrada" ? "receita" : "despesa";
      if (optionsByKind[kind].categoryCount === 0) {
        skipped.push({
          transactionId: t.id,
          reason: `Nenhuma categoria de ${kind} cadastrada para o Jev escolher.`,
        });
        continue;
      }
      const state = buildTransactionState(t, {
        account: t.accountId ? accountById.get(t.accountId) : null,
        payeeName: t.payeeId ? payeeNameById.get(t.payeeId) : null,
      });
      const signature = `${kind}|${JSON.stringify(state)}`;
      const group = groups.get(signature);
      if (group) group.txIds.push(t.id);
      else groups.set(signature, { kind, state, txIds: [t.id] });
    }

    const questionByKind = {
      receita: buildCategoryQuestion(optionsByKind.receita),
      despesa: buildCategoryQuestion(optionsByKind.despesa),
    };

    const decisionById = new Map<string, JevDecision>();
    // objeto (não `let`) porque é escrito dentro do callback do pool
    const abort: { error: TypeSafeError | null } = { error: null };
    let model: string | undefined;
    let requests = 0;
    let inputTokens = 0;

    await runPool(
      [...groups.values()],
      JEV_CONCURRENCY,
      async (group) => {
        try {
          requests++;
          const res = await systemOne(cred.apiKey, {
            state: group.state,
            model: cred.model,
            questions: { [CATEGORY_QUESTION_ID]: questionByKind[group.kind] },
          });
          model = res.model;
          inputTokens += res.usage?.input_tokens ?? 0;
          const answer = res.answers[CATEGORY_QUESTION_ID];
          if (!answer || answer.type !== "choice") {
            throw new TypeSafeError("TypeSafe: a resposta não trouxe a pergunta de categoria.", null);
          }
          for (const id of group.txIds) {
            decisionById.set(id, interpretCategoryAnswer(id, answer, optionsByKind[group.kind]));
          }
        } catch (e) {
          // Chave inválida/sem permissão: não adianta seguir com o resto.
          if (e instanceof TypeSafeError && e.isAuthError) abort.error = e;
          const message = errorMessage(e, "Falha ao consultar o Jev.");
          for (const id of group.txIds) {
            decisionById.set(id, {
              transactionId: id,
              categoryId: null,
              probability: 0,
              confidence: 0,
              tier: "nenhuma",
              alternatives: [],
              error: message,
            });
          }
        }
      },
      () => abort.error !== null
    );

    if (abort.error) return { ...base, skipped, requests, error: abort.error.message };

    const decisions = uniqueIds
      .map((id) => decisionById.get(id))
      .filter((d): d is JevDecision => d !== undefined);

    const failed = decisions.filter((d) => d.error);
    if (decisions.length > 0 && failed.length === decisions.length) {
      return { ...base, skipped, requests, inputTokens, error: failed[0].error };
    }

    const dropped = optionsByKind.receita.dropped + optionsByKind.despesa.dropped;
    if (dropped > 0) {
      console.warn(`[jev] ${dropped} categoria(s) ficaram fora das opções pelo limite de 255 da API.`);
    }

    return { ok: true, decisions, skipped, model, requests, inputTokens };
  } catch (e) {
    return { ...base, error: errorMessage(e, "Erro ao categorizar com o Jev.") };
  }
}

/**
 * Grava as decisões que o usuário confirmou no diálogo de revisão:
 * category_id + needs_review=false. Revalida no servidor que cada
 * categoria existe, não é "A revisar" e é do mesmo kind do lançamento
 * (receita ↔ entrada, despesa ↔ saída) — o client não é confiável.
 *
 * `learnRules`: cria regras 'learned' (R5) por descrição, para
 * lançamentos parecidos entrarem já categorizados sem precisar do Jev.
 * Uma regra vale para TODA descrição igual, mas o Jev decide olhando
 * também contraparte, valor e conta — então só vira regra o que é
 * inequívoco:
 *  • o client marcou `learn` (alta confiança ou correção do usuário, e
 *    sem divergência entre lançamentos de mesma descrição no lote);
 *  • todas as atribuições do lote com essa descrição (mesmo tipo)
 *    apontam para a mesma categoria;
 *  • a descrição não é só ruído de extrato ("PIX RECEBIDO", "TED");
 *  • nenhum lançamento confirmado do mesmo tipo cuja descrição CONTÉM
 *    essa (regras casam por substring) está em outra categoria;
 *  • não existe regra para esse pattern apontando para outra categoria
 *    (nunca sobrescreve decisões antigas).
 */
export async function applyJevDecisions(
  assignments: JevApplyAssignment[],
  options: { learnRules: boolean } = { learnRules: true }
): Promise<{ ok: boolean; error?: string; count?: number; skipped?: number; learned?: number }> {
  const clean = (Array.isArray(assignments) ? assignments : []).filter(
    (a) => a && UUID_RE.test(String(a.id)) && UUID_RE.test(String(a.categoryId))
  );
  // último vence em caso de id repetido
  const byTx = new Map(clean.map((a) => [a.id, { categoryId: a.categoryId, learn: a.learn === true }]));
  if (byTx.size === 0) return { ok: true, count: 0, skipped: 0, learned: 0 };
  if (byTx.size > 5000) return { ok: false, error: "Lote grande demais — aplique em partes." };

  // fora do try: numa falha no meio do loop, informa (e revalida) o que já foi gravado
  let count = 0;
  try {
    const userId = await requireUserId();
    const supabase = await createClient();
    const categories = await getCategories();
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const txs: { id: string; type: TransactionType; description: string | null; raw_description: string | null }[] = [];
    for (const part of chunk([...byTx.keys()], IN_CHUNK)) {
      const { data, error } = await supabase
        .from("transactions")
        .select("id,type,description,raw_description")
        .eq("user_id", userId)
        .in("id", part);
      if (error) throw new Error(error.message);
      txs.push(...((data ?? []) as typeof txs));
    }

    const idsByCategory = new Map<string, string[]>();
    // "tipo|descrição normalizada" → categorias atribuídas no lote, se todas pediram para aprender, e a descrição original
    const learnGroups = new Map<string, { categories: Set<string>; allLearn: boolean; description: string; type: TransactionType; noise: boolean }>();
    let skipped = byTx.size - txs.length;
    for (const t of txs) {
      const { categoryId, learn } = byTx.get(t.id)!;
      const category = categoryById.get(categoryId);
      const expectedKind: CategoryKind = t.type === "entrada" ? "receita" : "despesa";
      if (!category || isReviewSentinel(category) || category.kind !== expectedKind) {
        skipped++;
        continue;
      }
      const list = idsByCategory.get(categoryId);
      if (list) list.push(t.id);
      else idsByCategory.set(categoryId, [t.id]);

      const description = t.description?.trim();
      if (!description) continue;
      const key = `${t.type}|${normalizeText(description)}`;
      const group = learnGroups.get(key) ?? {
        categories: new Set<string>(),
        allLearn: true,
        description,
        type: t.type,
        noise: false,
      };
      group.categories.add(categoryId);
      group.allLearn &&= learn;
      group.noise ||= isNoiseOnlyDescription(t.raw_description || description) || isNoiseOnlyDescription(description);
      learnGroups.set(key, group);
    }

    for (const [categoryId, ids] of idsByCategory) {
      for (const part of chunk(ids, IN_CHUNK)) {
        const { error } = await supabase
          .from("transactions")
          .update({ category_id: categoryId, needs_review: false })
          .eq("user_id", userId)
          .in("id", part);
        if (error) throw new Error(error.message);
        count += part.length;
      }
    }

    let learned = 0;
    if (options.learnRules) {
      const candidates = [...learnGroups.entries()].filter(
        ([, g]) => g.allLearn && g.categories.size === 1 && !g.noise
      );
      // Regras casam por SUBSTRING (categorize: haystack.includes(pattern)).
      // Se algum lançamento confirmado do mesmo tipo que CONTÉM essa
      // descrição está em outra categoria, a regra atropelaria ele → ambíguo.
      // (Inclui o próprio lote, já gravado acima — ex "Amazon" → Compras vs
      // "Amazon Prime Video" → Assinaturas.) Uma consulta pequena por
      // candidato, com limit(1): basta uma linha para haver conflito.
      const conflicting = new Set<string>();
      await runPool(
        candidates,
        JEV_CONCURRENCY,
        async ([key, g]) => {
          const [categoryId] = [...g.categories];
          const { data, error } = await supabase
            .from("transactions")
            .select("id")
            .eq("user_id", userId)
            .eq("type", g.type)
            .eq("needs_review", false)
            .not("category_id", "is", null)
            .neq("category_id", categoryId)
            .ilike("description", `%${escapeLike(g.description)}%`)
            .limit(1);
          if (error) {
            console.error("[jev] checagem de conflito p/ regra falhou:", error.message);
            conflicting.add(key); // na dúvida, não aprende
          } else if (data && data.length > 0) {
            conflicting.add(key);
          }
        },
        () => false
      );

      for (const [key, g] of candidates) {
        if (conflicting.has(key)) continue;
        const [categoryId] = [...g.categories];
        try {
          if (await upsertLearnedRule(supabase, userId, g.description, categoryId, { overwrite: false })) {
            learned++;
          }
        } catch (e) {
          // regra é bônus — não derruba a aplicação das categorias
          console.error("[jev] falha ao aprender regra:", errorMessage(e, "erro"));
        }
      }
    }

    revalidatePath("/");
    revalidatePath("/transacoes");
    return { ok: true, count, skipped, learned };
  } catch (e) {
    if (count > 0) {
      revalidatePath("/");
      revalidatePath("/transacoes");
    }
    return { ok: false, count, error: errorMessage(e, "Erro ao aplicar as categorias do Jev.") };
  }
}
