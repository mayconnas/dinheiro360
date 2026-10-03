"use client";

import { useState, useTransition, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  Building2,
  Plus,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
} from "lucide-react";
import {
  connectItem,
  syncNow,
  disconnectItem,
  reSyncPluggyPayload,
  type ConnectionInfo,
} from "@/app/actions/pluggy";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, cn } from "@/lib/utils";

// O widget da Pluggy acessa `window` no import, então NÃO pode rodar no
// servidor (SSR). Carrega só no navegador (ssr: false).
const PluggyConnect = dynamic(
  () => import("react-pluggy-connect").then((m) => m.PluggyConnect),
  { ssr: false }
);

interface Props {
  connections: ConnectionInfo[];
}

const STATUS_META: Record<
  string,
  { label: string; variant: "success" | "warning" | "destructive" | "secondary"; icon: typeof CheckCircle2 }
> = {
  UPDATED: { label: "Conectado", variant: "success", icon: CheckCircle2 },
  UPDATING: { label: "Sincronizando", variant: "secondary", icon: RefreshCw },
  LOGIN_ERROR: { label: "Reconectar", variant: "destructive", icon: AlertTriangle },
  WAITING_USER_INPUT: { label: "Ação necessária", variant: "warning", icon: AlertTriangle },
  OUTDATED: { label: "Desatualizado", variant: "warning", icon: Clock },
  updating: { label: "Sincronizando", variant: "secondary", icon: RefreshCw },
};

export function ConnectionsView({ connections }: Props) {
  const [showWidget, setShowWidget] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [loadingToken, setLoadingToken] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(
    null
  );
  const [reprocessing, startReprocess] = useTransition();

  const doReprocess = useCallback(() => {
    setBanner(null);
    startReprocess(async () => {
      const r = await reSyncPluggyPayload();
      if (r.ok) {
        setBanner({
          kind: "ok",
          msg: `${r.updated} transações enriquecidas de ${r.updated + r.notFound}.`,
        });
      } else {
        setBanner({ kind: "err", msg: r.error ?? "Erro ao reprocessar." });
      }
    });
  }, []);

  const openWidget = useCallback(async () => {
    setBanner(null);
    setLoadingToken(true);
    try {
      const res = await fetch("/api/pluggy/connect-token", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao gerar token.");
      setToken(data.accessToken);
      setShowWidget(true);
    } catch (e) {
      setBanner({
        kind: "err",
        msg: e instanceof Error ? e.message : "Erro ao abrir o conector.",
      });
    } finally {
      setLoadingToken(false);
    }
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onSuccess = useCallback((itemData: any) => {
    setShowWidget(false);
    const itemId: string | undefined = itemData?.item?.id;
    const connector: string | undefined = itemData?.item?.connector?.name;
    if (!itemId) return;
    connectItem(itemId, connector).then((r) => {
      if (r.ok) {
        setBanner({
          kind: "ok",
          msg: `Banco conectado! ${r.imported ?? 0} transações importadas.`,
        });
      } else {
        setBanner({ kind: "err", msg: r.error ?? "Erro ao conectar." });
      }
    });
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Conexões</h1>
          <p className="text-muted-foreground">
            Conecte seus bancos via Open Finance (Pluggy) e o sistema puxa as
            transações sozinho.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {connections.length > 0 && (
            <Button
              variant="outline"
              onClick={doReprocess}
              disabled={reprocessing}
              title="Rebusca o histórico completo na Pluggy e preenche forma de pagamento, contraparte, merchant e categoria das transações que já estão importadas, sem duplicar e sem precisar reconectar."
            >
              <Sparkles className={cn("h-4 w-4", reprocessing && "animate-pulse")} />
              {reprocessing ? "Reprocessando…" : "Reprocessar dados do Open Finance"}
            </Button>
          )}
          <Button onClick={openWidget} disabled={loadingToken}>
            <Plus className="h-4 w-4" />
            {loadingToken ? "Abrindo…" : "Conectar banco"}
          </Button>
        </div>
      </div>

      {connections.length > 0 && (
        <p className="-mt-3 text-xs text-muted-foreground">
          &ldquo;Reprocessar dados do Open Finance&rdquo; rebusca o histórico
          completo na Pluggy e preenche dados que faltavam (forma de
          pagamento, contraparte, categoria) nas transações já importadas —
          não duplica nada e não precisa reconectar o banco.
        </p>
      )}

      {banner && (
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm",
            banner.kind === "ok"
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          )}
        >
          {banner.msg}
        </div>
      )}

      {connections.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Building2 className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              Nenhum banco conectado ainda. Clique em &ldquo;Conectar
              banco&rdquo; para começar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {connections.map((c) => (
            <ConnectionRow key={c.itemId} conn={c} onBanner={setBanner} />
          ))}
        </div>
      )}

      {showWidget && token && (
        <PluggyConnect
          connectToken={token}
          // Só o conector "MeuPluggy" (id 200): o proxy GRATUITO dos bancos
          // que você já conectou em meu.pluggy.ai. Evita o Nubank/Itaú
          // direto (que exige acesso pago a "dados reais").
          connectorIds={[200]}
          includeSandbox={false}
          onSuccess={onSuccess}
          onError={() =>
            setBanner({ kind: "err", msg: "Conexão cancelada ou com erro." })
          }
          onClose={() => setShowWidget(false)}
        />
      )}
    </div>
  );
}

function ConnectionRow({
  conn,
  onBanner,
}: {
  conn: ConnectionInfo;
  onBanner: (b: { kind: "ok" | "err"; msg: string }) => void;
}) {
  const [pending, startTransition] = useTransition();
  const meta = STATUS_META[conn.status] ?? {
    label: conn.status,
    variant: "secondary" as const,
    icon: Clock,
  };
  const Icon = meta.icon;

  // consentimento perto de vencer? (< 15 dias)
  let consentWarn = false;
  if (conn.consentExpiresAt) {
    const days =
      (new Date(conn.consentExpiresAt).getTime() - Date.now()) / 86_400_000;
    consentWarn = days < 15;
  }

  function doSync() {
    startTransition(async () => {
      const r = await syncNow(conn.itemId);
      onBanner(
        r.ok
          ? { kind: "ok", msg: `Sincronizado: ${r.imported ?? 0} transações.` }
          : { kind: "err", msg: r.error ?? "Erro ao sincronizar." }
      );
    });
  }
  function doDisconnect() {
    if (!confirm("Desconectar este banco? As transações já importadas ficam.")) return;
    startTransition(async () => {
      const r = await disconnectItem(conn.itemId);
      if (!r.ok) onBanner({ kind: "err", msg: r.error ?? "Erro ao desconectar." });
    });
  }

  return (
    <Card className={cn(pending && "opacity-60")}>
      <CardContent className="p-4">
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Building2 className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">
                {conn.connectorName ?? "Banco conectado"}
              </p>
              <Badge variant={meta.variant} className="gap-1">
                <Icon className="h-3 w-3" />
                {meta.label}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {conn.lastSyncedAt
                ? `Última sincronização: ${formatDate(conn.lastSyncedAt.slice(0, 10))}`
                : "Ainda não sincronizado"}
              {consentWarn && conn.consentExpiresAt && (
                <span className="ml-2 text-warning">
                  · reautorizar até {formatDate(conn.consentExpiresAt.slice(0, 10))}
                </span>
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={doSync}
            disabled={pending}
            title="Sincronizar agora"
          >
            <RefreshCw className={cn("h-4 w-4", pending && "animate-spin")} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={doDisconnect}
            disabled={pending}
            title="Desconectar"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {conn.banks.length > 0 && (
          <div className="mt-3 border-t pt-3 pl-14">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Bancos conectados:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {conn.banks.map((b) => (
                <Badge
                  key={`${b.name}-${b.kind}`}
                  variant="secondary"
                  className="font-normal"
                  title={b.name}
                >
                  {b.cleanName}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
