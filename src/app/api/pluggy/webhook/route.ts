// POST /api/pluggy/webhook
// Recebe eventos da Pluggy (transactions/created, item/updated, item/error,
// item/deleted). SEM sessão (a Pluggy chama sem cookie).
//
// SEGURANÇA (a Pluggy NÃO usa HMAC): validamos um header secreto
// configurado no POST /webhooks da Pluggy (PLUGGY_WEBHOOK_SECRET) e,
// opcionalmente, o IP de origem (52.67.145.81). Responde 2XX em <5s e
// processa; dedup por eventId (a Pluggy faz retry até 9x).
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runPluggySync } from "@/lib/pluggy/sync";
import { toJsonColumn } from "@/lib/data/mappers";
import { logger } from "@/lib/observability/logger";

const log = logger.child({ module: "pluggy-webhook" });

const PLUGGY_WEBHOOK_IP = "52.67.145.81";

interface PluggyWebhookBody {
  event?: string;
  eventId?: string;
  itemId?: string;
  clientUserId?: string;
  triggeredBy?: string;
}

function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

export async function POST(req: NextRequest) {
  // 1. Autenticação por header secreto (configurado no POST /webhooks).
  const secret = process.env.PLUGGY_WEBHOOK_SECRET;
  if (secret) {
    const provided =
      req.headers.get("authorization") || req.headers.get("x-webhook-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "não autorizado" }, { status: 401 });
    }
  }
  // 2. (Opcional) IP whitelist — só rejeita se conseguimos identificar
  //    o IP e ele NÃO é o da Pluggy. Traefik/Swarm às vezes mascara o IP,
  //    então só aplicamos quando há um IP confiável e a flag está ligada.
  if (process.env.PLUGGY_WEBHOOK_ENFORCE_IP === "true") {
    const ip = clientIp(req);
    if (ip && ip !== PLUGGY_WEBHOOK_IP) {
      return NextResponse.json({ error: "ip não permitido" }, { status: 403 });
    }
  }

  let body: PluggyWebhookBody;
  try {
    body = (await req.json()) as PluggyWebhookBody;
  } catch {
    return NextResponse.json({ error: "corpo inválido" }, { status: 400 });
  }

  const { event, eventId, itemId } = body;
  const admin = createAdminClient();

  // 3. Idempotência: se já vimos esse eventId, responde OK sem reprocessar.
  if (eventId) {
    const { data: seen } = await admin
      .from("pluggy_webhook_events")
      .select("id")
      .eq("event_id", eventId)
      .maybeSingle();
    if (seen) return NextResponse.json({ ok: true, dedup: true });

    await admin.from("pluggy_webhook_events").insert({
      event_id: eventId,
      event: event ?? "unknown",
      item_id: itemId ?? null,
      payload: toJsonColumn(body) ?? {},
    });
  }

  if (!itemId) return NextResponse.json({ ok: true, ignored: true });

  // 4. Resolve item_id → user_id (a RLS não protege aqui; escopo no código).
  const { data: itemRow } = await admin
    .from("pluggy_items")
    .select("user_id")
    .eq("item_id", itemId)
    .maybeSingle();
  if (!itemRow) return NextResponse.json({ ok: true, unknownItem: true });
  const userId = itemRow.user_id as string;

  // 5. Trata o evento.
  try {
    if (event === "item/deleted") {
      await admin
        .from("pluggy_items")
        .delete()
        .eq("user_id", userId)
        .eq("item_id", itemId);
    } else {
      // transactions/created, item/updated, item/error → sincroniza.
      await runPluggySync(admin, userId, itemId);
    }
  } catch (e) {
    // Não retornamos 5xx por erro de sync (a Pluggy re-tentaria em loop);
    // logamos e devolvemos 200. O cron pega de novo depois.
    log.error("sync disparado pelo webhook falhou", { err: e, itemId });
  }

  return NextResponse.json({ ok: true });
}
