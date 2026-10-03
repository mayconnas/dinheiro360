"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPluggySync } from "@/lib/pluggy/sync";
import { reprocessPayloadForUser } from "@/lib/pluggy/reprocess";
import { deleteItem } from "@/lib/pluggy/client";
import { cleanNameOnly } from "@/lib/engine/bank-name";


/** Um banco individual dentro de uma conexão (conta vinculada ao item). */
export interface ConnectionBank {
  /** nome cru da conta (gestor360.accounts.name) */
  name: string;
  /** nome amigável/curto para exibir como chip (ver cleanBankName) */
  cleanName: string;
  /** kind da conta (corrente/cartao/...) — informativo */
  kind: string;
}

export interface ConnectionInfo {
  itemId: string;
  connectorName: string | null;
  status: string;
  consentExpiresAt: string | null;
  lastSyncedAt: string | null;
  /**
   * Bancos individuais dentro desta conexão. Como o connector_name é o
   * proxy genérico ("MeuPluggy"), os bancos reais são os nomes distintos
   * das contas (gestor360.accounts) vinculadas a este item Pluggy.
   * Lista vazia quando não há contas vinculadas.
   */
  banks: ConnectionBank[];
}

/**
 * Rótulo curto e amigável de banco para uma conta. Prioriza o
 * `institution` já persistido em gestor360.accounts (migration 0010,
 * gravado no sync a partir do código COMPE — ver
 * src/lib/engine/bank-name.ts:cleanInstitution, a fonte MAIS
 * confiável). Cai para a limpeza por nome (cleanNameOnly, mesma
 * lista de apelidos usada no sync) só para contas antigas ainda sem
 * `institution` preenchido (sincronizadas antes desta migration, até
 * o próximo sync rodar). Ex.: "Nu Pagamentos S.A. - Instituição de
 * Pagamento" → "Nubank", "Banco Bradesco" → "Bradesco".
 */
function cleanBankName(raw: string, institution?: string | null): string {
  return institution || cleanNameOnly(raw);
}

/**
 * Chamada após o onSuccess do widget Pluggy Connect. Grava o item e
 * dispara a primeira carga (sincronização) já.
 */
export async function connectItem(
  itemId: string,
  connectorName?: string
): Promise<{ ok: boolean; error?: string; imported?: number }> {
  try {
    const userId = await requireUserId();
    const supabase = await createClient();

    // grava a conexão (idempotente por unique(user_id,item_id))
    const { error } = await supabase.from("pluggy_items").upsert(
      {
        user_id: userId,
        item_id: itemId,
        connector_name: connectorName ?? null,
        status: "updating",
      },
      { onConflict: "user_id,item_id" }
    );
    if (error) throw new Error(error.message);

    // primeira carga (usa o cliente admin para o sync, escopado ao userId)
    const admin = createAdminClient();
    const result = await runPluggySync(admin, userId, itemId);

    revalidatePath("/conexoes");
    revalidatePath("/");
    revalidatePath("/transacoes");
    return { ok: true, imported: result.upserted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "erro" };
  }
}

/** Lista as conexões (bancos) do usuário para a UI. */
export async function listConnections(): Promise<ConnectionInfo[]> {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pluggy_items")
    .select("item_id,connector_name,status,consent_expires_at,last_synced_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const items = data ?? [];

  // Bancos reais de cada conexão = nomes distintos das contas vinculadas
  // ao item Pluggy. O vínculo é accounts.pluggy_item_id = pluggy_items.item_id
  // (preenchido no sync ao criar a conta — ver src/lib/pluggy/sync.ts).
  const { data: accRows, error: accErr } = await supabase
    .from("accounts")
    .select("name,kind,pluggy_item_id,institution")
    .eq("user_id", userId)
    .not("pluggy_item_id", "is", null);
  if (accErr) throw new Error(accErr.message);

  // Agrupa contas por item, deduplicando por nome LIMPO de banco
  // (institution persistido, migration 0010 — ver cleanBankName acima).
  const banksByItem = new Map<string, ConnectionBank[]>();
  const seenByItem = new Map<string, Set<string>>();
  for (const a of accRows ?? []) {
    const itemId = a.pluggy_item_id as string | null;
    if (!itemId) continue;
    const cleanName = cleanBankName(a.name as string, a.institution as string | null);
    const seen = seenByItem.get(itemId) ?? new Set<string>();
    if (seen.has(cleanName)) continue;
    seen.add(cleanName);
    seenByItem.set(itemId, seen);
    const list = banksByItem.get(itemId) ?? [];
    list.push({ name: a.name as string, cleanName, kind: (a.kind as string) ?? "" });
    banksByItem.set(itemId, list);
  }

  // Fallback: contas antigas podem ter pluggy_item_id null. Se há só UMA
  // conexão, essas contas pertencem a ela — anexa-as (melhor esforço).
  if (items.length === 1) {
    const { data: orphanRows } = await supabase
      .from("accounts")
      .select("name,kind,institution")
      .eq("user_id", userId)
      .is("pluggy_item_id", null)
      .not("pluggy_account_id", "is", null);
    if (orphanRows && orphanRows.length > 0) {
      const only = items[0].item_id as string;
      const list = banksByItem.get(only) ?? [];
      const seen = seenByItem.get(only) ?? new Set<string>();
      for (const a of orphanRows) {
        const cleanName = cleanBankName(a.name as string, a.institution as string | null);
        if (seen.has(cleanName)) continue;
        seen.add(cleanName);
        list.push({ name: a.name as string, cleanName, kind: (a.kind as string) ?? "" });
      }
      banksByItem.set(only, list);
    }
  }

  return items.map((r) => ({
    itemId: r.item_id,
    connectorName: r.connector_name,
    // null = item recém-criado, ainda antes da primeira sincronização
    status: r.status ?? "UPDATING",
    consentExpiresAt: r.consent_expires_at,
    lastSyncedAt: r.last_synced_at,
    banks: banksByItem.get(r.item_id) ?? [],
  }));
}

/** Força uma sincronização imediata de um item. */
export async function syncNow(
  itemId: string
): Promise<{ ok: boolean; imported?: number; error?: string }> {
  try {
    const userId = await requireUserId();
    const admin = createAdminClient();
    const result = await runPluggySync(admin, userId, itemId);
    revalidatePath("/conexoes");
    revalidatePath("/");
    revalidatePath("/transacoes");
    return { ok: true, imported: result.upserted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "erro" };
  }
}

/**
 * R15 — revogação: apaga o Item na Pluggy (remove credenciais e dados
 * na fonte) e remove a conexão local. As transações já importadas são
 * mantidas como histórico (decisão: preservar o histórico do usuário).
 */
export async function disconnectItem(
  itemId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const userId = await requireUserId();
    const supabase = await createClient();

    // apaga na Pluggy (best-effort: se já não existe, seguimos)
    try {
      await deleteItem(itemId);
    } catch (e) {
      console.error("[pluggy disconnect] deleteItem falhou:", e);
    }

    const { error } = await supabase
      .from("pluggy_items")
      .delete()
      .eq("user_id", userId)
      .eq("item_id", itemId);
    if (error) throw new Error(error.message);

    revalidatePath("/conexoes");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "erro" };
  }
}

/**
 * R-BACKFILL — Reprocessa o payload completo da Pluggy para as
 * transações JÁ IMPORTADAS (a maioria veio do CSV pobre do Meu
 * Pluggy antes das migrations 0005/0006 e ficou sem forma de
 * pagamento, contraparte, merchant, categoria Pluggy e raw_payload).
 *
 * Diferente de runPluggySync (incremental, janela de 14 dias): aqui
 * buscamos o HISTÓRICO INTEIRO de cada item ATIVO do usuário via
 * fetchAllItemTransactions (sem createdAtFrom) e SÓ FAZEMOS UPDATE
 * nas linhas que já existem, casando por external_id — nunca insert.
 * amount/date/type/description/category_id/payee_id NÃO são tocados;
 * só as colunas novas (raw_payload, payment_method, operation_type,
 * counterparty_*, merchant_name, pluggy_category*) são enriquecidas.
 *
 * Idempotente: rodar de novo produz o mesmo UPDATE (mesmo payload da
 * API → mesmos valores). Usa o cliente admin (service_role, bypassa
 * RLS) porque escreve em lote; o escopo de segurança vem de userId
 * (resolvido da sessão) + o filtro .eq("user_id", userId) em toda
 * query.
 */
export interface ReSyncResult {
  ok: boolean;
  updated: number;
  notFound: number;
  error?: string;
}

export async function reSyncPluggyPayload(): Promise<ReSyncResult> {
  try {
    const userId = await requireUserId();
    // Mesma rotina do cron (/api/pluggy/reprocess) — uma implementação só.
    const { updated, notFound } = await reprocessPayloadForUser(createAdminClient(), userId);
    revalidatePath("/conexoes");
    revalidatePath("/");
    revalidatePath("/transacoes");
    return { ok: true, updated, notFound };
  } catch (e) {
    console.error("[reSyncPluggyPayload] falhou:", e);
    return { ok: false, updated: 0, notFound: 0, error: e instanceof Error ? e.message : "erro" };
  }
}
