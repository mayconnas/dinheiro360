"use client";

import { useState, useTransition } from "react";
import { Plus, Check, Wallet } from "lucide-react";
import { updateProfile, addAccount } from "@/app/actions/config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatBRL } from "@/lib/utils";
import type { Account, AccountKind, EmploymentType, Profile } from "@/lib/types";

const EMPLOYMENT_LABELS: Record<EmploymentType, string> = {
  clt: "CLT",
  autonomo: "Autônomo",
  misto: "Misto",
};

const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  corrente: "Conta Corrente",
  poupanca: "Poupança",
  carteira: "Carteira",
  investimento: "Investimento",
  cartao: "Cartão",
};

export function ProfileView({
  profile,
  accounts,
}: {
  profile: Profile;
  accounts: Account[];
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Perfil</h1>
        <p className="text-muted-foreground">
          Ajuste seus dados e as contas que compõem o seu dinheiro.
        </p>
      </div>

      <ProfileForm profile={profile} />
      <AccountsCard accounts={accounts} />
    </div>
  );
}

function ProfileForm({ profile }: { profile: Profile }) {
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [monthlyIncome, setMonthlyIncome] = useState(
    profile.monthlyIncome.toString()
  );
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    profile.employmentType
  );
  const [dependents, setDependents] = useState(profile.dependents.toString());

  function save() {
    setError(null);
    setSaved(false);
    const income = parseFloat(monthlyIncome.replace(",", "."));
    if (isNaN(income) || income < 0) {
      setError("Informe uma renda mensal válida.");
      return;
    }
    const deps = parseInt(dependents, 10);
    if (isNaN(deps) || deps < 0) {
      setError("Informe um número de dependentes válido.");
      return;
    }
    startTransition(async () => {
      try {
        await updateProfile({
          displayName: displayName.trim(),
          monthlyIncome: income,
          employmentType,
          dependents: deps,
        });
        setSaved(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao salvar.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Seus dados</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="displayName">Nome</Label>
          <Input
            id="displayName"
            value={displayName}
            onChange={(e) => {
              setDisplayName(e.target.value);
              setSaved(false);
            }}
            placeholder="Como quer ser chamado?"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="monthlyIncome">Renda mensal (R$)</Label>
            <Input
              id="monthlyIncome"
              value={monthlyIncome}
              onChange={(e) => {
                setMonthlyIncome(e.target.value);
                setSaved(false);
              }}
              inputMode="decimal"
              placeholder="0,00"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="dependents">Dependentes</Label>
            <Input
              id="dependents"
              value={dependents}
              onChange={(e) => {
                setDependents(e.target.value);
                setSaved(false);
              }}
              inputMode="numeric"
              placeholder="0"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="employmentType">Vínculo</Label>
          <Select
            value={employmentType}
            onValueChange={(v) => {
              setEmploymentType(v as EmploymentType);
              setSaved(false);
            }}
          >
            <SelectTrigger id="employmentType">
              <SelectValue placeholder="Selecionar vínculo" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(EMPLOYMENT_LABELS) as EmploymentType[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {EMPLOYMENT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </Button>
          {saved && !pending && (
            <span className="flex items-center gap-1 text-sm text-success">
              <Check className="h-4 w-4" />
              salvo
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function AccountsCard({ accounts }: { accounts: Account[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Contas</CardTitle>
        <NewAccountDialog />
      </CardHeader>
      <CardContent>
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Wallet className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">
              Nenhuma conta ainda. Adicione a primeira para acompanhar seus saldos.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <p className="font-medium">{acc.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ACCOUNT_KIND_LABELS[acc.kind]}
                  </p>
                </div>
                <span className="font-semibold tabular">
                  {formatBRL(acc.openingBalance)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function NewAccountDialog() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<AccountKind>("corrente");

  function onSubmit(formData: FormData) {
    setError(null);
    const name = String(formData.get("name")).trim();
    if (!name) {
      setError("Informe o nome da conta.");
      return;
    }
    const openingBalance = parseFloat(
      String(formData.get("openingBalance") || "0").replace(",", ".")
    );
    startTransition(async () => {
      try {
        await addAccount({
          name,
          kind,
          openingBalance: isNaN(openingBalance) ? 0 : openingBalance,
        });
        setOpen(false);
        setKind("corrente");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao salvar.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" />
          Nova conta
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova conta</DialogTitle>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              name="name"
              placeholder="Ex: Nubank, Carteira, Corretora…"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kind">Tipo</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as AccountKind)}
            >
              <SelectTrigger id="kind">
                <SelectValue placeholder="Selecionar tipo" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ACCOUNT_KIND_LABELS) as AccountKind[]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {ACCOUNT_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="openingBalance">Saldo inicial (R$)</Label>
            <Input
              id="openingBalance"
              name="openingBalance"
              inputMode="decimal"
              placeholder="0"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? "Salvando…" : "Adicionar conta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
