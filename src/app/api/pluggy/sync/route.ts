// GET/POST /api/pluggy/sync
// Fallback do webhook: percorre os pluggy_items "stale" e sincroniza.
// SEM sessão — protegido por CRON_SECRET (header Authorization: Bearer).
// Chamado por um scheduler (Vercel Cron ou cron externo na VPS).
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPluggySync } from "@/lib/pluggy/sync";

const STALE_HOURS = 6;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString();

  // itens nunca sincronizados OU com last_synced_at antigo.
  const { data: items, error } = await admin
    .from("pluggy_items")
    .select("user_id,item_id,last_synced_at")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];
  for (const it of items ?? []) {
    try {
      const r = await runPluggySync(admin, it.user_id, it.item_id);
      results.push(r);
    } catch (e) {
      // uma falha não aborta o lote.
      results.push({
        itemId: it.item_id,
        error: e instanceof Error ? e.message : "erro",
      });
    }
  }

  return NextResponse.json({ synced: results.length, results });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
