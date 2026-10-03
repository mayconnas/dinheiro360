"use client";

// ─────────────────────────────────────────────────────────────
// Aba "Inteligência (IA)" de Configurações. Um card por provedor
// suportado (Anthropic, OpenAI, Gemini, DeepSeek): status
// (Configurada/Não configurada + chave mascarada), botão para tornar
// esse provedor o ativo, formulário de chave/modelo + Salvar, e
// remover.
//
// A api_key NUNCA transita de volta pro client: este componente só
// recebe o retorno de getAICredentialsStatus() (mascarado) e envia
// texto novo pra saveAICredential() — nunca lê a chave de volta.
//
// Sem dependência de <ToastProvider> (não está montado nesta árvore):
// feedback é inline, por card, via useState + useTransition.
// ─────────────────────────────────────────────────────────────

import * as React from "react";
import { useTransition } from "react";
import { CheckCircle2, AlertCircle, KeyRound, Loader2, Trash2 } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  saveAICredential,
  setActiveProvider,
  removeAICredential,
  type AICredentialStatus,
} from "@/app/actions/ai-credentials";
import { PROVIDER_LABELS, DEFAULT_MODELS, type AiProvider } from "@/lib/ai/provider-meta";

export interface AiKeysSectionProps {
  status: AICredentialStatus[];
}

type Feedback = { kind: "success" | "error"; message: string } | null;

export function AiKeysSection({ status }: AiKeysSectionProps) {
  // Estado local espelha o servidor pra a UI reagir na hora (otimista o
  // suficiente: revalidatePath já cuida da consistência no próximo load).
  const [rows, setRows] = React.useState<AICredentialStatus[]>(status);

  React.useEffect(() => {
    setRows(status);
  }, [status]);

  function patchRow(provider: AiProvider, patch: Partial<AICredentialStatus>) {
    setRows((prev) =>
      prev.map((r) => (r.provider === provider ? { ...r, ...patch } : r))
    );
  }

  function markActiveLocally(provider: AiProvider) {
    setRows((prev) =>
      prev.map((r) => ({ ...r, active: r.provider === provider }))
    );
  }

  const activeProvider = rows.find((r) => r.active)?.provider ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p>
          Cadastre sua própria chave de API para um ou mais provedores de IA.
          A chave fica salva no servidor e <strong>nunca é reexibida</strong> —
          depois de salva, você só vê os últimos caracteres para
          conferência.
        </p>
        <p className="mt-2">
          O provedor marcado como <strong>ativo</strong> é quem responde no
          Gestor (IA) — diagnóstico e chat do consultor. Sem nenhuma
          credencial ativa, o app tenta usar a chave padrão do servidor
          (Anthropic), se configurada.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((row) => (
          <ProviderCard
            key={row.provider}
            row={row}
            isOnlyActive={activeProvider === row.provider}
            onSaved={(patch) => patchRow(row.provider, patch)}
            onActivated={() => markActiveLocally(row.provider)}
            onRemoved={() =>
              patchRow(row.provider, {
                configured: false,
                active: false,
                model: null,
                maskedKey: null,
              })
            }
          />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({
  row,
  isOnlyActive,
  onSaved,
  onActivated,
  onRemoved,
}: {
  row: AICredentialStatus;
  isOnlyActive: boolean;
  onSaved: (patch: Partial<AICredentialStatus>) => void;
  onActivated: () => void;
  onRemoved: () => void;
}) {
  const [apiKey, setApiKey] = React.useState("");
  const [model, setModel] = React.useState(row.model ?? "");
  const [feedback, setFeedback] = React.useState<Feedback>(null);
  const [isSaving, startSaving] = useTransition();
  const [isActivating, startActivating] = useTransition();
  const [isRemoving, startRemoving] = useTransition();

  const label = PROVIDER_LABELS[row.provider];
  const defaultModel = DEFAULT_MODELS[row.provider];
  const busy = isSaving || isActivating || isRemoving;

  function handleSave() {
    if (!apiKey.trim()) {
      setFeedback({ kind: "error", message: "Informe a chave de API." });
      return;
    }
    setFeedback(null);
    startSaving(async () => {
      const result = await saveAICredential({
        provider: row.provider,
        apiKey,
        model: model.trim() || null,
      });
      if (result.ok) {
        setApiKey("");
        setFeedback({ kind: "success", message: "Chave salva com sucesso." });
        onSaved({
          configured: true,
          model: model.trim() || null,
          maskedKey: maskPreview(apiKey),
        });
      } else {
        setFeedback({ kind: "error", message: result.error ?? "Erro ao salvar." });
      }
    });
  }

  function handleActivate() {
    setFeedback(null);
    startActivating(async () => {
      const result = await setActiveProvider(row.provider);
      if (result.ok) {
        setFeedback({ kind: "success", message: `${label} agora é o provedor ativo.` });
        onActivated();
      } else {
        setFeedback({ kind: "error", message: result.error ?? "Erro ao ativar." });
      }
    });
  }

  function handleRemove() {
    setFeedback(null);
    startRemoving(async () => {
      const result = await removeAICredential(row.provider);
      if (result.ok) {
        setFeedback({ kind: "success", message: "Chave removida." });
        setApiKey("");
        setModel("");
        onRemoved();
      } else {
        setFeedback({ kind: "error", message: result.error ?? "Erro ao remover." });
      }
    });
  }

  return (
    <Card className={cn(row.active && "border-primary ring-1 ring-primary/30")}>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            {label}
          </CardTitle>
          {row.active && <Badge variant="success">Ativo</Badge>}
        </div>
        <CardDescription>
          {row.configured ? (
            <>
              Configurada — chave{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                {row.maskedKey}
              </code>
              {row.model && (
                <>
                  {" "}
                  · modelo <code className="rounded bg-muted px-1 py-0.5 text-xs">{row.model}</code>
                </>
              )}
            </>
          ) : (
            "Não configurada"
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`apiKey-${row.provider}`}>Chave de API</Label>
          <Input
            id={`apiKey-${row.provider}`}
            type="password"
            autoComplete="off"
            placeholder={row.configured ? "Substituir chave atual" : "Cole sua chave de API"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`model-${row.provider}`}>Modelo (opcional)</Label>
          <Input
            id={`model-${row.provider}`}
            type="text"
            placeholder={defaultModel}
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={busy}
          />
        </div>

        {feedback && (
          <p
            className={cn(
              "flex items-center gap-1.5 text-sm",
              feedback.kind === "success" ? "text-success" : "text-destructive"
            )}
          >
            {feedback.kind === "success" ? (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0" />
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
          variant={row.active ? "secondary" : "outline"}
          onClick={handleActivate}
          disabled={busy || !row.configured || isOnlyActive}
        >
          {isActivating && <Loader2 className="h-4 w-4 animate-spin" />}
          {row.active ? "Provedor ativo" : "Usar este provedor"}
        </Button>

        {row.configured && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={handleRemove}
            disabled={busy}
          >
            {isRemoving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Remover
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

/** Prévia local imediata (mesma regra de mascaramento do servidor) — só pra feedback visual instantâneo; o valor real de referência sempre vem do próximo getAICredentialsStatus(). */
function maskPreview(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length || 4);
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}
