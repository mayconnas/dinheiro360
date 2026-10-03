"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Users,
  Search,
  Building2,
  Store,
  User,
  HelpCircle,
  History,
  Loader2,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownLeft,
  Tag,
} from "lucide-react";
import {
  backfillPayees,
  getTransactionsByPayee,
  setPayeeCategory,
  type PayeeListItem,
  type PayeeTransactionItem,
} from "@/app/actions/payees";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBRL, formatDate, cn } from "@/lib/utils";
import type { PayeeKind } from "@/lib/engine/payee";
import type { Category } from "@/lib/types";
import {
  ToastProvider,
  ToastHost,
  useToast,
} from "@/components/transacoes/use-toast";

const KIND_META: Record<
  PayeeKind,
  { label: string; icon: typeof User; badgeClass: string }
> = {
  pessoa: {
    label: "Pessoa",
    icon: User,
    badgeClass: "border-transparent bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  },
  empresa: {
    label: "Empresa",
    icon: Building2,
    badgeClass:
      "border-transparent bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  },
  estabelecimento: {
    label: "Estabelecimento",
    icon: Store,
    badgeClass:
      "border-transparent bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  },
  desconhecido: {
    label: "A classificar",
    icon: HelpCircle,
    badgeClass: "border-transparent bg-muted text-muted-foreground",
  },
};

export function PayeesView({
  payees,
  categories,
}: {
  payees: PayeeListItem[];
  categories: Category[];
}) {
  return (
    <ToastProvider>
      <PayeesViewInner payees={payees} categories={categories} />
      <ToastHost />
    </ToastProvider>
  );
}

function PayeesViewInner({
  payees,
  categories,
}: {
  payees: PayeeListItem[];
  categories: Category[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<PayeeListItem | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return payees;
    return payees.filter((p) => p.name.toLowerCase().includes(q));
  }, [payees, query]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Users className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Destinatários</h1>
          <p className="text-muted-foreground">
            Pessoas e estabelecimentos com quem você paga ou recebe.
          </p>
        </div>
      </div>

      <BackfillCard />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar destinatário pelo nome…"
          className="pl-9"
        />
      </div>

      {payees.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Users className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              Nenhum destinatário cadastrado ainda. Use o botão acima para
              cadastrar a partir do histórico, ou registre uma nova
              transação — o destinatário é criado automaticamente.
            </p>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum destinatário encontrado para &quot;{query}&quot;.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {filtered.length}{" "}
            {filtered.length === 1
              ? "destinatário"
              : "destinatários"}{" "}
            · ordenado por mais transações
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((p) => (
              <PayeeCard
                key={p.id}
                payee={p}
                categories={categories}
                onOpen={() => setSelected(p)}
              />
            ))}
          </div>
        </>
      )}

      <PayeeDetailDialog
        payee={selected}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

function PayeeCard({
  payee,
  categories,
  onOpen,
}: {
  payee: PayeeListItem;
  categories: Category[];
  onOpen: () => void;
}) {
  const meta = KIND_META[payee.kind];
  const Icon = meta.icon;
  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onOpen();
      }}
      className="cursor-pointer transition-colors hover:bg-accent/50"
    >
      <CardContent className="space-y-3 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold">{payee.name}</p>
            {payee.lastSeen && (
              <p className="text-xs text-muted-foreground">
                última vez em {formatDate(payee.lastSeen)}
              </p>
            )}
          </div>
          <Badge className={cn("shrink-0 gap-1", meta.badgeClass)}>
            <Icon className="h-3 w-3" />
            {meta.label}
          </Badge>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {payee.txCount} {payee.txCount === 1 ? "transação" : "transações"}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-lg bg-destructive/10 px-3 py-2">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowUpRight className="h-3 w-3" />
              Pago
            </p>
            <p className="font-semibold tabular text-destructive">
              {formatBRL(payee.totalPaid)}
            </p>
          </div>
          <div className="rounded-lg bg-success/10 px-3 py-2">
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowDownLeft className="h-3 w-3" />
              Recebido
            </p>
            <p className="font-semibold tabular text-success">
              {formatBRL(payee.totalReceived)}
            </p>
          </div>
        </div>

        {/* Categoria padrão: para na propagação do onClick do card
            (não deve abrir o dialog de detalhe ao interagir com o
            seletor). Ver setPayeeCategory em src/app/actions/payees.ts. */}
        <div onClick={(e) => e.stopPropagation()}>
          <PayeeCategorySelect payee={payee} categories={categories} />
        </div>
      </CardContent>
    </Card>
  );
}

function PayeeCategorySelect({
  payee,
  categories,
}: {
  payee: PayeeListItem;
  categories: Category[];
}) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(payee.defaultCategoryId ?? "");

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  function handleChange(categoryId: string) {
    setValue(categoryId);
    startTransition(async () => {
      const result = await setPayeeCategory(payee.id, categoryId);
      if (result.ok) {
        const cat = catById.get(categoryId);
        showToast(
          `${result.appliedCount} lançamento${result.appliedCount === 1 ? "" : "s"} de ${payee.name} categorizado${result.appliedCount === 1 ? "" : "s"} como ${cat?.name ?? "categoria escolhida"}.`,
          { variant: "success" }
        );
      } else {
        setValue(payee.defaultCategoryId ?? "");
        showToast(result.error ?? "Erro ao amarrar categoria.", { variant: "error" });
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <Select value={value || undefined} onValueChange={handleChange} disabled={pending}>
        <SelectTrigger className="h-8 flex-1 text-xs">
          <SelectValue placeholder="Categoria padrão…" />
        </SelectTrigger>
        <SelectContent>
          {categories.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: c.color }}
                />
                {c.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function PayeeDetailDialog({
  payee,
  onClose,
}: {
  payee: PayeeListItem | null;
  onClose: () => void;
}) {
  const [txs, setTxs] = useState<PayeeTransactionItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const open = payee !== null;

  if (open && payee && loadedFor !== payee.id && !loading) {
    setLoading(true);
    getTransactionsByPayee(payee.id)
      .then((rows) => {
        setTxs(rows);
        setLoadedFor(payee.id);
      })
      .finally(() => setLoading(false));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setTxs(null);
          setLoadedFor(null);
        }
      }}
    >
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{payee?.name}</DialogTitle>
        </DialogHeader>
        {loading && !txs ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : txs && txs.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma transação vinculada.
          </p>
        ) : (
          <div className="space-y-2">
            {txs?.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate">{t.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(t.date)}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 font-semibold tabular",
                    t.type === "entrada" ? "text-success" : "text-destructive"
                  )}
                >
                  {t.type === "entrada" ? "+" : "-"}
                  {formatBRL(Math.abs(t.amount))}
                </span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type BackfillState =
  | { status: "idle" }
  | { status: "running" }
  | {
      status: "done";
      payeesCreated: number;
      txLinked: number;
      txSkipped: number;
    }
  | { status: "error"; message: string };

function BackfillCard() {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<BackfillState>({ status: "idle" });

  function run() {
    setState({ status: "running" });
    startTransition(async () => {
      const result = await backfillPayees();
      if (result.ok) {
        setState({
          status: "done",
          payeesCreated: result.payeesCreated,
          txLinked: result.txLinked,
          txSkipped: result.txSkipped,
        });
      } else {
        setState({
          status: "error",
          message: result.error ?? "Erro ao cadastrar destinatários.",
        });
      }
    });
  }

  const busy = pending || state.status === "running";

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-muted-foreground" />
          Cadastrar destinatários do histórico
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Lê as transações já importadas e cria (ou vincula) o destinatário
          de cada uma automaticamente, a partir do nome no extrato. Roda
          uma vez sobre o histórico — é seguro clicar de novo depois: só
          processa o que ainda não tem destinatário vinculado, então nada
          é duplicado. Novas transações (manuais, CSV ou Open Finance) já
          criam o destinatário sozinhas, sem precisar disso.
        </p>

        <Button onClick={run} disabled={busy} className="gap-2">
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processando…
            </>
          ) : (
            <>
              <Users className="h-4 w-4" />
              Cadastrar destinatários do histórico
            </>
          )}
        </Button>

        {state.status === "done" && (
          <div className="flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {state.payeesCreated}{" "}
              {state.payeesCreated === 1
                ? "destinatário cadastrado"
                : "destinatários cadastrados"}
              , {state.txLinked}{" "}
              {state.txLinked === 1
                ? "transação vinculada"
                : "transações vinculadas"}
              {state.txSkipped > 0 &&
                ` (${state.txSkipped} sem nome reconhecível, ignoradas)`}
              .
            </p>
          </div>
        )}

        {state.status === "error" && (
          <p className="text-sm text-destructive">{state.message}</p>
        )}
      </CardContent>
    </Card>
  );
}
