"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Sparkles, Send, Stethoscope, User } from "lucide-react";
import { getDiagnosis, askAdvisor } from "@/app/actions/advisor";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Onde está vazando meu dinheiro?",
  "Posso parcelar uma compra de R$ 4.000?",
  "Como acelerar minha reserva de emergência?",
  "Quais assinaturas eu deveria cancelar?",
];

export function AdvisorChat({ hasData }: { hasData: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  function runDiagnosis() {
    setError(null);
    setMessages((m) => [
      ...m,
      { role: "user", content: "Faça o diagnóstico do meu mês." },
    ]);
    startTransition(async () => {
      const res = await getDiagnosis();
      if (res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: res.text }]);
      } else {
        setError(res.error ?? "Erro ao consultar o gestor.");
      }
    });
  }

  function send(question: string) {
    const q = question.trim();
    if (!q || pending) return;
    setError(null);
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    startTransition(async () => {
      const res = await askAdvisor(q, history);
      if (res.ok) {
        setMessages((m) => [...m, { role: "assistant", content: res.text }]);
      } else {
        setError(res.error ?? "Erro ao consultar o gestor.");
      }
    });
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-primary" />
            Seu gestor
          </h1>
          <p className="text-muted-foreground">
            Ele lê seus números e aconselha. Nunca inventa valores.
          </p>
        </div>
        <Button variant="outline" onClick={runDiagnosis} disabled={pending}>
          <Stethoscope className="h-4 w-4" />
          Diagnóstico
        </Button>
      </div>

      <Card className="flex flex-1 flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <div>
                <p className="font-medium">Converse com o seu gestor</p>
                <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                  {hasData
                    ? "Peça um diagnóstico ou faça uma pergunta. Ele responde com os seus próprios números."
                    : "Registre algumas transações primeiro — assim o gestor terá números para analisar."}
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    disabled={pending}
                    className="rounded-full border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageBubble key={i} message={m} />
          ))}

          {pending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 animate-pulse text-primary" />
              O gestor está analisando…
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="border-t p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-end gap-2"
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder="Pergunte algo… (ex: posso parcelar isso?)"
              className="max-h-32 min-h-[44px] resize-none"
              rows={1}
            />
            <Button type="submit" size="icon" disabled={pending || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          isUser ? "bg-secondary" : "bg-primary text-primary-foreground"
        )}
      >
        {isUser ? (
          <User className="h-4 w-4" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <Markdown text={message.content} />
        )}
      </div>
    </div>
  );
}

/** Renderizador leve de markdown (títulos, listas, negrito). */
function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  function flushList(key: string) {
    if (listItems.length > 0) {
      elements.push(
        <ul key={key} className="my-1 ml-4 list-disc space-y-1">
          {listItems.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  }

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) {
      flushList(`ul-${idx}`);
      elements.push(
        <h3 key={idx} className="mb-1 mt-3 font-semibold first:mt-0">
          {trimmed.slice(3)}
        </h3>
      );
    } else if (trimmed.startsWith("# ")) {
      flushList(`ul-${idx}`);
      elements.push(
        <h3 key={idx} className="mb-1 mt-3 font-semibold first:mt-0">
          {trimmed.slice(2)}
        </h3>
      );
    } else if (/^[-*]\s/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*]\s/, ""));
    } else if (/^\d+\.\s/.test(trimmed)) {
      listItems.push(trimmed.replace(/^\d+\.\s/, ""));
    } else if (trimmed === "") {
      flushList(`ul-${idx}`);
    } else {
      flushList(`ul-${idx}`);
      elements.push(
        <p key={idx} className="my-1">
          {renderInline(trimmed)}
        </p>
      );
    }
  });
  flushList("ul-final");

  return <div className="leading-relaxed">{elements}</div>;
}

function renderInline(text: string): React.ReactNode {
  // negrito **...**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    return <span key={i}>{p}</span>;
  });
}
