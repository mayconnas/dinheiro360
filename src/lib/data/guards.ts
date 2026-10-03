// ─────────────────────────────────────────────────────────────
// Guardas de posse para as Server Actions.
//
// A RLS impede LER/ESCREVER linhas de outro usuário, mas uma chave
// estrangeira aceita o id de QUALQUER linha existente: sem esta checagem,
// um usuário poderia gravar `category_id` apontando para a categoria de
// outra pessoa. Toda action que recebe um categoryId do client passa
// por aqui antes de gravar.
// ─────────────────────────────────────────────────────────────
import "server-only";
import type { DbClient, Tables } from "@/lib/supabase/database.types";

export class OwnershipError extends Error {
  constructor(message = "Categoria não encontrada.") {
    super(message);
    this.name = "OwnershipError";
  }
}

/** Garante que as categorias existem e são do usuário; devolve id → kind/nome. */
export async function assertCategoriesOwned(
  supabase: DbClient,
  userId: string,
  categoryIds: string[]
): Promise<Map<string, Pick<Tables<"categories">, "id" | "kind" | "name">>> {
  const unique = [...new Set(categoryIds)];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase
    .from("categories")
    .select("id, kind, name")
    .eq("user_id", userId)
    .in("id", unique);
  if (error) throw new Error(error.message);
  const byId = new Map((data ?? []).map((c) => [c.id, c]));
  if (byId.size !== unique.length) throw new OwnershipError();
  return byId;
}

/** Versão de uma categoria só. */
export async function assertCategoryOwned(supabase: DbClient, userId: string, categoryId: string) {
  const byId = await assertCategoriesOwned(supabase, userId, [categoryId]);
  return byId.get(categoryId)!;
}
