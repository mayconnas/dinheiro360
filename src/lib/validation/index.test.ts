import { describe, expect, it } from "vitest";
import { apiKey, isoDate, modelName, money, parseInput, uuid, uuidList, ValidationError } from "./index";

describe("parseInput", () => {
  it("devolve o valor normalizado quando é válido", () => {
    expect(parseInput(money, 10.456)).toBe(10.46);
    expect(parseInput(modelName, "  jev-1.13.0 ")).toBe("jev-1.13.0");
  });

  it("lança ValidationError com a mensagem em pt-BR e o caminho do campo", () => {
    try {
      parseInput(uuidList(2), ["a"]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as Error).message).toBe("Identificador inválido. (0)");
    }
  });
});

describe("schemas", () => {
  it("uuid aceita só UUID", () => {
    expect(uuid.safeParse("4f8e2c1a-9b3d-4e5f-8a7b-1c2d3e4f5a6b").success).toBe(true);
    expect(uuid.safeParse("1; drop table").success).toBe(false);
  });

  it("uuidList limita o tamanho do lote", () => {
    const ids = Array.from({ length: 3 }, () => "4f8e2c1a-9b3d-4e5f-8a7b-1c2d3e4f5a6b");
    expect(uuidList(2).safeParse(ids).success).toBe(false);
  });

  it("isoDate rejeita datas que não existem no calendário", () => {
    expect(isoDate.safeParse("2026-02-28").success).toBe(true);
    expect(isoDate.safeParse("2026-02-31").success).toBe(false);
    expect(isoDate.safeParse("2026-13-01").success).toBe(false);
    expect(isoDate.safeParse("01/02/2026").success).toBe(false);
  });

  it("money rejeita negativo, infinito e valor acima de numeric(14,2)", () => {
    expect(money.safeParse(-1).success).toBe(false);
    expect(money.safeParse(Infinity).success).toBe(false);
    expect(money.safeParse(1e13).success).toBe(false);
  });

  it("apiKey exige tamanho plausível e nenhum espaço", () => {
    expect(apiKey.safeParse("sk-ant-1234567890").success).toBe(true);
    expect(apiKey.safeParse("curta").success).toBe(false);
    expect(apiKey.safeParse("sk ant 1234567890").success).toBe(false);
  });

  it("modelName transforma vazio em null (volta ao modelo padrão)", () => {
    expect(modelName.parse("")).toBeNull();
    expect(modelName.parse(undefined)).toBeNull();
    expect(modelName.safeParse("modelo com espaço").success).toBe(false);
  });
});
