// GET/POST /api/pluggy/reprocess
// Enriquecimento retroativo: re-busca o histórico completo da API Pluggy
// e preenche as colunas novas (payment_method, contraparte, merchant,
// categoria, raw_payload) nas transações JÁ existentes, casando por
// external_id. NÃO cria linha nova. SEM sessão — protegido por
// CRON_SECRET. Roda para TODOS os usuários com item Pluggy (ou 1 se
// ?userId= for passado). Idempotente.
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reprocessPayloadForUser } from "@/lib/pluggy/reprocess";

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const onlyUser = req.nextUrl.searchParams.get("userId");

  // usuários distintos com item Pluggy
  const { data: items, error } = await admin
    .from("pluggy_items")
    .select("user_id");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  let userIds = Array.from(new Set((items ?? []).map((r) => r.user_id as string)));
  if (onlyUser) userIds = userIds.filter((u) => u === onlyUser);

  const results = [];
  let totalUpdated = 0;
  for (const userId of userIds) {
    try {
      const r = await reprocessPayloadForUser(admin, userId);
      totalUpdated += r.updated;
      results.push({ userId, ...r });
    } catch (e) {
      results.push({
        userId,
        error: e instanceof Error ? e.message : "erro",
      });
    }
  }

  return NextResponse.json({ users: userIds.length, totalUpdated, results });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
