// ─────────────────────────────────────────────────────────────
// GET /api/health — health check da aplicação.
//
// Usado pelo HEALTHCHECK do container (Dockerfile/stack.yml), pelo
// pipeline de deploy (espera o "ok" depois do `docker stack deploy`) e
// por monitores externos (UptimeRobot, Uptime Kuma…).
//
//   200 → { status: "ok", ... }        tudo certo
//   503 → { status: "degraded", ... }  algum check falhou
//
// Duas sondas:
//   GET /api/health              readiness: checa o banco. Para o deploy
//                                e para monitores externos.
//   GET /api/health?probe=live   liveness: só "o processo responde". É a
//                                que o HEALTHCHECK do container usa — se
//                                dependesse do banco, uma queda do Supabase
//                                faria o Swarm reciclar o app em loop sem
//                                que reiniciar resolvesse nada.
//
// Público e SEM sessão (o middleware não redireciona /api/*). Por isso
// a resposta nunca carrega segredo nem mensagem crua do banco — o
// detalhe completo da falha vai só para o log estruturado.
// ─────────────────────────────────────────────────────────────
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DB_TIMEOUT_MS = 3_000;

const log = logger.child({ module: "health" });

type CheckResult = { ok: boolean; latencyMs: number; error?: string };

type HealthBody = {
  status: "ok" | "degraded";
  version: string;
  commit: string | null;
  uptimeSeconds: number;
  checks: { database: CheckResult };
};

/** Consulta barata no Postgres via PostgREST (service_role), com timeout. */
async function checkDatabase(): Promise<CheckResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, latencyMs: 0, error: "service role não configurada" };
  }

  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DB_TIMEOUT_MS);

  try {
    const { error } = await createAdminClient()
      .from("categories")
      .select("id", { head: true, count: "exact" })
      .limit(1)
      .abortSignal(controller.signal);

    if (controller.signal.aborted) {
      log.warn("health: timeout no banco", { timeoutMs: DB_TIMEOUT_MS });
      return { ok: false, latencyMs: elapsed(), error: `timeout após ${DB_TIMEOUT_MS}ms` };
    }
    if (error) {
      log.warn("health: consulta ao banco falhou", { err: error });
      return {
        ok: false,
        latencyMs: elapsed(),
        error: error.code ? `consulta falhou (código ${error.code})` : "consulta falhou",
      };
    }
    return { ok: true, latencyMs: elapsed() };
  } catch (err) {
    const timedOut = controller.signal.aborted;
    log.warn("health: erro ao checar o banco", { err, timedOut });
    return {
      ok: false,
      latencyMs: elapsed(),
      error: timedOut ? `timeout após ${DB_TIMEOUT_MS}ms` : "erro ao conectar no banco",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("probe") === "live") {
    return NextResponse.json(
      { status: "ok", uptimeSeconds: Math.round(process.uptime()) },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const database = await checkDatabase();
  const status: HealthBody["status"] = database.ok ? "ok" : "degraded";

  const body: HealthBody = {
    status,
    // `||` (e não `??`): o stack.yml passa "" quando o deploy não informa
    // a variável — string vazia também cai no valor padrão.
    version: process.env.APP_VERSION || "dev",
    commit: process.env.GIT_SHA || null,
    uptimeSeconds: Math.round(process.uptime()),
    checks: { database },
  };

  return NextResponse.json(body, {
    status: status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
