// ─────────────────────────────────────────────────────────────
// Camada 2.1b — Repositório de Destinatários (Payees).
// Upsert idempotente (onConflict user_id,normalized_name) + agregados
// incrementais (first_seen/last_seen/tx_count/total_paid/total_received).
// Recebe o cliente Supabase já pronto (server ou admin) para funcionar
// tanto em request (RLS) quanto em webhook/cron/backfill (service_role).
// Funções puras de extração ficam em src/lib/engine/payee.ts — este
// arquivo é só a ponte com o banco.
// ─────────────────────────────────────────────────────────────
import "server-only";
import type { DbClient } from "@/lib/supabase/database.types";
import {
  extractPayeeName,
  normalizePayeeName,
  guessKind,
  type PayeeKind,
} from "@/lib/engine/payee";
import type { TransactionType } from "@/lib/types";

type AnySupabase = DbClient;

export interface UpsertPayeeInput {
  name: string;
  normalizedName: string;
  documentNumber?: string | null;
  kind: PayeeKind;
  /** ISO AAAA-MM-DD da transação que originou/atualizou este payee. */
  date: string;
  amount: number;
  type: TransactionType;
}

/**
 * Garante o payee do usuário (upsert por (user_id, normalized_name)) e
 * atualiza os agregados incrementalmente:
 *  • first_seen = min(existente, date) · last_seen = max(existente, date)
 *  • tx_count += 1
 *  • total_paid / total_received += amount, conforme `type`
 *  • document_number: preenche se ainda não tinha (nunca sobrescreve um
 *    já capturado por um valor vazio)
 *  • kind: só é promovido de 'desconhecido' para algo mais específico —
 *    não regride um kind já conhecido de volta a 'desconhecido'
 *
 * ATENÇÃO — incrementa sempre que chamado: cada chamada soma +1 em
 * tx_count e += amount nos totais, então SÓ deve ser chamada uma única
 * vez por transação, no momento em que ela é efetivamente gravada/
 * vinculada (payee_id passa de NULL para um valor). Reprocessar a MESMA
 * transação (ex.: um backfill rodando 2x, ou uma janela de sync
 * reprocessando dias já sincronizados) NÃO pode chamar isto de novo —
 * use resolvePayeeId (sem incremento) para descobrir/criar o payee sem
 * tocar nos agregados, e só chame commitPayeeAggregates depois de
 * confirmar (via UPDATE ... WHERE payee_id IS NULL) que esta é a
 * primeira vez que a transação está sendo linkada. Retorna o id do payee.
 */
export async function upsertPayee(
  supabase: AnySupabase,
  userId: string,
  input: UpsertPayeeInput
): Promise<string> {
  const payeeId = await resolvePayeeId(supabase, userId, {
    name: input.name,
    normalizedName: input.normalizedName,
    documentNumber: input.documentNumber,
    kind: input.kind,
  });
  await commitPayeeAggregates(supabase, payeeId, {
    date: input.date,
    amount: input.amount,
    type: input.type,
  });
  return payeeId;
}

export interface ResolvePayeeIdInput {
  name: string;
  normalizedName: string;
  documentNumber?: string | null;
  kind: PayeeKind;
}

/**
 * Encontra ou cria o payee (user_id, normalized_name) SEM tocar nos
 * agregados (tx_count/total_paid/total_received/first_seen/last_seen).
 * Seguro para chamar quantas vezes for preciso — nunca duplica (a
 * UNIQUE de banco é quem garante) e nunca infla contadores. Use isto
 * quando ainda não se sabe se a transação será de fato linkada (ex.:
 * backfill, sync com janela sobreposta).
 */
export async function resolvePayeeId(
  supabase: AnySupabase,
  userId: string,
  input: ResolvePayeeIdInput
): Promise<string> {
  const { data: existing, error: selErr } = await supabase
    .from("payees")
    .select("id")
    .eq("user_id", userId)
    .eq("normalized_name", input.normalizedName)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);

  if (existing) return existing.id as string;

  const { data: created, error: insErr } = await supabase
    .from("payees")
    .insert({
      user_id: userId,
      name: input.name,
      normalized_name: input.normalizedName,
      document_number: input.documentNumber ?? null,
      kind: input.kind,
      first_seen: null,
      last_seen: null,
      tx_count: 0,
      total_paid: 0,
      total_received: 0,
    })
    .select("id")
    .single();
  if (insErr) {
    // 23505 = unique_violation: outra chamada concorrente já criou.
    if ((insErr as { code?: string }).code === "23505") {
      return resolvePayeeId(supabase, userId, input);
    }
    throw new Error(insErr.message);
  }
  return created.id as string;
}

export interface CommitPayeeAggregatesInput {
  date: string;
  amount: number;
  type: TransactionType;
  documentNumber?: string | null;
  kind?: PayeeKind;
}

/**
 * Incrementa os agregados de UM payee para UMA transação. Só deve ser
 * chamada exatamente uma vez por transação — no instante em que ela é
 * confirmada como recém-linkada (o chamador garante isso com um
 * UPDATE condicional payee_id IS NULL antes de chamar aqui; se 0 linhas
 * foram afetadas, a transação já estava linkada e este método NÃO deve
 * ser chamado, sob pena de contar a mesma transação duas vezes).
 */
export async function commitPayeeAggregates(
  supabase: AnySupabase,
  payeeId: string,
  input: CommitPayeeAggregatesInput
): Promise<void> {
  const { data: existing, error: selErr } = await supabase
    .from("payees")
    .select("first_seen, last_seen, tx_count, total_paid, total_received, document_number, kind")
    .eq("id", payeeId)
    .single();
  if (selErr) throw new Error(selErr.message);

  const isPaid = input.type === "saida";
  const firstSeen =
    !existing.first_seen || input.date < existing.first_seen
      ? input.date
      : existing.first_seen;
  const lastSeen =
    !existing.last_seen || input.date > existing.last_seen
      ? input.date
      : existing.last_seen;
  const kind: PayeeKind =
    existing.kind && existing.kind !== "desconhecido"
      ? (existing.kind as PayeeKind)
      : input.kind ?? (existing.kind as PayeeKind) ?? "desconhecido";
  const documentNumber = existing.document_number ?? input.documentNumber ?? null;

  const { error: updErr } = await supabase
    .from("payees")
    .update({
      first_seen: firstSeen,
      last_seen: lastSeen,
      tx_count: (existing.tx_count ?? 0) + 1,
      total_paid: Number(existing.total_paid ?? 0) + (isPaid ? input.amount : 0),
      total_received: Number(existing.total_received ?? 0) + (isPaid ? 0 : input.amount),
      document_number: documentNumber,
      kind,
    })
    .eq("id", payeeId);
  if (updErr) throw new Error(updErr.message);
}

export interface ResolvePayeeInput {
  counterpartyName?: string | null;
  counterpartyDocument?: string | null;
  rawDescription: string;
  type: TransactionType;
  date: string;
  amount: number;
}

/**
 * Resolve (extrai + normaliza + classifica + upsert) o payee de uma
 * transação e JÁ COMMITA os agregados (tx_count/totais) — use apenas
 * quando a transação é NOVA e será inserida de qualquer forma (ex.:
 * addTransaction, importCSV: nunca reprocessam a mesma transação já
 * existente). Devolve o payee_id, ou null quando não dá pra extrair um
 * nome de contraparte (ex: descrição genérica demais, "TARIFA MENSAL").
 *
 * Para fluxos que podem REPROCESSAR uma transação já existente (backfill
 * revisitando payee_id IS NULL, sync com janela de rewind reprocessando
 * dias já sincronizados), NÃO use esta função — ela incrementaria os
 * agregados de novo a cada reprocessamento. Use resolvePayeeIdForTransaction
 * (sem incremento) + commitPayeeAggregates só após confirmar por UPDATE
 * condicional que o vínculo é de fato novo.
 */
export async function resolvePayeeForTransaction(
  supabase: AnySupabase,
  userId: string,
  input: ResolvePayeeInput
): Promise<string | null> {
  const resolved = await resolvePayeeIdForTransaction(supabase, userId, input);
  if (!resolved) return null;

  await commitPayeeAggregates(supabase, resolved.payeeId, {
    date: input.date,
    amount: input.amount,
    type: input.type,
  });
  return resolved.payeeId;
}

export interface ResolvedPayee {
  payeeId: string;
  /** true se o registro de payee acabou de ser criado por esta chamada. */
  created: boolean;
}

/**
 * Extrai + normaliza + classifica + garante o registro do payee (cria se
 * não existir), SEM incrementar agregados. Idempotente e seguro para
 * reprocessar a mesma transação quantas vezes for preciso — nunca cria
 * payee duplicado (UNIQUE user_id+normalized_name) e nunca infla
 * tx_count/totais. O chamador decide quando (e se) chamar
 * commitPayeeAggregates, tipicamente só após confirmar via UPDATE
 * condicional (payee_id IS NULL) que a transação está sendo linkada
 * pela primeira vez.
 */
export interface ResolvedPayeeWithCategory extends ResolvedPayee {
  /** Categoria padrão amarrada ao payee (setPayeeCategory), ou null se não houver. */
  defaultCategoryId: string | null;
}

/**
 * Igual a resolvePayeeIdForTransaction, mas também devolve o
 * default_category_id do payee (se houver) — usado pelos três caminhos
 * de ingestão (addTransaction/importCSV/runPluggySync) para que uma
 * transação NOVA já nasça com a categoria amarrada ao destinatário
 * (vínculo automático futuro, ver setPayeeCategory em
 * src/app/actions/payees.ts), com precedência sobre o categorizador
 * automático.
 */
export async function resolvePayeeIdForTransactionWithCategory(
  supabase: AnySupabase,
  userId: string,
  input: Pick<ResolvePayeeInput, "counterpartyName" | "counterpartyDocument" | "rawDescription" | "type">
): Promise<ResolvedPayeeWithCategory | null> {
  const name = extractPayeeName({
    counterpartyName: input.counterpartyName ?? undefined,
    rawDescription: input.rawDescription,
    type: input.type,
  });
  if (!name) return null;

  const normalizedName = normalizePayeeName(name);
  if (!normalizedName) return null;

  const kind = guessKind({
    counterpartyDocument: input.counterpartyDocument ?? undefined,
    name,
    isMerchant: !!input.counterpartyName,
  });

  const { data: existingBefore } = await supabase
    .from("payees")
    .select("id, default_category_id")
    .eq("user_id", userId)
    .eq("normalized_name", normalizedName)
    .maybeSingle();

  const payeeId = await resolvePayeeId(supabase, userId, {
    name,
    normalizedName,
    documentNumber: input.counterpartyDocument ?? null,
    kind,
  });

  return {
    payeeId,
    created: !existingBefore,
    defaultCategoryId: existingBefore?.default_category_id ?? null,
  };
}

export async function resolvePayeeIdForTransaction(
  supabase: AnySupabase,
  userId: string,
  input: Pick<ResolvePayeeInput, "counterpartyName" | "counterpartyDocument" | "rawDescription" | "type">
): Promise<ResolvedPayee | null> {
  const name = extractPayeeName({
    counterpartyName: input.counterpartyName ?? undefined,
    rawDescription: input.rawDescription,
    type: input.type,
  });
  if (!name) return null;

  const normalizedName = normalizePayeeName(name);
  if (!normalizedName) return null;

  const kind = guessKind({
    counterpartyDocument: input.counterpartyDocument ?? undefined,
    name,
    isMerchant: !!input.counterpartyName,
  });

  const { data: existingBefore } = await supabase
    .from("payees")
    .select("id")
    .eq("user_id", userId)
    .eq("normalized_name", normalizedName)
    .maybeSingle();

  const payeeId = await resolvePayeeId(supabase, userId, {
    name,
    normalizedName,
    documentNumber: input.counterpartyDocument ?? null,
    kind,
  });

  return { payeeId, created: !existingBefore };
}
