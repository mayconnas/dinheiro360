"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  resolvePayeeIdForTransaction,
  commitPayeeAggregates,
} from "@/lib/data/payees-repo";
import type { PayeeKind } from "@/lib/engine/payee";

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Não autenticado.");
  return user.id;
}

export interface BackfillPayeesResult {
  ok: boolean;
  payeesCreated: number;
  txLinked: number;
  txSkipped: number;
  error?: string;
}

const BATCH_SIZE = 200;

/**
 * Backfill retroativo: percorre TODAS as transações do usuário e, para
 * cada uma sem payee_id, resolve o destinatário via parsing de
 * rawDescription (o histórico não tem counterpartyName da Pluggy salvo
 * à parte — só a descrição bruta do extrato) e grava o vínculo.
 *
 * Idempotente: busca direto no banco só as transações com
 * payee_id IS NULL (nada a refazer nas já vinculadas); o upsert de
 * payee é por normalized_name (nunca duplica) e o UPDATE só toca
 * transações ainda sem payee_id — rodar de novo é sempre seguro e não
 * duplica nada.
 *
 * Cuidado com dupla contagem: o registro do payee é resolvido (criado
 * se preciso) SEM incrementar tx_count/totais; os agregados só são
 * incrementados DEPOIS que o UPDATE ... WHERE payee_id IS NULL da
 * transação confirma (por linhas afetadas) que este processo venceu a
 * corrida e está linkando a transação pela 1ª vez. Se esse UPDATE
 * afetar 0 linhas (outra chamada concorrente já linkou antes), os
 * agregados NÃO são tocados — evita contar a mesma transação 2x mesmo
 * se o backfill for dessincronizado/reexecutado no meio de uma falha.
 * Processa em lotes de `BATCH_SIZE` transações para não estourar
 * memória/tempo de request numa base grande (~1400+ transações).
 */
export async function backfillPayees(): Promise<BackfillPayeesResult> {
  try {
    const userId = await requireUserId();
    const supabase = await createClient();

    // getTransactions() já traz tudo (sem sinceDate) — o campo payee_id
    // pode não estar mapeado em Transaction ainda dependendo da ordem de
    // integração; por segurança, buscamos direto as pendentes por SQL.
    const { data: pending, error: selErr } = await supabase
      .from("transactions")
      .select("id, date, amount, type, raw_description")
      .eq("user_id", userId)
      .is("payee_id", null);
    if (selErr) throw new Error(selErr.message);

    const rows = pending ?? [];
    if (rows.length === 0) {
      return { ok: true, payeesCreated: 0, txLinked: 0, txSkipped: 0 };
    }

    // payees existentes antes de começar, para contar quantos são NOVOS
    // (criados por este backfill) vs. já existentes (reaproveitados).
    const { count: payeesBefore } = await supabase
      .from("payees")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    let txLinked = 0;
    let txSkipped = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      for (const tx of batch) {
        const resolved = await resolvePayeeIdForTransaction(supabase, userId, {
          rawDescription: tx.raw_description ?? "",
          type: tx.type,
        });
        if (!resolved) {
          txSkipped++;
          continue;
        }
        // Link condicional: só grava se a transação ainda estiver sem
        // payee_id. `select("id")` no update devolve as linhas
        // efetivamente afetadas — se vier vazio, outra chamada
        // concorrente (ou uma execução anterior) já linkou esta
        // transação, então NÃO commitamos os agregados de novo (evita
        // contar a mesma transação duas vezes nos totais do payee).
        const { data: updated, error: updErr } = await supabase
          .from("transactions")
          .update({ payee_id: resolved.payeeId })
          .eq("id", tx.id)
          .is("payee_id", null)
          .select("id");
        if (updErr) throw new Error(updErr.message);
        if (!updated || updated.length === 0) {
          txSkipped++;
          continue;
        }
        await commitPayeeAggregates(supabase, resolved.payeeId, {
          date: tx.date,
          amount: Number(tx.amount),
          type: tx.type,
        });
        txLinked++;
      }
    }

    const { count: payeesAfter } = await supabase
      .from("payees")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const payeesCreated = Math.max(0, (payeesAfter ?? 0) - (payeesBefore ?? 0));

    revalidatePath("/");
    revalidatePath("/transacoes");
    revalidatePath("/destinatarios");

    return { ok: true, payeesCreated, txLinked, txSkipped };
  } catch (e) {
    return {
      ok: false,
      payeesCreated: 0,
      txLinked: 0,
      txSkipped: 0,
      error: e instanceof Error ? e.message : "Erro ao vincular destinatários.",
    };
  }
}

export interface PayeeListItem {
  id: string;
  name: string;
  normalizedName: string;
  documentNumber: string | null;
  kind: PayeeKind;
  firstSeen: string | null;
  lastSeen: string | null;
  txCount: number;
  totalPaid: number;
  totalReceived: number;
  /** Categoria padrão amarrada a este destinatário (ver setPayeeCategory) — null = sem vínculo automático. */
  defaultCategoryId: string | null;
}

/** Lista os destinatários do usuário, ordenados por frequência (tx_count desc). */
export async function listPayees(): Promise<PayeeListItem[]> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("payees")
    .select(
      "id, name, normalized_name, document_number, kind, first_seen, last_seen, tx_count, total_paid, total_received, default_category_id"
    )
    .eq("user_id", userId)
    .order("tx_count", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    normalizedName: r.normalized_name,
    documentNumber: r.document_number,
    kind: r.kind,
    firstSeen: r.first_seen,
    lastSeen: r.last_seen,
    txCount: r.tx_count,
    totalPaid: Number(r.total_paid),
    totalReceived: Number(r.total_received),
    defaultCategoryId: r.default_category_id ?? null,
  }));
}

export interface PayeeTransactionItem {
  id: string;
  date: string;
  amount: number;
  type: "entrada" | "saida";
  description: string;
}

/** Transações vinculadas a um destinatário específico (para drill-down na UI). */
export async function getTransactionsByPayee(
  payeeId: string
): Promise<PayeeTransactionItem[]> {
  const userId = await requireUserId();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .select("id, date, amount, type, description")
    .eq("user_id", userId)
    .eq("payee_id", payeeId)
    .order("date", { ascending: false });
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: r.id,
    date: r.date,
    amount: Number(r.amount),
    type: r.type,
    description: r.description,
  }));
}

export interface SetPayeeCategoryResult {
  ok: boolean;
  appliedCount: number;
  error?: string;
}

/**
 * Amarra um destinatário a uma categoria padrão (payees.default_category_id)
 * e aplica IMEDIATAMENTE a todas as transações PASSADAS desse payee —
 * decisão de produto: nada de categorizar 71 transações uma a uma, o
 * usuário amarra o destinatário e tudo que ele já tem fica categorizado
 * na hora. Transações FUTURAS herdam a categoria no momento da ingestão
 * (ver resolvePayeeIdForTransactionWithCategory em payees-repo.ts, usada
 * por addTransaction/importCSV/runPluggySync).
 *
 * Idempotente: chamar de novo com a mesma categoria é um no-op query-wise
 * (o UPDATE das transações não muda nada se já estavam nessa categoria);
 * chamar com uma categoria diferente reaplica a todas as transações do
 * payee, sempre convergindo para o estado "todas na categoria atual".
 */
export async function setPayeeCategory(
  payeeId: string,
  categoryId: string
): Promise<SetPayeeCategoryResult> {
  try {
    const userId = await requireUserId();
    const supabase = await createClient();

    // valida posse do payee (defesa em profundidade além da RLS)
    const { data: payee, error: payeeErr } = await supabase
      .from("payees")
      .select("id, name")
      .eq("id", payeeId)
      .eq("user_id", userId)
      .single();
    if (payeeErr) throw new Error(payeeErr.message);
    if (!payee) throw new Error("Destinatário não encontrado.");

    const { error: updPayeeErr } = await supabase
      .from("payees")
      .update({ default_category_id: categoryId })
      .eq("id", payeeId)
      .eq("user_id", userId);
    if (updPayeeErr) throw new Error(updPayeeErr.message);

    const { data: applied, error: applyErr } = await supabase
      .from("transactions")
      .update({ category_id: categoryId, needs_review: false })
      .eq("user_id", userId)
      .eq("payee_id", payeeId)
      .select("id");
    if (applyErr) throw new Error(applyErr.message);

    revalidatePath("/");
    revalidatePath("/transacoes");
    revalidatePath("/destinatarios");
    revalidatePath("/orcamento");
    return { ok: true, appliedCount: applied?.length ?? 0 };
  } catch (e) {
    return {
      ok: false,
      appliedCount: 0,
      error: e instanceof Error ? e.message : "Erro ao amarrar categoria ao destinatário.",
    };
  }
}

export interface ApplyCategoryToPayeeOfTransactionResult {
  ok: boolean;
  appliedCount: number;
  payeeName?: string;
  error?: string;
}

/**
 * Gatilho "aplicar a todo o <destinatário>?" disparado NA PRÓPRIA TELA
 * DE TRANSAÇÕES ao categorizar uma transação (decisão de produto: o
 * gatilho fica na transação, não numa tela separada de payees). Descobre
 * o payee_id da transação e delega para setPayeeCategory.
 *
 * Fallback para transações sem payee_id: as ~1411 transações antigas
 * (anteriores à Fase 6 / migration 0004) podem não ter payee_id mesmo
 * após o backfill, se a descrição não permitiu extrair um destinatário
 * (ver extractPayeeName em src/lib/engine/payee.ts). Nesse caso, em vez
 * de falhar, agrupamos pela mesma `description` (texto normalizado já
 * gravado na transação — é o que a tela mostra e o que o usuário associa
 * como "esse destinatário") e aplicamos a categoria a todas as
 * transações com essa descrição exata do usuário. Isso é um substituto
 * deliberadamente mais fraco que o agrupamento por payee_id (não cria
 * nem atualiza um payee), documentado aqui para não ser confundido com
 * o caminho principal.
 */
export async function applyCategoryToPayeeOfTransaction(
  transactionId: string,
  categoryId: string
): Promise<ApplyCategoryToPayeeOfTransactionResult> {
  try {
    const userId = await requireUserId();
    const supabase = await createClient();

    const { data: tx, error: txErr } = await supabase
      .from("transactions")
      .select("id, payee_id, description")
      .eq("id", transactionId)
      .eq("user_id", userId)
      .single();
    if (txErr) throw new Error(txErr.message);
    if (!tx) throw new Error("Transação não encontrada.");

    if (tx.payee_id) {
      const { data: payee } = await supabase
        .from("payees")
        .select("name")
        .eq("id", tx.payee_id)
        .maybeSingle();
      const result = await setPayeeCategory(tx.payee_id, categoryId);
      return { ...result, payeeName: payee?.name };
    }

    // Fallback por descrição — ver docstring acima.
    if (!tx.description || !tx.description.trim()) {
      throw new Error(
        "Transação sem destinatário nem descrição — não é possível agrupar."
      );
    }

    const { data: applied, error: applyErr } = await supabase
      .from("transactions")
      .update({ category_id: categoryId, needs_review: false })
      .eq("user_id", userId)
      .eq("description", tx.description)
      .select("id");
    if (applyErr) throw new Error(applyErr.message);

    revalidatePath("/");
    revalidatePath("/transacoes");
    return {
      ok: true,
      appliedCount: applied?.length ?? 0,
      payeeName: tx.description,
    };
  } catch (e) {
    return {
      ok: false,
      appliedCount: 0,
      error: e instanceof Error ? e.message : "Erro ao aplicar categoria ao destinatário.",
    };
  }
}
