// ─────────────────────────────────────────────────────────────
// Camada 2.2 — Categorizador (R4/R5)
// Precedência:
//   1. Regra manual do usuário (pattern na descrição) — sempre vence
//   2. Memória (descrição já categorizada assim antes)
//   3. Dicionário de estabelecimentos padrão (mapa embutido)
//   4. Fallback: "A revisar"
// Aprendizado: uma correção do usuário vira uma regra 'learned'.
// Função pura — recebe regras/memória, não acessa o banco.
// ─────────────────────────────────────────────────────────────
import type { Category, CategoryRule } from "@/lib/types";

/** Dicionário embutido: substring → nome de categoria de sistema. */
const DEFAULT_DICTIONARY: { match: string; category: string }[] = [
  { match: "ifood", category: "Comida fora" },
  { match: "rappi", category: "Comida fora" },
  { match: "mcdonald", category: "Comida fora" },
  { match: "burger", category: "Comida fora" },
  { match: "restaurante", category: "Comida fora" },
  { match: "padaria", category: "Comida fora" },
  { match: "uber", category: "Transporte" },
  { match: "99", category: "Transporte" },
  { match: "posto", category: "Transporte" },
  { match: "combustivel", category: "Transporte" },
  { match: "ipiranga", category: "Transporte" },
  { match: "shell", category: "Transporte" },
  { match: "netflix", category: "Assinaturas" },
  { match: "spotify", category: "Assinaturas" },
  { match: "amazon prime", category: "Assinaturas" },
  { match: "disney", category: "Assinaturas" },
  { match: "hbo", category: "Assinaturas" },
  { match: "youtube premium", category: "Assinaturas" },
  { match: "google", category: "Assinaturas" },
  { match: "mercado", category: "Mercado" },
  { match: "supermercado", category: "Mercado" },
  { match: "carrefour", category: "Mercado" },
  { match: "pao de acucar", category: "Mercado" },
  { match: "assai", category: "Mercado" },
  { match: "atacadao", category: "Mercado" },
  { match: "farmacia", category: "Saúde" },
  { match: "drogaria", category: "Saúde" },
  { match: "raia", category: "Saúde" },
  { match: "drogasil", category: "Saúde" },
  { match: "unimed", category: "Saúde" },
  { match: "aluguel", category: "Moradia" },
  { match: "condominio", category: "Moradia" },
  { match: "energia", category: "Contas fixas" },
  { match: "enel", category: "Contas fixas" },
  { match: "light", category: "Contas fixas" },
  { match: "sabesp", category: "Contas fixas" },
  { match: "vivo", category: "Contas fixas" },
  { match: "claro", category: "Contas fixas" },
  { match: "tim", category: "Contas fixas" },
  { match: "internet", category: "Contas fixas" },
  { match: "salario", category: "Salário" },
  { match: "pagamento salario", category: "Salário" },
  { match: "cinema", category: "Lazer" },
  { match: "ingresso", category: "Lazer" },
  { match: "steam", category: "Lazer" },
];

export type CategorizeSource = "user_rule" | "memory" | "dictionary" | "fallback";

export interface CategorizeOutput {
  categoryId: string | null;
  source: CategorizeSource;
  /** true quando caiu no fallback: precisa de revisão */
  needsReview: boolean;
}

interface CategorizerInput {
  description: string;
  rawDescription: string;
  categories: Category[];
  /** regras do usuário (manual + learned), R4/R5 */
  rules: CategoryRule[];
  /**
   * memória: descrição limpa → categoryId, montada a partir do
   * histórico já categorizado do próprio usuário.
   */
  memory: Map<string, string>;
}

function findCategoryByName(categories: Category[], name: string): string | null {
  const c = categories.find(
    (c) => c.name.toLowerCase() === name.toLowerCase()
  );
  return c?.id ?? null;
}

/**
 * Classifica uma transação seguindo a precedência R4.
 * Não acessa banco: tudo entra por parâmetro.
 */
export function categorize(input: CategorizerInput): CategorizeOutput {
  const haystack = `${input.description} ${input.rawDescription}`.toLowerCase();
  // Os chamadores passam `categories` já filtradas pelo kind da transação
  // (receita p/ entrada, despesa p/ saída). Regras e memória não carregam
  // kind, então só valem se apontarem para uma dessas categorias — senão
  // uma regra aprendida numa saída ("Joao Silva" → Moradia) categorizaria
  // uma entrada com a mesma descrição como despesa.
  const allowed = new Set(input.categories.map((c) => c.id));

  // 1. Regra manual do usuário — sempre vence (regras 'manual' antes de 'learned')
  const ordered = [...input.rules].sort((a, b) =>
    a.source === b.source ? 0 : a.source === "manual" ? -1 : 1
  );
  for (const rule of ordered) {
    if (!allowed.has(rule.categoryId)) continue;
    if (haystack.includes(rule.pattern.toLowerCase())) {
      return { categoryId: rule.categoryId, source: "user_rule", needsReview: false };
    }
  }

  // 2. Memória — essa descrição limpa já foi categorizada antes
  const memHit = input.memory.get(input.description.toLowerCase());
  if (memHit && allowed.has(memHit)) {
    return { categoryId: memHit, source: "memory", needsReview: false };
  }

  // 3. Dicionário embutido
  const dictId = dictionaryCategoryId(input.description, input.rawDescription, input.categories);
  if (dictId) return { categoryId: dictId, source: "dictionary", needsReview: false };

  // 4. Fallback — "A revisar"
  const revisarId = findCategoryByName(input.categories, "A revisar");
  return { categoryId: revisarId, source: "fallback", needsReview: true };
}

/**
 * A categoria que o dicionário embutido (passo 3 de categorize) daria a
 * este texto, entre `categories` (já filtradas pelo kind da transação):
 * a primeira entrada que casa E cuja categoria existe. Também usado para
 * NÃO tratar como "escolha do usuário" um lançamento que só está naquela
 * categoria porque o dicionário casou uma substring (ex "mercado" em
 * MERCADOLIVRE).
 */
export function dictionaryCategoryId(
  description: string,
  rawDescription: string,
  categories: Category[]
): string | null {
  const haystack = `${description} ${rawDescription}`.toLowerCase();
  for (const entry of DEFAULT_DICTIONARY) {
    if (haystack.includes(entry.match)) {
      const id = findCategoryByName(categories, entry.category);
      if (id) return id;
    }
  }
  return null;
}

/**
 * Deriva a regra automática a partir de uma correção do usuário (R5).
 * Usa a descrição limpa como pattern — na próxima, acerta sozinho.
 * Retorna null se o pattern for curto/ruidoso demais para virar regra.
 */
export function ruleFromCorrection(
  cleanDescription: string,
  categoryId: string
): { pattern: string; categoryId: string } | null {
  const pattern = cleanDescription.trim();
  if (pattern.length < 3) return null;
  return { pattern, categoryId };
}

export { DEFAULT_DICTIONARY };
