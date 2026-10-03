// ─────────────────────────────────────────────────────────────
// Camada 1.1 — Conectores
// Um adaptador por fonte. Cada um cospe RawTransaction[] no formato
// canônico. Aqui: Manual e Import (CSV). Open Finance (1.1.a) entra
// depois sem mexer em nada acima — mesma saída canônica.
// ─────────────────────────────────────────────────────────────
import type { RawTransaction } from "@/lib/types";

// ─── Conector Manual (1.1) ────────────────────────────────────
export interface ManualEntry {
  date: string;
  amount: number;
  type: "entrada" | "saida";
  description: string;
  account?: string;
}

export function manualConnector(entry: ManualEntry): RawTransaction {
  return {
    date: entry.date,
    amount: entry.amount,
    type: entry.type,
    description: entry.description,
    account: entry.account,
    origin: "manual",
  };
}

// ─── Conector de Importação — CSV (Opção 2 do 1.1.a) ──────────

/** Parser de CSV simples com suporte a aspas e vírgula/ponto-e-vírgula. */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const delimiter = detectDelimiter(text);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignora; o \n seguinte fecha a linha
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const semis = (sample.match(/;/g) || []).length;
  const commas = (sample.match(/,/g) || []).length;
  return semis > commas ? ";" : ",";
}

/** Converte string de valor pt-BR ("1.234,56") ou en ("1234.56") em número. */
export function parseAmount(raw: string): number {
  let s = raw.trim().replace(/[R$\s]/g, "");
  if (s === "") return NaN;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  s = s.replace(/[()]/g, "").replace(/^-/, "");

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // o último separador é o decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (hasComma) {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return negative ? -n : n;
}

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["data", "date", "dt", "data lançamento", "data lancamento"],
  amount: ["valor", "amount", "value", "montante", "quantia"],
  description: [
    "descrição",
    "descricao",
    "description",
    "histórico",
    "historico",
    "lançamento",
    "lancamento",
    "memo",
    "estabelecimento",
  ],
  type: ["tipo", "type"],
};

function matchColumn(header: string): keyof typeof HEADER_ALIASES | null {
  const h = header.trim().toLowerCase();
  for (const key of Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]) {
    if (HEADER_ALIASES[key].some((alias) => h === alias || h.includes(alias)))
      return key;
  }
  return null;
}

export interface ImportResult {
  transactions: RawTransaction[];
  errors: string[];
}

/**
 * Conector de importação: recebe o texto de um CSV (export do banco ou
 * do Meu Pluggy) e devolve RawTransaction[] canônicas.
 */
export function importCSVConnector(csvText: string): ImportResult {
  const rows = parseCSV(csvText);
  const errors: string[] = [];
  if (rows.length < 2) {
    return { transactions: [], errors: ["Arquivo vazio ou sem cabeçalho."] };
  }

  const header = rows[0];
  const colMap: Partial<Record<keyof typeof HEADER_ALIASES, number>> = {};
  header.forEach((h, idx) => {
    const key = matchColumn(h);
    if (key && colMap[key] === undefined) colMap[key] = idx;
  });

  if (colMap.date === undefined || colMap.amount === undefined) {
    return {
      transactions: [],
      errors: [
        "Não encontrei as colunas de data e valor. " +
          "Cabeçalhos esperados: Data, Valor, Descrição.",
      ],
    };
  }

  const transactions: RawTransaction[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const dateStr = r[colMap.date]?.trim();
    const amountStr = r[colMap.amount!]?.trim();
    if (!dateStr || !amountStr) continue;

    const amount = parseAmount(amountStr);
    if (isNaN(amount)) {
      errors.push(`Linha ${i + 1}: valor inválido "${amountStr}".`);
      continue;
    }

    const description =
      colMap.description !== undefined
        ? r[colMap.description]?.trim() || "Sem descrição"
        : "Sem descrição";

    let type: "entrada" | "saida" | undefined;
    if (colMap.type !== undefined) {
      const t = r[colMap.type]?.trim().toLowerCase() ?? "";
      if (/entrada|receita|crédito|credito|c$/.test(t)) type = "entrada";
      else if (/saída|saida|despesa|débito|debito|d$/.test(t)) type = "saida";
    }

    transactions.push({
      date: dateStr,
      amount,
      type,
      description,
      origin: "import",
    });
  }

  return { transactions, errors };
}
