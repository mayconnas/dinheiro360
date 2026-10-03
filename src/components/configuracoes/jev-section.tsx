"use client";

// ─────────────────────────────────────────────────────────────
// Card "TypeSafe · Jev" da aba Inteligência (IA) de Configurações.
//
// Diferente dos provedores de chat (AiKeysSection), o Jev não responde
// no Gestor (IA) — ele é usado para CATEGORIZAR lançamentos na tela de
// Transações. Por isso não tem botão "Usar este provedor": a chave fica
// salva à parte e nunca ocupa o slot ativo do chat.
//
// Mesmo contrato de segurança: a api_key nunca volta pro client — este
// componente só recebe o status mascarado (getJevStatus) e envia texto
// novo pra saveJevCredential.
// ─────────────────────────────────────────────────────────────

import * as React from "react";
import { useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PlugZap,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  removeJevCredential,
  saveJevCredential,
  testJevConnection,
  updateJevModel,
} from "@/app/actions/jev";
import type { JevStatus } from "@/lib/ai/jev/config";

type Feedback = { kind: "success" | "error" | "warning"; message: string } | null;

export function JevSection({ status: initial }: { status: JevStatus }) {
  const [status, setStatus] = React.useState<JevStatus>(initial);
  const [apiKey, setApiKey] = React.useState("");
  const [model, setModel] = React.useState(initial.source === "user" ? initial.model ?? "" : "");
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [isSaving, startSaving] = useTransition();
  const [isTesting, startTesting] = useTransition();
  const [isRemoving, startRemoving] = useTransition();
  const busy = isSaving || isTesting || isRemoving;

  React.useEffect(() => {
    setStatus(initial);
  }, [initial]);

  function handleSave() {
    // Chave já salva + campo de chave vazio = só trocar o modelo.
    if (!apiKey.trim() && status.source === "user") {
      setFeedback(null);
      startSaving(async () => {
        const result = await updateJevModel(model.trim() || null);
        if (result.ok) {
          setStatus((prev) => ({ ...prev, model: model.trim() || null }));
          setFeedback({ kind: "success", message: "Modelo atualizado." });
        } else {
          setFeedback({ kind: "error", message: result.error ?? "Erro ao salvar o modelo." });
        }
      });
      return;
    }
    if (!apiKey.trim()) {
      setFeedback({ kind: "error", message: "Informe a chave de API da TypeSafe." });
      return;
    }
    setFeedback(null);
    startSaving(async () => {
      const result = await saveJevCredential({ apiKey, model: model.trim() || null });
      if (result.ok) {
        setStatus((prev) => ({
          ...prev,
          configured: true,
          source: "user",
          maskedKey: maskPreview(apiKey),
          model: model.trim() || null,
        }));
        setApiKey("");
        setFeedback(
          result.warning
            ? { kind: "warning", message: result.warning }
            : { kind: "success", message: "Chave validada e salva. O Jev já pode categorizar suas transações." }
        );
      } else {
        setFeedback({ kind: "error", message: result.error ?? "Erro ao salvar." });
      }
    });
  }

  function handleTest() {
    setFeedback(null);
    startTesting(async () => {
      const result = await testJevConnection();
      setFeedback(
        result.ok
          ? { kind: "success", message: result.message ?? "Conexão OK." }
          : { kind: "error", message: result.error ?? "Falha na conexão." }
      );
    });
  }

  function handleRemove() {
    setFeedback(null);
    startRemoving(async () => {
      const result = await removeJevCredential();
      if (result.ok) {
        setStatus((prev) => ({ ...prev, configured: false, source: null, maskedKey: null, model: null }));
        setApiKey("");
        setModel("");
        setFeedback({ kind: "success", message: "Chave da TypeSafe removida." });
      } else {
        setFeedback({ kind: "error", message: result.error ?? "Erro ao remover." });
      }
    });
  }

  return (
    <Card className={cn(status.configured && "border-primary/60")}>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            TypeSafe · Jev
          </CardTitle>
          {status.configured ? (
            <Badge variant="success">Conectado</Badge>
          ) : (
            <Badge variant="secondary">Categorização</Badge>
          )}
        </div>
        <CardDescription>
          O Jev é um modelo de decisão da TypeSafe. Na tela de Transações, o
          botão <strong>Categorizar com Jev</strong> envia cada lançamento com
          as suas categorias (de receita para entradas, de despesa para
          saídas) e o Jev devolve a melhor categoria com o nível de confiança
          — você revisa antes de aplicar.
        </CardDescription>
        <p className="text-sm text-muted-foreground">
          {status.source === "user" ? (
            <>
              Configurada — chave{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{status.maskedKey}</code>
              {" "}· modelo{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {status.model || status.defaultModel}
              </code>
            </>
          ) : status.source === "env" ? (
            <>
              Usando a chave padrão do servidor (<code className="rounded bg-muted px-1 py-0.5 text-xs">TYPESAFE_API_KEY</code>)
              {" "}· modelo{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{status.defaultModel}</code>. Salve uma
              chave própria abaixo para usá-la no lugar.
            </>
          ) : (
            "Não configurada."
          )}
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
          <div className="space-y-1.5">
            <Label htmlFor="jev-api-key">Chave de API</Label>
            <Input
              id="jev-api-key"
              type="password"
              autoComplete="off"
              placeholder={
                status.source === "user"
                  ? "Substituir chave (vazio = só trocar o modelo)"
                  : "Cole sua chave da TypeSafe"
              }
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="jev-model">Modelo (opcional)</Label>
            <Input
              id="jev-model"
              type="text"
              placeholder={status.defaultModel}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
        <a
          href="https://console.typesafe.ai/keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
        >
          Criar uma chave em console.typesafe.ai
          <ExternalLink className="h-3 w-3" />
        </a>

        {feedback && (
          <p
            role="status"
            className={cn(
              "flex items-start gap-1.5 text-sm",
              feedback.kind === "success" && "text-success",
              feedback.kind === "warning" && "text-warning",
              feedback.kind === "error" && "text-destructive"
            )}
          >
            {feedback.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            {feedback.message}
          </p>
        )}
      </CardContent>

      <CardFooter className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={handleSave} disabled={busy}>
          {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleTest}
          disabled={busy || !status.configured}
        >
          {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          Testar conexão
        </Button>
        {status.source === "user" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={handleRemove}
            disabled={busy}
          >
            {isRemoving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Remover
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

/** Prévia local (mesma regra de mascaramento do servidor) — o valor de referência vem do próximo getJevStatus(). */
function maskPreview(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length || 4);
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}
