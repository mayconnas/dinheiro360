// ─────────────────────────────────────────────────────────────
// Orquestrador de sincronização Pluggy (Fase 4).
// Encapsula a esteira Camada 1→2 para um Item, reusável por
// webhook, cron e sync manual:
//   getItem → getAccounts → getTransactions
//   → pluggyConnector → normalize → dedup → categorize → upsert
// Roda com o cliente ADMIN (service_role, sem sessão), então recebe
// o userId explicitamente e escopa TODAS as escritas a ele.
// A idempotência vem do upsert onConflict (user_id, origin, external_id).
// ─────────────────────────────────────────────────────────────
import "server-only";
import type { DbClient, Json, Tables } from "@/lib/supabase/database.types";
import { getItem, getAccounts, getTransactions } from "./client";
import type { PluggyAccount, PluggyTransaction } from "./client";
import { cleanInstitution } from "@/lib/engine/bank-name";

/**
 * Cliente Supabase agnóstico ao schema (o admin usa 'gestor360', não
 * 'public'). Evita o conflito de generic entre os dois.
 */
type AnySupabase = DbClient;
import { pluggyConnectorMany } from "@/lib/engine/pluggy";
import { normalize, type NormalizedTransaction } from "@/lib/engine/normalizer";
import { categorize } from "@/lib/engine/categorizer";
import {
  toCategory,
  toJsonColumn,
  toPaymentMethodColumn,
  toRule,
  toStatusColumn,
} from "@/lib/data/mappers";
import {
  resolvePayeeIdForTransactionWithCategory,
  commitPayeeAggregates,
} from "@/lib/data/payees-repo";
import type { Transaction } from "@/lib/types";

/** Transação normalizada carregando a conta Pluggy de origem. */
type NormalizedWithAccount = NormalizedTransaction & { account?: string };

export interface SyncResult {
  itemId: string;
  accounts: number;
  upserted: number;
  status: string;
  error?: string;
}

/** Recua N dias de uma data ISO (para pegar lançamentos backdated). */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Busca o HISTÓRICO INTEIRO de um item Pluggy — todas as contas, sem
 * `createdAtFrom` (nenhuma janela/rewind, ao contrário do sync
 * incremental do passo 6 acima). Reusado pelo backfill/re-sync
 * (reSyncPluggyPayload em src/app/actions/pluggy.ts) para reprocessar
 * transações já importadas e preencher as colunas novas (raw_payload,
 * payment_method, operation_type, contraparte, merchant, categoria
 * Pluggy) sem duplicar nem exigir reconexão do usuário.
 */
export async function fetchAllItemTransactions(
  itemId: string
): Promise<PluggyTransaction[]> {
  const accounts = await getAccounts(itemId);
  const all: PluggyTransaction[] = [];
  for (const acc of accounts) {
    const txs = await getTransactions(acc.id, {});
    all.push(...txs);
  }
  return all;
}

/** 'BANK'|'CREDIT'|'INVESTMENT'|... da Pluggy → accounts.account_type (migration 0010). */
function mapAccountType(pluggyType: string): "bank" | "credit" | "investment" {
  const t = (pluggyType || "").toUpperCase();
  if (t === "CREDIT") return "credit";
  if (t === "INVESTMENT") return "investment";
  return "bank";
}

/**
 * Campos de saldo/limite/instituição (migration 0010) derivados de
 * uma PluggyAccount — usados tanto no INSERT quanto no UPDATE do
 * upsert de conta (passo 5), para current_balance/credit_*
 * acompanharem cada sync (mudam com frequência), diferente de
 * name/kind/opening_balance (só definidos na criação).
 */
function accountBalanceFields(acc: PluggyAccount) {
  const { institution } = cleanInstitution(acc);
  const isCard = mapAccountType(acc.type) === "credit";
  const last4 = isCard
    ? (acc.number || "").replace(/\D/g, "").slice(-4) || null
    : null;
  return {
    current_balance: acc.balance ?? null,
    account_type: mapAccountType(acc.type),
    institution,
    credit_limit: acc.creditData?.creditLimit ?? null,
    credit_available: acc.creditData?.availableCreditLimit ?? null,
    credit_minimum_payment: acc.creditData?.minimumPayment ?? null,
    credit_due_date: acc.creditData?.balanceDueDate ?? null,
    card_brand: acc.creditData?.brand ?? null,
    card_last4: last4,
    number: acc.number ?? null,
    owner: acc.owner ?? null,
  };
}


/**
 * Sincroniza um Item da Pluggy para o usuário dado.
 * @param admin  cliente Supabase service_role (bypassa RLS)
 * @param userId dono das transações — escopo de TODA escrita
 * @param itemId itemId da Pluggy
 */
export async function runPluggySync(
  admin: AnySupabase,
  userId: string,
  itemId: string
): Promise<SyncResult> {
  // 1. Estado do item (status + consentimento) → atualiza pluggy_items.
  const item = await getItem(itemId);
  const consent = item.consentExpiresAt ?? null;

  await admin
    .from("pluggy_items")
    .update({
      status: item.status,
      connector_name: item.connector?.name ?? null,
      consent_expires_at: consent,
    })
    .eq("user_id", userId)
    .eq("item_id", itemId);

  // Se o item ainda está atualizando ou pediu ação do usuário, não há
  // dados prontos: retorna cedo e deixa o próximo webhook/cron buscar.
  const notReady = ["UPDATING", "WAITING_USER_INPUT", "LOGIN_ERROR"].includes(
    item.status
  );

  // 2. Contas do item.
  const accounts = await getAccounts(itemId);
  if (accounts.length === 0 || notReady) {
    await admin
      .from("pluggy_items")
      .update({ last_synced_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("item_id", itemId);
    return {
      itemId,
      accounts: accounts.length,
      upserted: 0,
      status: item.status,
    };
  }

  // 3. Descobre a janela incremental: último sync − 14 dias (rewind
  //    para lançamentos que chegam com data retroativa).
  const { data: itemRow } = await admin
    .from("pluggy_items")
    .select("last_synced_at")
    .eq("user_id", userId)
    .eq("item_id", itemId)
    .maybeSingle();
  const lastSynced: string | null = itemRow?.last_synced_at ?? null;
  // janela incremental por TEMPO DE INGESTÃO (createdAtFrom): último sync
  // − 14 dias de rewind. 1ª carga: undefined = traz tudo.
  const createdAtFrom = lastSynced ? isoDaysAgo(14) : undefined;

  // 4. Carrega categorias/regras/histórico para categorizar + memória.
  const [{ data: catRows }, { data: ruleRows }, { data: existingRows }] =
    await Promise.all([
      admin.from("categories").select("*").eq("user_id", userId),
      admin.from("category_rules").select("*").eq("user_id", userId),
      admin
        .from("transactions")
        .select("description,category_id,needs_review,created_at")
        .eq("user_id", userId),
    ]);
  const categories = (catRows ?? []).map(toCategory);
  const rules = (ruleRows ?? []).map(toRule);
  const memory = buildMemoryFromRows(existingRows ?? []);

  // 5. Mapeia cada conta Pluggy para uma conta no nosso banco (por
  //    pluggy_account_id), para as transações terem account_id e o usuário
  //    ver saldos por banco. Cria a conta se ainda não existir; se já
  //    existir, ATUALIZA saldo/limite/instituição (campos que mudam a
  //    cada sync — ver accountBalanceFields abaixo). name/kind/
  //    opening_balance não são tocados na atualização para não
  //    sobrescrever nada que o usuário tenha customizado manualmente.
  const accountIdMap = new Map<string, string>(); // pluggyAccountId → nosso account_id
  for (const acc of accounts) {
    const kind = acc.type === "CREDIT" ? "cartao" : "corrente";
    const balanceFields = accountBalanceFields(acc);
    const { data: existingAcc } = await admin
      .from("accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("pluggy_account_id", acc.id)
      .maybeSingle();
    if (existingAcc?.id) {
      accountIdMap.set(acc.id, existingAcc.id as string);
      await admin
        .from("accounts")
        .update(balanceFields)
        .eq("id", existingAcc.id as string);
    } else {
      const { data: created } = await admin
        .from("accounts")
        .insert({
          user_id: userId,
          name: acc.name || acc.marketingName || "Conta",
          kind,
          opening_balance: 0,
          pluggy_account_id: acc.id,
          pluggy_item_id: itemId,
          ...balanceFields,
        })
        .select("id")
        .single();
      if (created?.id) accountIdMap.set(acc.id, created.id as string);
    }
  }

  // 6. Puxa transações de cada conta → conector → normaliza. Mantém o
  //    vínculo com a conta (o normalizer preserva `account` do raw).
  const normalizedAll: { n: NormalizedWithAccount; accountId: string | null }[] =
    [];
  for (const acc of accounts) {
    const txs = await getTransactions(
      acc.id,
      createdAtFrom ? { createdAtFrom } : {}
    );
    const raws = pluggyConnectorMany(txs);
    for (const raw of raws) {
      const norm = normalize(raw) as NormalizedWithAccount;
      norm.account = raw.account; // preserva a conta Pluggy
      normalizedAll.push({
        n: norm,
        accountId: raw.account ? accountIdMap.get(raw.account) ?? null : null,
      });
    }
  }

  // dedup dentro do lote (por data+valor+descrição), preservando accountId.
  const seenKeys = new Set<string>();
  const deduped = normalizedAll.filter(({ n }) => {
    const key = `${n.date}|${n.amount}|${n.description.toLowerCase()}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });

  // 7. Categoriza, resolve destinatário (counterpartyName/Document já
  //    vêm do paymentData/merchant via pluggyConnector → normalize) e
  //    monta as linhas (agora com account_id).
  //    IMPORTANTE (dupla contagem): a janela desta busca tem rewind de
  //    14 dias (linha ~126) e reprocessa lançamentos que já foram
  //    sincronizados antes — a maioria destas `rows` NÃO será inserida
  //    (filtradas mais abaixo por já existirem via external_id). Por
  //    isso aqui só RESOLVEMOS o payeeId (cria o registro se preciso,
  //    mas sem tocar tx_count/totais); os agregados só são commitados
  //    depois, e só para as linhas que o passo 8 de fato inserir —
  //    senão cada sync (cron/webhook) inflaria os totais do payee a
  //    cada reprocessamento da mesma janela de 14 dias.
  interface TransactionRow {
    user_id: string;
    date: string;
    amount: number;
    type: "entrada" | "saida";
    description: string;
    raw_description: string;
    category_id: string | null;
    account_id: string | null;
    origin: "open_finance";
    needs_review: boolean;
    external_id: string | null;
    payee_id: string | null;
    // Campos do payload completo da Pluggy (migration 0006) — ver
    // src/lib/engine/pluggy.ts para a extração e mapPluggyPaymentMethod
    // para o mapeamento de payment_method.
    raw_payload: Json | null;
    payment_method: Tables<"transactions">["payment_method"];
    operation_type: string | null;
    counterparty_document: string | null;
    counterparty_name: string | null;
    merchant_name: string | null;
    pluggy_category: string | null;
    pluggy_category_id: string | null;
    // Campos do payload completo da Pluggy (migration 0008).
    status: Tables<"transactions">["status"];
    has_credit_card: boolean | null;
  }
  const rows: TransactionRow[] = [];
  for (const { n, accountId } of deduped) {
    // VÍNCULO AUTOMÁTICO FUTURO (payee → categoria): resolve o payee
    // (com default_category_id, se houver) ANTES do categorizador — se
    // o destinatário já foi amarrado a uma categoria (setPayeeCategory),
    // ela tem precedência sobre o categorizador automático abaixo.
    let payeeId: string | null = null;
    let payeeDefaultCategoryId: string | null = null;
    try {
      const resolved = await resolvePayeeIdForTransactionWithCategory(admin, userId, {
        counterpartyName: n.counterpartyName,
        counterpartyDocument: n.counterpartyDocument,
        rawDescription: n.rawDescription,
        type: n.type,
      });
      if (resolved) {
        payeeId = resolved.payeeId;
        payeeDefaultCategoryId = resolved.defaultCategoryId;
      }
    } catch {
      // falha ao resolver payee não deve travar o sync
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
      account_id: accountId,
      origin: "open_finance" as const,
      needs_review: needsReview,
      external_id: n.externalId ?? null,
      payee_id: payeeId,
      raw_payload: toJsonColumn(n.rawPayload),
      payment_method: toPaymentMethodColumn(n.paymentMethod),
      operation_type: n.operationType ?? null,
      counterparty_document: n.counterpartyDocument ?? null,
      counterparty_name: n.counterpartyName ?? null,
      merchant_name: n.merchantName ?? null,
      pluggy_category: n.pluggyCategory ?? null,
      pluggy_category_id: n.pluggyCategoryId ?? null,
      status: toStatusColumn(n.status),
      has_credit_card: n.hasCreditCard ?? null,
    });
  }

  // 7. Idempotência: em vez de upsert (o índice único é PARCIAL, WHERE
  //    external_id IS NOT NULL, e o PostgREST não consegue mirá-lo no
  //    ON CONFLICT), filtramos no código os external_id que já existem
  //    e inserimos só os novos. Reprocessar (webhook/cron) não duplica.
  let upserted = 0;
  if (rows.length > 0) {
    const externalIds = rows
      .map((r) => r.external_id)
      .filter((v): v is string => !!v);

    // Busca os external_id que já existem, em LOTES pequenos — um `.in()`
    // com centenas de UUIDs estoura o limite de tamanho da URL do PostgREST
    // ("URI too long"). Chunk de 80 mantém a URL curta.
    const seen = new Set<string>();
    const CHUNK = 80;
    for (let i = 0; i < externalIds.length; i += CHUNK) {
      const slice = externalIds.slice(i, i + CHUNK);
      const { data: existing, error: selErr } = await admin
        .from("transactions")
        .select("external_id")
        .eq("user_id", userId)
        .eq("origin", "open_finance")
        .in("external_id", slice);
      if (selErr) {
        return {
          itemId,
          accounts: accounts.length,
          upserted: 0,
          status: item.status,
          error: selErr.message,
        };
      }
      for (const r of existing ?? []) {
        if (r.external_id) seen.add(r.external_id as string);
      }
    }

    const toInsert = rows.filter(
      (r) => !r.external_id || !seen.has(r.external_id)
    );

    // Insere também em lotes (payload grande + segurança).
    for (let i = 0; i < toInsert.length; i += 200) {
      const batch = toInsert.slice(i, i + 200);
      const { error, count } = await admin
        .from("transactions")
        .insert(batch, { count: "exact" });
      if (error) {
        return {
          itemId,
          accounts: accounts.length,
          upserted,
          status: item.status,
          error: error.message,
        };
      }
      upserted += count ?? batch.length;

      // Commita os agregados do payee só agora, e só para as linhas
      // deste lote que FORAM de fato inseridas — evita contar de novo
      // transações que a janela de rewind reprocessa mas que o filtro
      // acima já descartou por já existirem (ver comentário no passo 7).
      for (const r of batch) {
        if (!r.payee_id) continue;
        try {
          await commitPayeeAggregates(admin, r.payee_id, {
            date: r.date,
            amount: r.amount,
            type: r.type,
          });
        } catch {
          // falha ao commitar agregados não deve derrubar o sync;
          // o payee já existe (foi resolvido antes), só os totais
          // ficam levemente desatualizados até o próximo sync.
        }
      }
    }
  }

  // 8. Marca o sync.
  await admin
    .from("pluggy_items")
    .update({ last_synced_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("item_id", itemId);

  return { itemId, accounts: accounts.length, upserted, status: item.status };
}

/** Memória (descrição limpa → categoryId) a partir de linhas cruas. */
function buildMemoryFromRows(
  rows: { description: string; category_id: string | null; needs_review: boolean; created_at: string }[]
): Map<string, string> {
  const memory = new Map<string, string>();
  const sorted = [...rows].sort((a, b) =>
    a.created_at.localeCompare(b.created_at)
  );
  for (const r of sorted) {
    if (r.category_id && !r.needs_review) {
      memory.set(r.description.toLowerCase(), r.category_id);
    }
  }
  return memory;
}

/** Tipo auxiliar só para manter compat com Transaction se necessário. */
export type _Tx = Transaction;
