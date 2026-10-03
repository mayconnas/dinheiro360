"use server";

import { getWorkspace } from "@/lib/data/repository";
import { buildContextPackage } from "@/lib/engine/context-package";
import { diagnose, consult } from "@/lib/ai/brain";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/lib/auth/session";
import { parseInput } from "@/lib/validation";
import { z } from "zod";

// Teto de entrada do chat: cada caractere vira token pago no provedor de IA.
const AskInput = z.object({
  question: z.string().trim().min(1, "Digite uma pergunta.").max(2000, "Pergunta longa demais (máx. 2.000 caracteres)."),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(20, "Conversa longa demais — comece uma nova."),
});
import type { ContextPackage } from "@/lib/engine/context-package";
import { getFullFinancialData } from "@/lib/data/ai-queries";
import { buildFullContext } from "@/lib/ai/full-context";
import { classifyForViews, OWNER_DOCUMENTS } from "@/lib/engine/transfers";

/** "Hoje" e mês corrente. Isolado para facilitar testes/determinismo. */
function nowRefs(): { today: string; month: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return { today: `${y}-${m}-${day}`, month: `${y}-${m}` };
}

/** Usuário logado — usado para resolver a credencial de IA ativa (brain.ts). */

/** Monta o Pacote de Contexto do usuário logado para o mês corrente. */
async function assemblePackage(refs: { today: string; month: string }): Promise<ContextPackage> {
  const ws = await getWorkspace();
  if (!ws.profile) {
    throw new Error("Perfil não encontrado. Faça login novamente.");
  }
  return buildContextPackage({
    profile: ws.profile,
    transactions: ws.transactions,
    categories: ws.categories,
    accounts: ws.accounts,
    budgets: ws.budgets,
    goals: ws.goals,
    month: refs.month,
    today: refs.today,
  });
}

/**
 * Monta o Contexto Completo (lista transação-a-transação + saldos +
 * cartões + destinatários + plano de contas), com a classificação das
 * DUAS VISÕES (fluxo de caixa x controle de gastos, pagamento de fatura
 * como ponte — ver src/lib/engine/transfers.ts classifyForViews)
 * INJETADA — o advisor calcula com classifyForViews e ADAPTA pro shape
 * achatado que buildFullContext espera (TxClassification, estrutural,
 * sem importar transfers.ts — ver comentário no topo de full-context.ts).
 * Falha graciosa: se qualquer leitura/monte quebrar, devolve `undefined`
 * e a IA opera só com o pacote determinístico.
 */
async function assembleRichContext(
  userId: string,
  refs: { today: string; month: string }
): Promise<string | undefined> {
  try {
    const data = await getFullFinancialData(userId, { monthsBack: 12 });
    const accountKindById = new Map(data.accounts.map((a) => [a.id, a.kind]));
    const view = classifyForViews(data.transactions, {
      ownerDocuments: OWNER_DOCUMENTS,
      accountKindById,
    });
    return buildFullContext(
      data,
      {
        cashflowIncome: view.cashflow.income,
        cashflowExpense: view.cashflow.expense,
        spending: view.spending,
        cardPurchase: view.legacy.cardPurchase,
        billPaymentCash: view.billPayments.billPaymentCash,
        reasons: view.reasons,
      },
      {
        today: refs.today,
        month: refs.month,
        ownerDocuments: OWNER_DOCUMENTS,
      }
    );
  } catch {
    // Sem contexto rico: cai no pacote determinístico (compat). Não logamos
    // detalhe para não vazar dado sensível no console.
    return undefined;
  }
}

export interface AdvisorResponse {
  ok: boolean;
  text: string;
  error?: string;
}

/** 4.1/4.2/4.4 — diagnóstico completo do mês. */
export async function getDiagnosis(): Promise<AdvisorResponse> {
  try {
    const userId = await requireUserId();
    const refs = nowRefs();
    const pkg = await assemblePackage(refs);
    const richContext = await assembleRichContext(userId, refs);
    const result = await diagnose(pkg, userId, richContext);
    return { ok: true, text: result.text };
  } catch (e) {
    return {
      ok: false,
      text: "",
      error: e instanceof Error ? e.message : "Erro ao consultar o gestor.",
    };
  }
}

/** 4.3 — Consultor Q&A. */
export async function askAdvisor(
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<AdvisorResponse> {
  try {
    ({ question, history } = parseInput(AskInput, { question, history }));
    const userId = await requireUserId();
    const refs = nowRefs();
    const pkg = await assemblePackage(refs);
    const richContext = await assembleRichContext(userId, refs);
    const result = await consult(pkg, question, history, userId, richContext);
    return { ok: true, text: result.text };
  } catch (e) {
    return {
      ok: false,
      text: "",
      error: e instanceof Error ? e.message : "Erro ao consultar o gestor.",
    };
  }
}

/** Expõe o Pacote de Contexto cru (para inspeção/debug na UI). */
export async function getContextPackage(): Promise<ContextPackage> {
  return assemblePackage(nowRefs());
}
