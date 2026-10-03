import { describe, expect, it } from "vitest";
import { detectAnomalies } from "./anomalies";
import type { Recurrence } from "./recurrences";
import { makeCategory, makeTransaction as tx } from "../../../test/fixtures";

const month = "2026-07";
const comida = makeCategory({ id: "comida", name: "Comida fora" });
const mercado = makeCategory({ id: "mercado", name: "Mercado" });
const categories = [comida, mercado];

/** Três meses de histórico com o mesmo gasto por categoria. */
function history(categoryId: string, monthly: number) {
  return ["2026-04-15", "2026-05-15", "2026-06-15"].map((date) =>
    tx({ date, amount: monthly, categoryId })
  );
}

const rec = (o: Partial<Recurrence>): Recurrence => ({
  label: "Netflix.com",
  categoryId: "assinaturas",
  amount: 55.9,
  type: "saida",
  intervalDays: 30,
  occurrences: 3,
  lastDate: "2026-07-05",
  nextExpected: "2026-08-04",
  overdue: false,
  ...o,
});

describe("detectAnomalies — categoria acima da média", () => {
  it("sinaliza 'atencao' a partir de 40% acima da média dos 3 meses anteriores", () => {
    const txs = [...history("comida", 300), tx({ date: "2026-07-10", amount: 420, categoryId: "comida" })];
    const [flag] = detectAnomalies(txs, month, categories, []);
    expect(flag).toMatchObject({
      kind: "categoria_acima_media",
      severity: "atencao",
      title: "Comida fora acima do normal",
      amount: 120,
      categoryId: "comida",
    });
    expect(flag.detail).toContain("40% acima");
  });

  it("vira 'critico' a partir de 80% acima", () => {
    const txs = [...history("comida", 300), tx({ date: "2026-07-10", amount: 540, categoryId: "comida" })];
    expect(detectAnomalies(txs, month, categories, [])[0].severity).toBe("critico");
  });

  it("não sinaliza abaixo de 40%", () => {
    const txs = [...history("comida", 300), tx({ date: "2026-07-10", amount: 410, categoryId: "comida" })];
    expect(detectAnomalies(txs, month, categories, [])).toEqual([]);
  });

  it("ignora categorias com média abaixo de R$ 50 (ruído)", () => {
    const txs = [...history("comida", 40), tx({ date: "2026-07-10", amount: 400, categoryId: "comida" })];
    expect(detectAnomalies(txs, month, categories, [])).toEqual([]);
  });

  it("ignora categoria nova, sem histórico", () => {
    const txs = [tx({ date: "2026-07-10", amount: 900, categoryId: "mercado" })];
    expect(detectAnomalies(txs, month, categories, [])).toEqual([]);
  });
});

describe("detectAnomalies — transação atípica", () => {
  // 8 saídas históricas em torno de R$ 50 (sem categoria, para não
  // disparar a regra de categoria)
  const base = [50, 52, 48, 51, 49, 50, 53, 47].map((amount, i) =>
    tx({ date: `2026-06-${String(i + 1).padStart(2, "0")}`, amount, categoryId: null, description: `Compra ${i}` })
  );

  it("sinaliza saída acima de média + 2,5 desvios-padrão do histórico", () => {
    const atipica = tx({ date: "2026-07-10", amount: 900, description: "Loja de Eletronicos", categoryId: "x" });
    const flags = detectAnomalies([...base, atipica], month, categories, []);
    const outlier = flags.find((f) => f.kind === "transacao_atipica");
    expect(outlier).toMatchObject({
      severity: "atencao",
      title: "Transação atípica: Loja de Eletronicos",
      amount: 900,
      categoryId: "x",
    });
  });

  it("não sinaliza valores dentro do padrão", () => {
    const normal = tx({ date: "2026-07-10", amount: 54, categoryId: "x" });
    const flags = detectAnomalies([...base, normal], month, categories, []);
    expect(flags.filter((f) => f.kind === "transacao_atipica")).toEqual([]);
  });

  it("não roda com menos de 8 saídas de histórico", () => {
    const atipica = tx({ date: "2026-07-10", amount: 900, categoryId: "x" });
    const flags = detectAnomalies([...base.slice(0, 7), atipica], month, categories, []);
    expect(flags.filter((f) => f.kind === "transacao_atipica")).toEqual([]);
  });

  it("não sinaliza entradas, por maiores que sejam", () => {
    const bonus = tx({ date: "2026-07-10", amount: 9000, type: "entrada" });
    const flags = detectAnomalies([...base, bonus], month, categories, []);
    expect(flags.filter((f) => f.kind === "transacao_atipica")).toEqual([]);
  });
});

describe("detectAnomalies — recorrências", () => {
  it("assinatura esperada e ausente vira flag 'info'", () => {
    const [flag] = detectAnomalies([], month, categories, [
      rec({ label: "Spotify", overdue: true, nextExpected: "2026-07-01", amount: 21.9 }),
    ]);
    expect(flag).toMatchObject({ kind: "assinatura_ausente", severity: "info", title: "Recorrência sumiu: Spotify" });
    expect(flag.detail).toContain("2026-07-01");
  });

  it("recorrência recém-nascida (2 ocorrências, última neste mês) vira 'cobranca_nova'", () => {
    const [flag] = detectAnomalies([], month, categories, [rec({ occurrences: 2, lastDate: "2026-07-05" })]);
    expect(flag).toMatchObject({ kind: "cobranca_nova", severity: "atencao", amount: 55.9 });
  });

  it("não chama de nova a recorrência com histórico longo ou cuja última ocorrência é antiga", () => {
    const flags = detectAnomalies([], month, categories, [
      rec({ occurrences: 5 }),
      rec({ occurrences: 2, lastDate: "2026-06-05" }),
    ]);
    expect(flags).toEqual([]);
  });

  it("ignora recorrências de entrada (salário não é cobrança)", () => {
    const flags = detectAnomalies([], month, categories, [rec({ type: "entrada", overdue: true, occurrences: 2 })]);
    expect(flags).toEqual([]);
  });
});

describe("detectAnomalies — ordenação", () => {
  it("ordena por severidade: critico, atencao, info", () => {
    const txs = [...history("comida", 300), tx({ date: "2026-07-10", amount: 600, categoryId: "comida" })];
    const flags = detectAnomalies(txs, month, categories, [
      rec({ label: "Spotify", overdue: true }),
      rec({ occurrences: 2, lastDate: "2026-07-05" }),
    ]);
    expect(flags.map((f) => f.severity)).toEqual(["critico", "atencao", "info"]);
  });
});
