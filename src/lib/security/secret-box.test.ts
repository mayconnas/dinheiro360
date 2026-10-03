import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted, maskSecret } from "./secret-box";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("secret-box (AES-256-GCM)", () => {
  beforeEach(() => vi.stubEnv("AI_CREDENTIALS_ENCRYPTION_KEY", KEY));
  afterEach(() => vi.unstubAllEnvs());

  it("cifra e decifra de volta, sem o texto em claro no resultado", () => {
    const enc = encryptSecret("sk-ant-segredo-123456", "u1:anthropic");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("segredo");
    expect(decryptSecret(enc, "u1:anthropic")).toBe("sk-ant-segredo-123456");
  });

  it("usa IV aleatório: o mesmo segredo nunca gera o mesmo texto cifrado", () => {
    expect(encryptSecret("abc", "ctx")).not.toBe(encryptSecret("abc", "ctx"));
  });

  it("recusa decifrar em outro contexto (chave copiada para a linha de outro usuário)", () => {
    const enc = encryptSecret("sk-ant-segredo-123456", "u1:anthropic");
    expect(() => decryptSecret(enc, "u2:anthropic")).toThrow(/decifrar/);
    expect(() => decryptSecret(enc, "u1:openai")).toThrow(/decifrar/);
  });

  it("detecta adulteração do texto cifrado", () => {
    const enc = encryptSecret("sk-ant-segredo-123456", "ctx");
    const blob = Buffer.from(enc.slice("enc:v1:".length), "base64");
    blob[blob.length - 1] ^= 0xff;
    expect(() => decryptSecret(`enc:v1:${blob.toString("base64")}`, "ctx")).toThrow(/decifrar/);
  });

  it("devolve como está um valor legado em texto puro (migração preguiçosa)", () => {
    expect(isEncrypted("sk-legado")).toBe(false);
    expect(decryptSecret("sk-legado", "ctx")).toBe("sk-legado");
  });

  it("exige a chave do servidor, com 32 bytes", () => {
    vi.stubEnv("AI_CREDENTIALS_ENCRYPTION_KEY", "");
    expect(() => encryptSecret("a", "b")).toThrow(/AI_CREDENTIALS_ENCRYPTION_KEY/);
    vi.stubEnv("AI_CREDENTIALS_ENCRYPTION_KEY", Buffer.alloc(16).toString("base64"));
    expect(() => encryptSecret("a", "b")).toThrow(/32 bytes/);
  });

  it("mascara mostrando no máximo os 4 últimos caracteres", () => {
    expect(maskSecret("sk-ant-segredo-123456")).toBe("sk-...3456");
    expect(maskSecret("abc")).toBe("•••");
  });
});
