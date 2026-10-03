// ─────────────────────────────────────────────────────────────
// Validação de entrada das Server Actions (zod).
//
// Server Actions são endpoints HTTP públicos: qualquer um com a sessão
// pode chamá-las com qualquer payload, ignorando os tipos do TypeScript.
// Toda entrada passa por um schema daqui antes de tocar no banco.
//
// Sem `server-only`: os schemas também servem para validar formulários
// no client, com as mesmas mensagens.
// ─────────────────────────────────────────────────────────────
import { z } from "zod";

/** Entrada recusada pela validação — mensagem já em pt-BR, pronta para a UI. */
export class ValidationError extends Error {
  readonly issues: z.ZodIssue[];
  constructor(issues: z.ZodIssue[]) {
    const first = issues[0];
    const where = first?.path.length ? ` (${first.path.join(".")})` : "";
    super(`${first?.message ?? "Dados inválidos."}${where}`);
    this.name = "ValidationError";
    this.issues = issues;
  }
}

/** Valida `input` contra `schema`; devolve o valor já tipado e normalizado ou lança ValidationError. */
export function parseInput<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ValidationError(result.error.issues);
  return result.data;
}

// ─── Primitivos ───

export const uuid = z.string().uuid("Identificador inválido.");
export const uuidList = (max: number) =>
  z.array(uuid).max(max, `Envie no máximo ${max} itens por vez.`);

/** Data ISO AAAA-MM-DD válida no calendário. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (use AAAA-MM-DD).")
  // ida e volta: rejeita 2026-02-31, que o Date "rola" para 03/03
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Data inválida.");

/** Valor em reais: finito, não negativo, até 2 casas e dentro de numeric(14,2). */
export const money = z
  .number({ invalid_type_error: "Valor inválido." })
  .finite("Valor inválido.")
  .nonnegative("O valor não pode ser negativo.")
  .max(999_999_999_999.99, "Valor alto demais.")
  .transform((n) => Math.round(n * 100) / 100);

export const trimmedText = (max: number, label = "Texto") =>
  z.string().trim().min(1, `${label} é obrigatório.`).max(max, `${label} muito longo (máx. ${max}).`);

export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Cor inválida (use #RRGGBB).");

// ─── Enums do domínio (espelham os CHECKs das migrations) ───

export const transactionType = z.enum(["entrada", "saida"]);
export const categoryKind = z.enum(["receita", "despesa"]);
export const categoryNature = z.enum(["fixa", "variavel", "discricionaria", "receita"]);
export const accountKind = z.enum(["corrente", "poupanca", "carteira", "investimento", "cartao"]);
export const employmentType = z.enum(["clt", "autonomo", "misto"]);
export const aiProvider = z.enum(["anthropic", "openai", "gemini", "deepseek"]);

/** Nome de modelo de IA (ex "claude-sonnet-5", "jev-1.13.0"). */
export const modelName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:/-]{1,80}$/, "Nome de modelo inválido.")
  .nullable()
  .optional()
  .transform((v) => v || null);

/** Chave de API: sem espaços, tamanho plausível. */
export const apiKey = z
  .string()
  .trim()
  .min(8, "Essa chave não parece válida.")
  .max(512, "Chave longa demais.")
  .regex(/^\S+$/, "A chave não pode ter espaços.");
