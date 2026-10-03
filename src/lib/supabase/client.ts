import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/** Schema isolado deste projeto no Postgres compartilhado da VPS. */
export const DB_SCHEMA = "gestor360";

/** Cliente Supabase para uso no navegador (componentes 'use client'). */
export function createClient() {
  return createBrowserClient<Database, typeof DB_SCHEMA>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: DB_SCHEMA } }
  );
}
