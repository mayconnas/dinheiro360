// ─────────────────────────────────────────────────────────────
// Cifragem de segredos em repouso (chaves de API dos usuários).
//
// AES-256-GCM com chave do servidor (AI_CREDENTIALS_ENCRYPTION_KEY,
// 32 bytes em base64 — gere com `openssl rand -base64 32`). Formato
// gravado no banco:
//
//   enc:v1:<base64( iv[12] | authTag[16] | ciphertext )>
//
// O "contexto" (ex: "<user_id>:<provider>") entra como AAD: o texto
// cifrado fica amarrado à linha — copiar o api_key de um usuário para
// outro faz a decifragem falhar em vez de vazar a chave.
//
// Valores sem o prefixo são legados em texto puro (antes desta camada);
// decryptSecret os devolve como estão e o credential-store os recifra
// na primeira leitura.
// ─────────────────────────────────────────────────────────────
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretBoxError";
  }
}

function loadKey(): Buffer {
  const raw = process.env.AI_CREDENTIALS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new SecretBoxError(
      "AI_CREDENTIALS_ENCRYPTION_KEY não configurada no servidor — necessária para guardar chaves de API cifradas (gere com `openssl rand -base64 32`)."
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new SecretBoxError("AI_CREDENTIALS_ENCRYPTION_KEY precisa ter 32 bytes em base64.");
  }
  return key;
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

export function encryptSecret(plain: string, context: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptSecret(stored: string, context: string): string {
  if (!isEncrypted(stored)) return stored; // legado em texto puro
  const key = loadKey();
  const blob = Buffer.from(stored.slice(PREFIX.length), "base64");
  if (blob.length <= IV_BYTES + TAG_BYTES) throw new SecretBoxError("Segredo cifrado corrompido.");
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(context, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError(
      "Não foi possível decifrar a chave salva (chave do servidor trocada ou dado adulterado). Salve a chave de API de novo."
    );
  }
}

/** "sk-ant-abc123XYZ" → "sk-...3XYZ". Nunca expõe mais que os 4 últimos caracteres. */
export function maskSecret(plain: string): string {
  const trimmed = plain.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length || 4);
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-4)}`;
}
