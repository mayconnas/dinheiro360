"use client";

import * as React from "react";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastVariant = "default" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

interface ShowToastOptions {
  variant?: ToastVariant;
  /** Duração em ms antes do fechamento automático. Padrão: 3200ms. */
  duration?: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  showToast: (message: string, options?: ShowToastOptions) => void;
  dismiss: (id: number) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION = 3200;

/**
 * Provider leve de toasts, sem dependências externas. Envolva a árvore
 * (ex: no topo de `transactions-view.tsx`) com `<ToastProvider>`, renderize
 * `<ToastHost />` uma vez em qualquer ponto dentro dela (normalmente perto
 * da raiz) e use `useToast()` em qualquer componente descendente para
 * disparar mensagens: `useToast().showToast("Categoria aplicada")`.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(0);
  const timers = React.useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const showToast = React.useCallback(
    (message: string, options?: ShowToastOptions) => {
      const id = nextId.current++;
      const variant = options?.variant ?? "default";
      const duration = options?.duration ?? DEFAULT_DURATION;
      setToasts((prev) => [...prev, { id, message, variant }]);
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  React.useEffect(() => {
    const timersMap = timers.current;
    return () => {
      timersMap.forEach((timer) => clearTimeout(timer));
      timersMap.clear();
    };
  }, []);

  const value = React.useMemo(
    () => ({ toasts, showToast, dismiss }),
    [toasts, showToast, dismiss]
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

/** Hook para disparar/consultar toasts a partir de qualquer componente descendente de `ToastProvider`. */
export function useToast(): { showToast: ToastContextValue["showToast"] } {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast deve ser usado dentro de <ToastProvider>");
  }
  return { showToast: ctx.showToast };
}

/**
 * Host visual dos toasts: renderiza a fila de mensagens no rodapé da tela
 * com fade/slide-in. Deve ser montado uma única vez dentro de
 * `<ToastProvider>` (posição fixa, então o local no JSX não importa).
 */
export function ToastHost() {
  const ctx = React.useContext(ToastContext);
  if (!ctx || ctx.toasts.length === 0) return null;

  const { toasts, dismiss } = ctx;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex max-w-md animate-in items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg fade-in slide-in-from-bottom-2 duration-200",
            t.variant === "success" && "border-success/40",
            t.variant === "error" && "border-destructive/40"
          )}
        >
          {t.variant === "success" && (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          )}
          {t.variant === "error" && (
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          )}
          {t.variant === "default" && (
            <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="flex-1">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded-sm text-muted-foreground/70 transition-colors hover:text-foreground"
            aria-label="Fechar notificação"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
