// ─────────────────────────────────────────────────────────────
// Sugestão de categoria para itens "a revisar".
// Reaproveita o categorizador (R4) mas SÓ aceita o resultado quando
// ele não caiu no fallback "A revisar" — ou seja, só sugere quando o
// dicionário/memória/regra deram um match real. Função pura: tudo
// entra por parâmetro, nada de acesso a banco aqui.
// ─────────────────────────────────────────────────────────────
import type { Category, CategoryRule, Transaction } from "@/lib/types";
import { categorize } from "@/lib/engine/categorizer";

export interface SuggestionEntry {
  categoryId: string;
  categoryName: string;
}

/**
 * Calcula sugestões para as transações passadas (tipicamente as que
 * estão `needsReview` ou sem categoria / categoria "A revisar").
 * Para cada uma, roda `categorize` ignorando as próprias regras
 * "aprendidas" a partir dela mesma — não é necessário filtrar rules
 * aqui pois `categorize` já é determinístico e puro.
 *
 * IMPORTANTE: a categoria sugerida é sempre filtrada pelo mesmo
 * `kind` (receita/despesa) da transação, replicando a regra usada em
 * addTransaction/importCSV.
 */
export function computeSuggestions(
  transactions: Transaction[],
  categories: Category[],
  rules: CategoryRule[],
  memory: Map<string, string>
): Map<string, SuggestionEntry> {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const result = new Map<string, SuggestionEntry>();

  for (const t of transactions) {
    const relevantCats = categories.filter((c) =>
      t.type === "entrada" ? c.kind === "receita" : c.kind === "despesa"
    );
    const out = categorize({
      description: t.description,
      rawDescription: t.rawDescription,
      categories: relevantCats,
      rules,
      memory,
    });
    // só é sugestão de verdade quando não caiu no fallback e a
    // categoria resolvida é DIFERENTE da categoria atual da transação
    // (evita "sugerir" a própria categoria "A revisar" já atribuída).
    if (out.needsReview || !out.categoryId) continue;
    if (out.categoryId === t.categoryId) continue;

    const cat = catById.get(out.categoryId);
    if (!cat) continue;

    result.set(t.id, { categoryId: cat.id, categoryName: cat.name });
  }

  return result;
}
