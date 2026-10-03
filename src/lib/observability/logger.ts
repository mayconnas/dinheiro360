// ─────────────────────────────────────────────────────────────
// Logger estruturado — zero dependências, agnóstico de runtime.
//
// Produção: uma linha JSON por evento (fácil de filtrar com `jq` em
// `docker service logs`), no formato
//   {"time","level","msg","module",...contexto,"err":{name,message,stack}}
// Desenvolvimento: uma linha legível — hora, nível, [módulo], mensagem
// e o contexto em key=value (o stack do erro vem logo abaixo).
//
// Nível mínimo via LOG_LEVEL (debug | info | warn | error) — padrão
// `info` em produção e `debug` em desenvolvimento.
//
// Segurança: valores de chaves que parecem segredo (api_key, token,
// secret, password, authorization, cookie…) são trocados por
// "[REDACTED]" em qualquer profundidade — inclusive dentro de erros.
//
// Sem `import "server-only"` e sem `node:*`: roda no runtime Node, no
// Edge (middleware) e em testes. Mesmo assim, é pensado para o servidor.
//
// Uso:
//   const log = logger.child({ module: "pluggy-sync" });
//   log.info("sync concluída", { itemId, transacoes: 42 });
//   log.error("falha no webhook", { err, itemId });
// ─────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Campos extras de um evento. Um `Error` em qualquer campo é serializado. */
export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(msg: string, context?: LogContext | Error): void;
  info(msg: string, context?: LogContext | Error): void;
  warn(msg: string, context?: LogContext | Error): void;
  error(msg: string, context?: LogContext | Error): void;
  /** Logger filho: os `bindings` (ex.: `{ module }`) entram em todo evento. */
  child(bindings: LogContext): Logger;
}

export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: unknown;
  [key: string]: unknown;
};

// ─── Configuração ─────────────────────────────────────────────
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const REDACT_KEY = /api[_-]?key|token|secret|password|authorization|cookie/i;
const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;
/** Campos do envelope — o contexto não pode sobrescrevê-los. */
const RESERVED = new Set(["time", "level", "msg"]);

function readEnv(name: string): string | undefined {
  // `process` pode não existir em runtimes não-Node (ex.: browser).
  if (typeof process === "undefined" || !process.env) return undefined;
  return process.env[name];
}

function isProduction(): boolean {
  return readEnv("NODE_ENV") === "production";
}

function isLogLevel(value: unknown): value is LogLevel {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(LEVEL_WEIGHT, value)
  );
}

function resolveMinLevel(): LogLevel {
  const fromEnv = readEnv("LOG_LEVEL")?.trim().toLowerCase();
  if (isLogLevel(fromEnv)) return fromEnv;
  return isProduction() ? "info" : "debug";
}

// ─── Serialização (redação + erros + ciclos) ──────────────────
/** Converte um Error em objeto plano, incluindo `cause` e props próprias (ex.: `code`). */
function serializeError(
  error: Error,
  seen: WeakSet<object>,
  depth: number
): SerializedError {
  const out: SerializedError = {
    name: error.name,
    message: error.message,
  };
  if (error.stack) out.stack = error.stack;

  // Props próprias e enumeráveis (ex.: `code`, `status` de erros de lib).
  for (const [key, value] of Object.entries(error)) {
    if (key === "name" || key === "message" || key === "stack" || key === "cause") {
      continue;
    }
    out[key] = REDACT_KEY.test(key) ? REDACTED : sanitize(value, seen, depth + 1);
  }

  // `cause` costuma ser não-enumerável (new Error(msg, { cause })).
  if (error.cause !== undefined) {
    out.cause = sanitize(error.cause, seen, depth + 1);
  }
  return out;
}

/** Cópia "segura para JSON": redige segredos, serializa erros e corta ciclos. */
function sanitize(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) return value;

  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "symbol":
      return value.toString();
    case "function":
      return `[Function ${value.name || "anônima"}]`;
  }

  const obj = value as object;
  if (seen.has(obj)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";

  if (obj instanceof Date) {
    return Number.isNaN(obj.getTime()) ? "Invalid Date" : obj.toISOString();
  }
  if (obj instanceof URL) return obj.toString();

  seen.add(obj);
  try {
    if (obj instanceof Error) return serializeError(obj, seen, depth);
    if (Array.isArray(obj)) {
      return obj.map((item) => sanitize(item, seen, depth + 1));
    }
    if (obj instanceof Map) {
      return sanitize(Object.fromEntries(obj), seen, depth + 1);
    }
    if (obj instanceof Set) {
      return sanitize(Array.from(obj), seen, depth + 1);
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      out[key] = REDACT_KEY.test(key) ? REDACTED : sanitize(val, seen, depth + 1);
    }
    return out;
  } finally {
    // Remove ao sair: o mesmo objeto pode aparecer em ramos irmãos sem ser ciclo.
    seen.delete(obj);
  }
}

// ─── Formatação ───────────────────────────────────────────────
type LogRecord = Record<string, unknown> & {
  time: string;
  level: LogLevel;
  msg: string;
};

function buildRecord(
  level: LogLevel,
  msg: string,
  bindings: LogContext,
  context: LogContext | Error | undefined
): LogRecord {
  const ctx: LogContext =
    context instanceof Error ? { err: context } : { ...(context ?? {}) };
  const merged: LogContext = { ...bindings, ...ctx };

  const record: LogRecord = { time: new Date().toISOString(), level, msg };
  const seen = new WeakSet<object>();
  let err: unknown;

  for (const [key, value] of Object.entries(merged)) {
    if (RESERVED.has(key) || value === undefined) continue;
    if (key === "err") {
      err = value;
      continue;
    }
    record[key] = REDACT_KEY.test(key) ? REDACTED : sanitize(value, seen, 0);
  }

  // `err` sempre por último — fica fácil de achar na linha.
  if (err !== undefined) record.err = sanitize(err, seen, 0);
  return record;
}

function formatJson(record: LogRecord): string {
  try {
    return JSON.stringify(record);
  } catch {
    // Último recurso: nunca deixar o log derrubar a request.
    return JSON.stringify({
      time: record.time,
      level: record.level,
      msg: record.msg,
      logError: "falha ao serializar o contexto",
    });
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return /[\s"=]/.test(value) ? JSON.stringify(value) : value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatPretty(record: LogRecord): string {
  const { time, level, msg, module, err, ...rest } = record;
  const parts = [time.slice(11, 23), level.toUpperCase().padEnd(5)];
  if (module !== undefined) parts.push(`[${String(module)}]`);
  parts.push(msg);
  for (const [key, value] of Object.entries(rest)) {
    parts.push(`${key}=${formatValue(value)}`);
  }

  let line = parts.join(" ");
  if (err !== undefined) {
    const e = err as Partial<SerializedError>;
    if (e && typeof e === "object" && typeof e.message === "string") {
      line += ` err=${formatValue(`${e.name ?? "Error"}: ${e.message}`)}`;
      if (e.stack) line += `\n${e.stack}`;
      if (e.cause !== undefined) {
        const c = e.cause as Partial<SerializedError> | null;
        const text =
          c && typeof c === "object" && typeof c.stack === "string"
            ? c.stack
            : formatValue(e.cause);
        line += `\n  causa: ${text}`;
      }
    } else {
      line += ` err=${formatValue(err)}`;
    }
  }
  return line;
}

function write(level: LogLevel, line: string): void {
  // stdout para debug/info, stderr para warn/error — o Docker captura os dois.
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

// ─── Fábrica ──────────────────────────────────────────────────
export type LoggerOptions = {
  /** Nível mínimo. Padrão: LOG_LEVEL ou info (prod) / debug (dev). */
  level?: LogLevel;
  /** Saída em JSON. Padrão: true quando NODE_ENV=production. */
  json?: boolean;
  /** Campos fixos em todo evento (ex.: `{ module: "health" }`). */
  bindings?: LogContext;
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const minLevel = options.level ?? resolveMinLevel();
  const json = options.json ?? isProduction();
  const bindings = options.bindings ?? {};

  const log = (level: LogLevel, msg: string, context?: LogContext | Error) => {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minLevel]) return;
    try {
      const record = buildRecord(level, msg, bindings, context);
      write(level, json ? formatJson(record) : formatPretty(record));
    } catch {
      // Logging nunca pode quebrar o fluxo da aplicação.
    }
  };

  return {
    debug: (msg, context) => log("debug", msg, context),
    info: (msg, context) => log("info", msg, context),
    warn: (msg, context) => log("warn", msg, context),
    error: (msg, context) => log("error", msg, context),
    child: (extra) =>
      createLogger({
        level: minLevel,
        json,
        bindings: { ...bindings, ...extra },
      }),
  };
}

/** Logger raiz da aplicação. Prefira `logger.child({ module: "..." })`. */
export const logger: Logger = createLogger();
