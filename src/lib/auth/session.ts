// ─────────────────────────────────────────────────────────────
// Sessão do usuário nas Server Actions — fonte única.
//
// Toda Server Action começa por aqui: valida o JWT no servidor
// (getUser, não getSession) e devolve o id do usuário. Antes cada
// arquivo de actions tinha a própria cópia desta função.
//
// Defesa em profundidade: mesmo com RLS (user_id = auth.uid()), as
// queries filtram `.eq("user_id", userId)` explicitamente — se um dia o
// cliente virar o admin (service_role, que ignora RLS), o isolamento
// por usuário continua garantido.
// ─────────────────────────────────────────────────────────────
import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Erro de autenticação — as actions o convertem em `{ ok: false, error }`. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Não autenticado.");
    this.name = "UnauthenticatedError";
  }
}

/** Id do usuário logado; lança UnauthenticatedError se não houver sessão válida. */
export async function requireUserId(): Promise<string> {
  const { userId } = await requireSession();
  return userId;
}

/**
 * Cliente Supabase da requisição + id do usuário, numa chamada só —
 * evita criar o cliente duas vezes (uma para o getUser, outra para a query).
 */
export async function requireSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthenticatedError();
  return { supabase, userId: user.id };
}
