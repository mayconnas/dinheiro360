// ─────────────────────────────────────────────────────────────
// Enriquecimento retroativo do payload Pluggy — reprocessa as
// transações JÁ existentes de um usuário, re-buscando o histórico
// completo da API e preenchendo as colunas novas (payment_method,
// raw_payload, contraparte, merchant, categoria Pluggy) casando por
// external_id. NÃO cria linha nova, NÃO altera amount/date/type.
//
// Extraído de reSyncPluggyPayload() (server action, exige sessão) para
// poder rodar também sem sessão (rota /api/pluggy/reprocess protegida
// por CRON_SECRET, e disparo administrativo/backfill).
// ─────────────────────────────────────────────────────────────
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllItemTransactions } from "@/lib/pluggy/sync";
import { pluggyConnector } from "@/lib/engine/pluggy";
import { normalize } from "@/lib/engine/normalizer";

export interface ReprocessResult {
  updated: number;
  notFound: number;
}

/**
 * Reprocessa (enriquece) as transações open_finance de UM usuário.
 * @param admin cliente admin (service_role) — RLS já resolvida pelo userId.
 */
export async function reprocessPayloadForUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: SupabaseClient<any, any, any>,
  userId: string
): Promise<ReprocessResult> {
  const { data: items, error: itemsErr } = await admin
    .from("pluggy_items")
    .select("item_id")
    .eq("user_id", userId);
  if (itemsErr) throw new Error(itemsErr.message);
  if (!items || items.length === 0) return { updated: 0, notFound: 0 };

  // external_id já existentes (para saber quais linhas atualizar).
  const existingIds = new Set<string>();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await admin
        .from("transactions")
        .select("id,external_id")
        .eq("user_id", userId)
        .eq("origin", "open_finance")
        .not("external_id", "is", null)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      for (const r of data) {
        if (r.external_id) existingIds.add(r.external_id as string);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }

  let updated = 0;
  let notFound = 0;

  for (const { item_id: itemId } of items) {
    let pluggyTxs;
    try {
      pluggyTxs = await fetchAllItemTransactions(itemId as string);
    } catch (e) {
      console.error(`[reprocessPayloadForUser] item ${itemId} falhou:`, e);
      continue;
    }

    const updates = [];
    for (const tx of pluggyTxs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const raw = pluggyConnector(tx as any);
      const n = normalize(raw);
      if (!n.externalId) continue;
      if (!existingIds.has(n.externalId)) {
        notFound++;
        continue;
      }
      updates.push({
        external_id: n.externalId,
        raw_payload: n.rawPayload ?? null,
        payment_method: n.paymentMethod ?? null,
        operation_type: n.operationType ?? null,
        counterparty_document: n.counterpartyDocument ?? null,
        counterparty_name: n.counterpartyName ?? null,
        merchant_name: n.merchantName ?? null,
        pluggy_category: n.pluggyCategory ?? null,
        pluggy_category_id: n.pluggyCategoryId ?? null,
        status: n.status ?? null,
        has_credit_card: n.hasCreditCard ?? null,
      });
    }

    const BATCH = 200;
    for (let i = 0; i < updates.length; i += BATCH) {
      const batch = updates.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((r) =>
          admin
            .from("transactions")
            .update({
              raw_payload: r.raw_payload,
              payment_method: r.payment_method,
              operation_type: r.operation_type,
              counterparty_document: r.counterparty_document,
              counterparty_name: r.counterparty_name,
              merchant_name: r.merchant_name,
              pluggy_category: r.pluggy_category,
              pluggy_category_id: r.pluggy_category_id,
              status: r.status,
              has_credit_card: r.has_credit_card,
            })
            .eq("user_id", userId)
            .eq("origin", "open_finance")
            .eq("external_id", r.external_id)
        )
      );
      for (const res of results) {
        if (res.error) {
          console.error("[reprocessPayloadForUser] update falhou:", res.error.message);
          continue;
        }
        updated++;
      }
    }
  }

  return { updated, notFound };
}
