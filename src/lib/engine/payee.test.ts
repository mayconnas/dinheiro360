import { describe, expect, it } from "vitest";
import { extractPayeeName, guessKind, normalizePayeeName } from "./payee";

describe("normalizePayeeName (chave de dedup)", () => {
  it("ignora caixa, acento e espaços extras", () => {
    expect(normalizePayeeName("  MARIA   Oliveira SANTOS ")).toBe("maria oliveira santos");
    expect(normalizePayeeName("João Açougue")).toBe("joao acougue");
  });

  it("remove sufixos societários e pontuação", () => {
    expect(normalizePayeeName("Empresa XYZ Ltda.")).toBe("empresa xyz");
    expect(normalizePayeeName("Padaria Pão Quente ME")).toBe("padaria pao quente");
    expect(normalizePayeeName("Comercio ABC EIRELI")).toBe("comercio abc");
    expect(normalizePayeeName("Empresa XYZ S/A")).toBe("empresa xyz");
  });

  it("variações do mesmo nome caem na mesma chave", () => {
    expect(normalizePayeeName("Empresa XYZ")).toBe(normalizePayeeName("EMPRESA XYZ LTDA"));
  });

  // BUG (payee.ts:100-101 e 110-112): o regex de sufixos roda ANTES de remover a
  // pontuação e só aceita "s/a" ou "sa" — "S.A." (com pontos), a grafia
  // mais comum, vira "s a" e não casa com "Empresa XYZ".
  it.fails("'Empresa XYZ S.A.' cai na mesma chave que 'Empresa XYZ' (BUG: 'S.A.' com pontos não é removido)", () => {
    expect(normalizePayeeName("Empresa XYZ S.A.")).toBe(normalizePayeeName("Empresa XYZ"));
  });
});

describe("extractPayeeName", () => {
  it("prioriza o nome estruturado da contraparte, em Title Case", () => {
    expect(
      extractPayeeName({ counterpartyName: "MARIA OLIVEIRA SANTOS", rawDescription: "PIX ENVIADO XPTO" })
    ).toBe("Maria Oliveira Santos");
  });

  it("reconhece estabelecimentos conhecidos e devolve o nome canônico", () => {
    expect(extractPayeeName({ rawDescription: "IFD*IFOOD.COM AGENCIA DE RESTAURANTES" })).toBe("iFood");
    expect(extractPayeeName({ rawDescription: "UBER *TRIP HELP.UBER.COM" })).toBe("Uber");
    expect(extractPayeeName({ rawDescription: "PAO DE ACUCAR 1234" })).toBe("Pão de Açúcar");
    expect(extractPayeeName({ rawDescription: "Amazon Prime Video" })).toBe("Amazon Prime");
  });

  it("remove prefixos de operação e ruído para sobrar o nome", () => {
    expect(extractPayeeName({ rawDescription: "PIX ENVIADO JOAO PEREIRA" })).toBe("Joao Pereira");
    expect(extractPayeeName({ rawDescription: "TRANSFERENCIA RECEBIDA ANA LIMA" })).toBe("Ana Lima");
    expect(extractPayeeName({ rawDescription: "TED 12345678 AG 0001 CC 12345 CARLOS ALBERTO" })).toBe(
      "Carlos Alberto"
    );
    expect(extractPayeeName({ rawDescription: "COMPRA LOJA RENNER PARC 2/6" })).toBe("Loja Renner");
  });

  it("devolve null quando só sobra ruído ou nada", () => {
    expect(extractPayeeName({ rawDescription: "PIX RECEBIDO" })).toBeNull();
    expect(extractPayeeName({ rawDescription: "PAGAMENTO 123456789" })).toBeNull();
    expect(extractPayeeName({ rawDescription: "   " })).toBeNull();
    expect(extractPayeeName({ counterpartyName: "   ", rawDescription: "" })).toBeNull();
  });

  // BUG (payee.ts:17-18 e 45-56): o formato real da Pluggy citado em
  // pluggy.ts — "Transferência Enviada|Maria Oliveira Santos" — não é
  // limpo: /TRANSFEREN.../i não casa o "Ê" acentuado e o "|" no meio do
  // texto não é tratado como separador. Resultado hoje:
  // "Transferência |maria Oliveira Santos". Correção sugerida: remover
  // acentos antes de aplicar OPERATION_PREFIXES e trocar "|" por espaço.
  it.fails("extrai o nome do formato 'Transferência Enviada|Nome' da Pluggy (BUG: acento e '|')", () => {
    expect(extractPayeeName({ rawDescription: "Transferência Enviada|Maria Oliveira Santos" })).toBe(
      "Maria Oliveira Santos"
    );
  });

  // BUG: estabelecimentos conhecidos casam por substring sem fronteira de
  // palavra — "posto" dentro de "IMPOSTO", "raia" dentro de "PRAIA",
  // "extra" dentro de "EXTRATO" viram estabelecimentos que não são.
  it.fails("não confunde 'IMPOSTO' com o estabelecimento 'Posto' (BUG: substring sem fronteira)", () => {
    expect(extractPayeeName({ rawDescription: "PAGAMENTO IMPOSTO DE RENDA" })).not.toBe("Posto");
  });
});

describe("guessKind", () => {
  it("11 dígitos é pessoa (CPF), 14 é empresa (CNPJ), com ou sem pontuação", () => {
    expect(guessKind({ counterpartyDocument: "123.456.789-09", name: "Ana" })).toBe("pessoa");
    expect(guessKind({ counterpartyDocument: "12.345.678/0001-99", name: "XYZ" })).toBe("empresa");
  });

  it("sem documento, compra em estabelecimento é 'estabelecimento'", () => {
    expect(guessKind({ name: "iFood", isMerchant: true })).toBe("estabelecimento");
  });

  it("documento é mais forte que a pista de merchant; sem pistas é desconhecido", () => {
    expect(guessKind({ counterpartyDocument: "12345678000199", name: "x", isMerchant: true })).toBe("empresa");
    expect(guessKind({ counterpartyDocument: "123", name: "x" })).toBe("desconhecido");
  });
});
