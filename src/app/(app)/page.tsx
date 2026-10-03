import Link from "next/link";
import { Sparkles } from "lucide-react";
import { loadDashboard } from "@/lib/data/dashboard";
import { Button } from "@/components/ui/button";
import { MonthSelector } from "@/components/painel/month-selector";
import { PatrimonioResumo } from "@/components/painel/patrimonio-resumo";
import { PatrimonioContas } from "@/components/painel/patrimonio-contas";
import { PatrimonioCartoes } from "@/components/painel/patrimonio-cartoes";
import { PatrimonioChequeEspecial } from "@/components/painel/patrimonio-cheque-especial";
import { PatrimonioInvestimentos } from "@/components/painel/patrimonio-investimentos";
import { KpiCards } from "@/components/painel/kpi-cards";
import { HealthGauge } from "@/components/painel/health-gauge";
import { ProjectionCard } from "@/components/painel/projection-card";
import { ChartRevExp } from "@/components/painel/chart-rev-exp";
import { ChartCategories } from "@/components/painel/chart-categories";
import { ChartNetWorth } from "@/components/painel/chart-networth";
import { ChartCashflow } from "@/components/painel/chart-cashflow";
import { BudgetList } from "@/components/painel/budget-list";
import { GoalsList } from "@/components/painel/goals-list";
import { RecentTx } from "@/components/painel/recent-tx";
import { TopSpending } from "@/components/painel/top-spending";
import { InsightsPanel } from "@/components/painel/insights-panel";

/** Rótulo de seção (eyebrow), como no mockup. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 mt-7 flex items-center gap-2.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground first:mt-0">
      <span>{children}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/**
 * Nota curta abaixo de um Eyebrow, explicando o que a seção mostra (usada
 * para deixar clara a diferença entre as duas visões de despesa — Fluxo de
 * Caixa x Controle de Gastos — ver src/lib/engine/transfers.ts
 * classifyForViews).
 */
function SectionNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="-mt-2 mb-3.5 max-w-[70ch] text-[12.5px] font-medium leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/** Valida "AAAA-MM" (mês 01-12). Formato de query param só. */
function isValidMonthParam(value: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return false;
  const mm = Number(match[2]);
  return mm >= 1 && mm <= 12;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const rawMes = Array.isArray(params.mes) ? params.mes[0] : params.mes;
  const requestedMonth = rawMes && isValidMonthParam(rawMes) ? rawMes : undefined;

  const d = await loadDashboard(requestedMonth);

  return (
    <div className="mx-auto max-w-[1320px] space-y-1">
      {/* Topbar */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-[27px]">
            Painel
          </h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
            <p className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
              {d.accounts.length} contas
            </p>
            <MonthSelector month={d.month} currentMonth={d.currentMonth} />
            {d.isClosedMonth && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Mês fechado
              </span>
            )}
          </div>
        </div>
        <Button asChild>
          <Link href="/gestor">
            <Sparkles className="h-4 w-4" />
            Falar com o gestor
          </Link>
        </Button>
      </div>

      {/* Visão 360 — o que tem vs o que deve, saldo real das contas conectadas */}
      <Eyebrow>Visão 360 — o que você tem e o que deve</Eyebrow>
      <PatrimonioResumo data={d.patrimonio} />

      <p className="mb-2 mt-4 text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
        O que você tem
      </p>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <PatrimonioContas data={d.patrimonio} />
        <PatrimonioInvestimentos data={d.patrimonio} />
      </div>

      <p className="mb-2 mt-3.5 text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
        O que você deve
      </p>
      <div
        className={`grid gap-3.5 ${d.patrimonio.overdraft.total > 0 ? "lg:grid-cols-2" : "lg:grid-cols-1"}`}
      >
        <PatrimonioCartoes data={d.patrimonio} />
        {d.patrimonio.overdraft.total > 0 && (
          <PatrimonioChequeEspecial data={d.patrimonio} />
        )}
      </div>

      {/* Fluxo de Caixa — dinheiro líquido real que entrou/saiu das contas */}
      <Eyebrow>Fluxo de Caixa</Eyebrow>
      <SectionNote>
        Dinheiro que realmente entrou e saiu das suas contas: recebimentos e
        salário de um lado; Pix/débito a terceiros e{" "}
        <strong className="font-bold text-foreground">pagamento de fatura</strong>{" "}
        do outro. Não inclui compras no cartão (o dinheiro só sai da conta
        quando a fatura é paga) nem transferências entre contas próprias.
      </SectionNote>
      <KpiCards
        totals={d.cashflow}
        netBalance={d.netBalance}
        cashBalance={d.cashBalance}
        history={d.history}
      />

      {/* Saúde financeira */}
      <Eyebrow>Placar de saúde financeira</Eyebrow>
      <HealthGauge indicators={d.indicators} />

      {/* Projeção / resultado do mês */}
      <Eyebrow>
        {d.isClosedMonth ? "Resultado do mês (fechado)" : "Projeção de fechamento"}
      </Eyebrow>
      <ProjectionCard projection={d.projection} isClosedMonth={d.isClosedMonth} />

      {/* Gráficos: evolução do fluxo de caixa (mesma visão das duas seções acima) */}
      <Eyebrow>Evolução do fluxo de caixa</Eyebrow>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <ChartRevExp history={d.history} />
        <ChartNetWorth history={d.history} netBalance={d.netBalance} />
      </div>
      <div className="mt-3.5 grid gap-3.5">
        <ChartCashflow
          transactions={d.transactions}
          projection={d.projection}
          month={d.month}
          today={d.today}
        />
      </div>

      {/* Controle de Gastos — quanto e onde o dinheiro foi gasto, por categoria */}
      <Eyebrow>Controle de Gastos</Eyebrow>
      <SectionNote>
        Onde o seu dinheiro foi gasto, por categoria: inclui compras à
        vista/Pix e{" "}
        <strong className="font-bold text-foreground">
          compras no cartão (já categorizadas)
        </strong>
        . A fatura do cartão aparece no Fluxo de Caixa, não aqui — as
        compras que a formaram já foram contadas uma a uma; somar a fatura
        de novo dobraria o gasto.
      </SectionNote>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <ChartCategories data={d.spending.byCategory} total={d.spending.total} />
        <TopSpending data={d.spending.byCategory} />
      </div>

      {/* Orçamento e metas */}
      <Eyebrow>Orçamento e objetivos</Eyebrow>
      <div className="grid gap-3.5 lg:grid-cols-2">
        <BudgetList budgetLines={d.budgetLines} />
        <GoalsList goals={d.goals} />
      </div>

      {/* Movimentações */}
      <Eyebrow>Movimentações</Eyebrow>
      <div className="grid gap-3.5">
        <RecentTx transactions={d.transactions} categories={d.categories} />
      </div>

      {/* Insights */}
      <Eyebrow>O que o gestor observou</Eyebrow>
      <InsightsPanel flags={d.flags} indicators={d.indicators} />
    </div>
  );
}
