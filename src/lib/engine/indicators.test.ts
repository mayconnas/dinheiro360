import { describe, expect, it } from "vitest";
import {
  buildManualAdjustments,
  cardDebt,
  computeIndicators,
  criticalIndicator,
  investmentBalance,
  netBalance,
  overdraftUsage,
  realCashBalance,
  realNetWorth,
  trendFromSeries,
  type Indicator,
} from "./indicators";
import { makeAccount, makeTransaction as tx } from "../../../test/fixtures";

describe("patrimônio real (saldos reportados pela Pluggy)", () => {
  // Exemplo real documentado no código (2026-07)
  const accounts = [
    makeAccount({ id: "mp", name: "Mercado Pago", accountType: "bank", currentBalance: 185.04 }),
    makeAccount({ id: "brad1", name: "Bradesco", accountType: "bank", currentBalance: 6.84 }),
    makeAccount({ id: "brad2", name: "Bradesco", accountType: "bank", currentBalance: -27.15 }),
    makeAccount({ id: "nubank", name: "Nubank", kind: "cartao", accountType: "credit", currentBalance: 2382.48 }),
  ];

  it("caixa soma só saldos bancários positivos", () => {
    expect(realCashBalance(accounts)).toBeCloseTo(191.88);
  });

  it("cheque especial em uso é o módulo dos saldos bancários negativos", () => {
    expect(overdraftUsage(accounts)).toBeCloseTo(27.15);
  });

  it("dívida do cartão vem das contas de crédito", () => {
    expect(cardDebt(accounts)).toBeCloseTo(2382.48);
  });

  it("patrimônio líquido = caixa + investimentos − cartão − cheque especial, podendo ficar negativo", () => {
    expect(realNetWorth(accounts)).toBeCloseTo(-2217.75);
  });

  it("sem accountType, deriva o bucket do kind legado", () => {
    const legacy = [
      makeAccount({ kind: "cartao", currentBalance: 500 }),
      makeAccount({ kind: "investimento", currentBalance: 10_000 }),
      makeAccount({ kind: "poupanca", currentBalance: 2_000 }),
    ];
    expect(cardDebt(legacy)).toBe(500);
    expect(investmentBalance(legacy)).toBe(10_000);
    expect(realCashBalance(legacy)).toBe(2_000);
    expect(realNetWorth(legacy)).toBe(11_500);
  });

  it("conta sem saldo da Pluggy usa saldo inicial + ajuste dos lançamentos manuais", () => {
    const carteira = makeAccount({ id: "carteira", kind: "carteira", openingBalance: 200, currentBalance: null });
    const adj = buildManualAdjustments([
      tx({ accountId: "carteira", origin: "manual", type: "entrada", amount: 100 }),
      tx({ accountId: "carteira", origin: "manual", type: "saida", amount: 30 }),
    ]);
    expect(realCashBalance([carteira], adj)).toBe(270);
  });

  it("conta com saldo da Pluggy ignora o ajuste manual (evita contar duas vezes)", () => {
    const corrente = makeAccount({ id: "cc", accountType: "bank", openingBalance: 999, currentBalance: 1000 });
    const adj = new Map([["cc", 500]]);
    expect(realCashBalance([corrente], adj)).toBe(1000);
  });

  it("buildManualAdjustments ignora transações não manuais ou sem conta", () => {
    const adj = buildManualAdjustments([
      tx({ accountId: "a", origin: "manual", type: "saida", amount: 40 }),
      tx({ accountId: "a", origin: "open_finance", type: "saida", amount: 1000 }),
      tx({ accountId: null, origin: "manual", type: "entrada", amount: 50 }),
    ]);
    expect(Object.fromEntries(adj)).toEqual({ a: -40 });
  });

  it("netBalance (legado) soma saldo inicial + todo o histórico, sem duplicatas", () => {
    const txs = [
      tx({ type: "entrada", amount: 1000 }),
      tx({ type: "saida", amount: 300 }),
      tx({ type: "saida", amount: 300, isDuplicate: true }),
    ];
    expect(netBalance(txs, [makeAccount({ openingBalance: 50 })])).toBe(750);
  });
});

describe("trendFromSeries", () => {
  it("compara o primeiro com o último valor com faixa morta de ±5%", () => {
    expect(trendFromSeries([100, 120])).toBe("subindo");
    expect(trendFromSeries([100, 80])).toBe("caindo");
    expect(trendFromSeries([100, 104])).toBe("estavel");
  });

  it("usa o módulo da base, para séries negativas", () => {
    // de −100 para −50: melhorou → subindo
    expect(trendFromSeries([-100, -50])).toBe("subindo");
  });

  it("série curta ou sem valores finitos não tem dados; zeros são estáveis", () => {
    expect(trendFromSeries([1])).toBe("sem_dados");
    expect(trendFromSeries([NaN, Infinity, 3])).toBe("sem_dados");
    expect(trendFromSeries([0, 0, 0])).toBe("estavel");
  });
});

describe("computeIndicators", () => {
  const month = "2026-07";
  // Abr–Jun: receita 5000 e despesa 3500 por mês
  const past = ["2026-04", "2026-05", "2026-06"].flatMap((m) => [
    tx({ date: `${m}-05`, type: "entrada", amount: 5000 }),
    tx({ date: `${m}-10`, amount: 3500, categoryId: "outros" }),
  ]);
  const july = [
    tx({ date: "2026-07-05", type: "entrada", amount: 5000 }),
    tx({ date: "2026-07-06", amount: 1500, categoryId: "moradia" }),
    tx({ date: "2026-07-07", amount: 1000, categoryId: "lazer" }),
    tx({ date: "2026-07-08", amount: 1000, categoryId: "mercado" }),
  ];
  const indicators = computeIndicators({
    txs: [...past, ...july],
    accounts: [],
    month,
    monthlyIncome: 5000,
    fixedDebtMonthly: 2000,
    fixedCategoryIds: new Set(["moradia"]),
    discretionaryCategoryIds: new Set(["lazer"]),
    cashBalanceOverride: 21_000,
  });
  const byKey = Object.fromEntries(indicators.map((i) => [i.key, i]));

  it("devolve os seis indicadores na ordem do placar", () => {
    expect(indicators.map((i) => i.key)).toEqual([
      "taxa_poupanca",
      "reserva_emergencia",
      "comprometimento_renda",
      "peso_custos_fixos",
      "gasto_discricionario",
      "tendencia_fluxo",
    ]);
  });

  it("taxa de poupança = (receita − despesa) / receita", () => {
    expect(byKey.taxa_poupanca.value).toBeCloseTo(0.3);
    expect(byKey.taxa_poupanca.status).toBe("bom");
  });

  it("reserva de emergência = caixa ÷ despesa média mensal (em meses)", () => {
    expect(byKey.reserva_emergencia.value).toBe(6);
    expect(byKey.reserva_emergencia.status).toBe("bom");
  });

  it("comprometimento de renda entre 30% e 50% é atenção", () => {
    expect(byKey.comprometimento_renda.value).toBeCloseTo(0.4);
    expect(byKey.comprometimento_renda.status).toBe("atencao");
  });

  it("peso dos custos fixos e gasto discricionário usam as categorias marcadas", () => {
    expect(byKey.peso_custos_fixos.value).toBeCloseTo(0.3);
    expect(byKey.peso_custos_fixos.status).toBe("bom");
    expect(byKey.gasto_discricionario.value).toBeCloseTo(0.2);
    expect(byKey.gasto_discricionario.status).toBe("bom");
  });

  it("sem dados de categorias, despesa ou dívida, os indicadores degradam com segurança", () => {
    const res = computeIndicators({ txs: [], accounts: [], month, monthlyIncome: 0 });
    const k = Object.fromEntries(res.map((i) => [i.key, i]));
    expect(k.taxa_poupanca.value).toBe(0);
    expect(k.taxa_poupanca.status).toBe("critico");
    expect(k.reserva_emergencia.status).toBe("sem_dados");
    expect(k.comprometimento_renda.status).toBe("bom"); // sem dívida fixa
    expect(k.peso_custos_fixos.status).toBe("sem_dados");
    expect(k.gasto_discricionario.status).toBe("sem_dados");
  });

  it("sem receita no mês usa a renda do perfil como base", () => {
    const res = computeIndicators({
      txs: [tx({ date: "2026-07-10", amount: 4500 })],
      accounts: [],
      month,
      monthlyIncome: 5000,
    });
    expect(res[0].value).toBeCloseTo(0.1); // (5000 − 4500) / 5000
    expect(res[0].status).toBe("atencao");
  });

  it("reserva de emergência prefere cashBalanceOverride a netBalanceOverride", () => {
    const res = computeIndicators({
      txs: past,
      accounts: [],
      month: "2026-06",
      monthlyIncome: 5000,
      cashBalanceOverride: 7000,
      netBalanceOverride: -1000,
    });
    expect(res[1].value).toBe(2);
    expect(res[1].status).toBe("critico");
  });

  // Regressão (corrigido) (indicators.ts:308-309): `previousMonths(month, 3).concat(month)`
  // já dá [m-1, m-2, m-3, m]; o `.reverse()` seguinte produz
  // [m, m-3, m-2, m-1] — o mês ATUAL vira o primeiro da série. A
  // tendência compara o mês atual com o anterior ao contrário e o valor
  // de "tendencia_fluxo" mostra a sobra do mês passado.
  it("tendência de fluxo usa a série em ordem cronológica", () => {
    const crescente = [
      tx({ date: "2026-04-10", type: "entrada", amount: 100 }),
      tx({ date: "2026-05-10", type: "entrada", amount: 200 }),
      tx({ date: "2026-06-10", type: "entrada", amount: 300 }),
      tx({ date: "2026-07-10", type: "entrada", amount: 400 }),
    ];
    const res = computeIndicators({ txs: crescente, accounts: [], month, monthlyIncome: 0 });
    const fluxo = res.find((i) => i.key === "tendencia_fluxo")!;
    expect(fluxo.value).toBe(400); // sobra do mês atual
    expect(fluxo.trend).toBe("subindo");
  });
});

describe("criticalIndicator", () => {
  const ind = (key: string, status: Indicator["status"]): Indicator => ({
    key,
    label: key,
    value: 0,
    unit: "percent",
    status,
    trend: "sem_dados",
    hint: "",
  });

  it("devolve o primeiro indicador crítico", () => {
    const list = [ind("a", "bom"), ind("b", "atencao"), ind("c", "critico"), ind("d", "critico")];
    expect(criticalIndicator(list)?.key).toBe("c");
  });

  it("devolve null quando tudo está bom ou sem dados", () => {
    expect(criticalIndicator([ind("a", "bom"), ind("b", "sem_dados")])).toBeNull();
  });

  // Regressão (corrigido) (indicators.ts:417-419): o laço retorna já na 1ª iteração
  // ("critico") — `return found ?? null` — então "atencao" nunca é
  // consultado. Sem indicador crítico, o degrau da escada cai direto em
  // "Otimizar e investir" mesmo com indicadores em atenção.
  it("sem crítico, devolve o primeiro em atenção", () => {
    const list = [ind("a", "bom"), ind("b", "atencao")];
    expect(criticalIndicator(list)?.key).toBe("b");
  });
});
