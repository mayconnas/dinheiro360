import { describe, expect, it } from "vitest";
import {
  PAYMENT_METHOD_META,
  inferPaymentMethod,
  mapPluggyPaymentMethod,
  resolvePaymentMethod,
} from "./payment-method";

describe("mapPluggyPaymentMethod (dado estruturado da Pluggy)", () => {
  it("creditCardMetadata presente é sempre crédito, independente do paymentMethod", () => {
    expect(mapPluggyPaymentMethod({ hasCreditCardMetadata: true, paymentMethod: "PIX" })).toBe("credito");
  });

  it("mapeia o paymentMethod estruturado", () => {
    expect(mapPluggyPaymentMethod({ paymentMethod: "PIX" })).toBe("pix");
    expect(mapPluggyPaymentMethod({ paymentMethod: "DEBIT" })).toBe("debito");
    expect(mapPluggyPaymentMethod({ paymentMethod: "BOLETO" })).toBe("boleto");
    expect(mapPluggyPaymentMethod({ paymentMethod: "TED" })).toBe("transferencia");
    expect(mapPluggyPaymentMethod({ paymentMethod: "WIRE_TRANSFER" })).toBe("transferencia");
  });

  it("com paymentMethod OTHER ou ausente, usa o operationType como segunda pista", () => {
    expect(mapPluggyPaymentMethod({ paymentMethod: "OTHER", operationType: "PIX" })).toBe("pix");
    expect(mapPluggyPaymentMethod({ operationType: "TRANSFERENCIA_MESMA_INSTITUICAO" })).toBe("transferencia");
    expect(mapPluggyPaymentMethod({ paymentMethod: null, operationType: "BOLETO" })).toBe("boleto");
  });

  it("não inventa forma de pagamento para operações de investimento ou 'OUTROS'", () => {
    expect(mapPluggyPaymentMethod({ operationType: "RESGATE_APLIC_FINANCEIRA" })).toBeNull();
    expect(mapPluggyPaymentMethod({ operationType: "OUTROS" })).toBeNull();
  });

  it("não usa o type CREDIT/DEBIT do extrato como forma de pagamento", () => {
    expect(mapPluggyPaymentMethod({ type: "CREDIT" })).toBeNull();
    expect(mapPluggyPaymentMethod({ type: "DEBIT", paymentMethod: "OTHER" })).toBeNull();
  });
});

describe("inferPaymentMethod (heurística sobre a descrição bruta)", () => {
  it("reconhece pistas fortes sem diferenciar caixa e acento", () => {
    expect(inferPaymentMethod("PIX ENVIADO JOAO")).toBe("pix");
    expect(inferPaymentMethod("Pagamento de boleto")).toBe("boleto");
    expect(inferPaymentMethod("Transferência enviada")).toBe("transferencia");
    expect(inferPaymentMethod("Pagamento fatura cartão de crédito")).toBe("credito");
    expect(inferPaymentMethod("Compra no débito")).toBe("debito");
  });

  it("Pix tem precedência sobre outras pistas na mesma descrição", () => {
    expect(inferPaymentMethod("Transferência enviada pelo Pix")).toBe("pix");
  });

  it("devolve null sem pista confiável (investimento, saque, bandeira solta, vazio)", () => {
    expect(inferPaymentMethod("Resgate aplicação CDB")).toBeNull();
    expect(inferPaymentMethod("Saque 24h")).toBeNull();
    expect(inferPaymentMethod("VISA MERCADO EXTRA")).toBeNull();
    expect(inferPaymentMethod("   ")).toBeNull();
  });

  // BUG (payment-method.ts:165-166): "TED"/"DOC" são buscados como
  // substring, sem fronteira de palavra — "DOCE", "DOCUMENTO",
  // "UNITED" etc. viram transferência, contrariando o "PRECISÃO >
  // cobertura" documentado. Sugestão: usar /\b(TED|DOC)\b/.
  it.fails("não classifica 'PADARIA DOCE SABOR' como transferência (BUG: substring 'DOC')", () => {
    expect(inferPaymentMethod("PADARIA DOCE SABOR")).toBeNull();
  });
});

describe("resolvePaymentMethod", () => {
  it("prefere o valor persistido quando é um método conhecido", () => {
    expect(resolvePaymentMethod({ paymentMethod: "boleto", rawDescription: "PIX ENVIADO" })).toBe("boleto");
  });

  it("cai na heurística quando o valor persistido está ausente ou é desconhecido", () => {
    expect(resolvePaymentMethod({ paymentMethod: null, rawDescription: "PIX ENVIADO" })).toBe("pix");
    expect(resolvePaymentMethod({ paymentMethod: "dinheiro", rawDescription: "TED 123" })).toBe("transferencia");
    expect(resolvePaymentMethod({})).toBeNull();
  });

  it("todo método tem rótulo e cor para o badge", () => {
    for (const meta of Object.values(PAYMENT_METHOD_META)) {
      expect(meta.label).not.toBe("");
      expect(meta.color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });
});
