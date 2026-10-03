import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "./database.types";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Cliente Supabase para Server Components, Route Handlers e Server Actions.
 * Lê/escreve a sessão pelos cookies da requisição.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database, "gestor360">(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // schema isolado deste projeto no Postgres compartilhado da VPS
      db: { schema: "gestor360" },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Chamado de um Server Component: a atualização de sessão
            // acontece no middleware, então ignorar aqui é seguro.
          }
        },
      },
    }
  );
}

/**
 * Usuário autenticado, DEDUPLICADO por request (React cache). Sem isso,
 * cada Server Component/página que precisa do usuário faz um round-trip
 * separado ao Auth do Supabase.
 * Continua sendo getUser() (valida o JWT no servidor). Use quando precisar
 * da validação forte; para só ler nome/email no render, prefira
 * getUserClaims() (sem round-trip).
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Claims do usuário lidas do JWT do cookie — SEM round-trip ao servidor de
 * Auth (getClaims verifica a assinatura localmente). O MIDDLEWARE já faz o
 * getUser() forte (valida no servidor) em toda navegação e redireciona
 * quem não está logado; então no layout/páginas só precisamos dos dados do
 * token (id, email, nome). Isso elimina 1 dos 2 round-trips que dominavam
 * o tempo de navegação (~0.4-0.6s por troca de aba, com picos de ~2s).
 */
export const getUserClaims = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return {
    id: claims.sub as string,
    email: (claims.email as string | undefined) ?? null,
    displayName:
      ((claims.user_metadata as Record<string, unknown> | undefined)
        ?.display_name as string | undefined) ?? null,
  };
});
