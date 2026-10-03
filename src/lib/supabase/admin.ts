// ─────────────────────────────────────────────────────────────
// Cliente Supabase ADMIN (service_role) — contexto SEM sessão.
// Usado pelo webhook e pelo cron da Pluggy, que chegam sem cookie de
// usuário. O service_role BYPASSA a RLS, então o escopo ao user_id
// correto é responsabilidade DO CÓDIGO: sempre resolver
// pluggy_items.item_id → user_id antes de gravar.
// Roda SOMENTE no servidor.
// ─────────────────────────────────────────────────────────────
import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas."
    );
  }
  return createSupabaseClient<Database, "gestor360">(url, serviceRole, {
    db: { schema: "gestor360" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
