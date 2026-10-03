import { describe, expect, it } from "vitest";
import {
  JEV_CLIENT_BATCH_SIZE,
  JEV_CONFIDENCE_HIGH,
  JEV_CONFIDENCE_LOW,
  JEV_MAX_CHOICE_OPTIONS,
  JEV_MAX_IDS_PER_CALL,
  JEV_TIER_LABELS,
  tierFor,
} from "./config";

describe("tierFor (faixas de confiança do Jev)", () => {
  it("alta a partir de 0,7 (inclusive)", () => {
    expect(tierFor(JEV_CONFIDENCE_HIGH, true)).toBe("alta");
    expect(tierFor(0.95, true)).toBe("alta");
  });

  it("média entre 0,4 (inclusive) e 0,7", () => {
    expect(tierFor(0.69, true)).toBe("media");
    expect(tierFor(JEV_CONFIDENCE_LOW, true)).toBe("media");
  });

  it("baixa abaixo de 0,4", () => {
    expect(tierFor(0.39, true)).toBe("baixa");
    expect(tierFor(0, true)).toBe("baixa");
  });

  it("sem categoria escolhida é 'nenhuma', qualquer que seja a confiança", () => {
    expect(tierFor(0.99, false)).toBe("nenhuma");
  });

  it("toda faixa tem rótulo em pt-BR para a UI", () => {
    expect(JEV_TIER_LABELS).toEqual({
      alta: "Alta confiança",
      media: "Média confiança",
      baixa: "Baixa confiança",
      nenhuma: "Sem categoria adequada",
    });
  });
});

describe("constantes de calibração", () => {
  it("são coerentes entre si", () => {
    expect(JEV_CONFIDENCE_LOW).toBeLessThan(JEV_CONFIDENCE_HIGH);
    expect(JEV_CLIENT_BATCH_SIZE).toBeLessThanOrEqual(JEV_MAX_IDS_PER_CALL);
    expect(JEV_MAX_CHOICE_OPTIONS).toBe(255);
  });
});
