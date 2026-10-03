import { describe, expect, it } from "vitest";
import { cleanInstitution, cleanNameOnly } from "./bank-name";

describe("cleanInstitution", () => {
  it("prioriza o código COMPE de bankData.transferNumber", () => {
    expect(
      cleanInstitution({ name: "Conta Gold", bankData: { transferNumber: "323/0001/12345-6" } })
    ).toEqual({ institution: "Mercado Pago", isCard: false });
    expect(cleanInstitution({ name: "Qualquer", bankData: { transferNumber: "237" } }).institution).toBe("Bradesco");
  });

  it("código COMPE desconhecido ou curto cai para o nome", () => {
    expect(
      cleanInstitution({ name: "Nu Pagamentos S.A.", bankData: { transferNumber: "999/1" } }).institution
    ).toBe("Nubank");
    expect(cleanInstitution({ name: "Banco Inter", bankData: { transferNumber: "07" } }).institution).toBe("Inter");
  });

  it("prefere marketingName a name", () => {
    expect(cleanInstitution({ name: "Conta Corrente", marketingName: "Itaú Personnalité" }).institution).toBe("Itaú");
  });

  it("identifica cartão por type CREDIT ou subtype CREDIT_CARD", () => {
    expect(cleanInstitution({ type: "CREDIT", name: "Nubank Ultravioleta" }).isCard).toBe(true);
    expect(cleanInstitution({ type: "bank", subtype: "credit_card", name: "X" }).isCard).toBe(true);
    expect(cleanInstitution({ type: "BANK", subtype: "CHECKING_ACCOUNT", name: "X" }).isCard).toBe(false);
  });

  it("cartão com nome genérico de produto devolve o próprio nome (best-effort)", () => {
    expect(cleanInstitution({ type: "CREDIT", name: "Gold" }).institution).toBe("Gold");
  });
});

describe("cleanNameOnly", () => {
  it("aplica apelidos conhecidos", () => {
    expect(cleanNameOnly("Nu Pagamentos S.A. - Instituição de Pagamento")).toBe("Nubank");
    expect(cleanNameOnly("MERCADOPAGO.COM REPRESENTACOES")).toBe("Mercado Pago");
    expect(cleanNameOnly("Banco Bradesco S.A.")).toBe("Bradesco");
  });

  it("sem apelido, remove sufixos societários e institucionais", () => {
    expect(cleanNameOnly("Banco Exemplo S.A.")).toBe("Banco Exemplo");
    expect(cleanNameOnly("Fintech Exemplo Ltda")).toBe("Fintech Exemplo");
    expect(cleanNameOnly("Cooperativa Exemplo - Instituição de Pagamento")).toBe("Cooperativa Exemplo");
  });

  it("nome vazio vira o rótulo genérico 'Banco'", () => {
    expect(cleanNameOnly("")).toBe("Banco");
    expect(cleanNameOnly(null)).toBe("Banco");
    expect(cleanNameOnly("   ")).toBe("Banco");
  });
});
