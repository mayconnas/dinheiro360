// ─────────────────────────────────────────────────────────────
// Camada 2.2 — aprendizado de regras (R5), com acesso ao banco.
// Compartilhado pelas server actions que categorizam lançamentos
// (src/app/actions/transactions.ts e src/app/actions/jev.ts).
// ─────────────────────────────────────────────────────────────
import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { ruleFromCorrection } from "@/lib/engine/categorizer";

/**
 * Upsert de uma regra 'learned' (R5): se já existe uma regra 'learned'
 * com esse pattern, atualiza a categoria; senão, insere. Compartilhado
 * por updateTransactionCategory / bulkUpdateCategory / acceptSuggestion
 * e pelo "aplicar decisões" do Jev.
 */
export async function upsertLearnedRule(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  cleanDescription: string,
  categoryId: string,
  options: {
    /**
     * false = não sobrescreve uma regra (manual ou learned) que já existe
     * para esse pattern apontando para OUTRA categoria — usado pelo
     * aprendizado em massa do Jev, que não deve desfazer decisões antigas.
     */
    overwrite?: boolean;
  } = {}
): Promise<boolean> {
  const overwrite = options.overwrite ?? true;
  const rule = ruleFromCorrection(cleanDescription, categoryId);
  if (!rule) return false;

  if (!overwrite) {
    const { data: conflicting, error } = await supabase
      .from("category_rules")
      .select("id")
      .eq("user_id", userId)
      .eq("pattern", rule.pattern)
      .neq("category_id", categoryId)
      .limit(1);
    // na dúvida (erro de leitura), não arrisca sobrescrever
    if (error || (conflicting && conflicting.length > 0)) return false;
  }

  const { data: existing } = await supabase
    .from("category_rules")
    .select("id,category_id")
    .eq("user_id", userId)
    .eq("pattern", rule.pattern)
    .eq("source", "learned")
    .maybeSingle();
  if (existing) {
    if (existing.category_id === categoryId) return false; // já existia igual
    const { error } = await supabase
      .from("category_rules")
      .update({ category_id: categoryId })
      .eq("id", existing.id);
    return !error;
  }
  const { error } = await supabase.from("category_rules").insert({
    user_id: userId,
    pattern: rule.pattern,
    category_id: categoryId,
    source: "learned",
  });
  return !error;
}
