// ─────────────────────────────────────────────────────────────
// Camada 4 — TypeSafe Jev: constantes e tipos (client-safe).
//
// O Jev é um modelo "System One" da TypeSafe (docs.typesafe.ai): não
// gera texto, só responde perguntas tipadas. Para categorizar usamos
// uma pergunta Choice por lançamento — as opções são as categorias do
// usuário do mesmo kind (receita p/ entrada, despesa p/ saída) e a
// resposta traz a opção escolhida, a probabilidade de cada opção e a
// confiança (0–1, derivada do formato da distribuição).
//
// Tudo que é "ajustável" (limiares, lotes, modelo) fica AQUI, num lugar
// só, como a própria TypeSafe recomenda: são essas constantes que um
// humano precisa revisar ao calibrar a integração.
//
// Sem `server-only`: a UI importa os tipos, limiares e rótulos.
// ─────────────────────────────────────────────────────────────

/** Alias estável do modelo flagship. Pode ser trocado por um id fixo (ex "jev-1.13.0") nas configurações. */
export const JEV_DEFAULT_MODEL = "jev-latest";

/**
 * Faixas de confiança (Choice.confidence). A TypeSafe sugere três
 * caminhos: alta = agir, média = pedir confirmação, baixa = não agir.
 * Na tela de revisão isso vira: alta e média já vêm marcadas para
 * aplicar (o próprio diálogo é a confirmação), baixa vem desmarcada.
 */
export const JEV_CONFIDENCE_HIGH = 0.7;
export const JEV_CONFIDENCE_LOW = 0.4;

/**
 * Lançamentos por chamada da server action (o client itera em lotes para
 * mostrar progresso e permitir cancelar). Lote pequeno = "Parar" responde
 * rápido: o lote em andamento sempre termina, e as server actions do
 * Next rodam em fila, então um lote longo seguraria as outras ações da tela.
 */
export const JEV_CLIENT_BATCH_SIZE = 12;
/** Teto de ids aceitos por chamada no servidor (defesa contra payload abusivo). */
export const JEV_MAX_IDS_PER_CALL = 60;
/** Requisições simultâneas à TypeSafe por chamada (limite da conta: 1.200 req/min). */
export const JEV_CONCURRENCY = 6;
/** Exemplos do histórico do usuário anexados a cada categoria (few-shot via criteria). */
export const JEV_EXAMPLES_PER_CATEGORY = 6;
/** Limite de opções de uma pergunta Choice na API (inclui a opção "nenhuma"). */
export const JEV_MAX_CHOICE_OPTIONS = 255;

export type JevTier = "alta" | "media" | "baixa" | "nenhuma";

export const JEV_TIER_LABELS: Record<JevTier, string> = {
  alta: "Alta confiança",
  media: "Média confiança",
  baixa: "Baixa confiança",
  nenhuma: "Sem categoria adequada",
};

export function tierFor(confidence: number, hasCategory: boolean): JevTier {
  if (!hasCategory) return "nenhuma";
  if (confidence >= JEV_CONFIDENCE_HIGH) return "alta";
  if (confidence >= JEV_CONFIDENCE_LOW) return "media";
  return "baixa";
}

/** Uma alternativa considerada pelo Jev (outra categoria com probabilidade relevante). */
export interface JevAlternative {
  categoryId: string;
  probability: number;
}

/** Decisão do Jev para UM lançamento. */
export interface JevDecision {
  transactionId: string;
  /** Categoria escolhida; null = o Jev escolheu "nenhuma categoria se encaixa" (ou falhou). */
  categoryId: string | null;
  /** Probabilidade da opção escolhida (0–1). */
  probability: number;
  /** Confiança da resposta (0–1), calculada pela TypeSafe a partir da distribuição. */
  confidence: number;
  tier: JevTier;
  /** Até 3 outras categorias com probabilidade ≥ 5%, da mais provável para a menos. */
  alternatives: JevAlternative[];
  /** Preenchido quando a chamada deste lançamento falhou (os demais seguem normalmente). */
  error?: string;
}

export interface JevCategorizeResult {
  ok: boolean;
  error?: string;
  decisions: JevDecision[];
  /** Lançamentos que não foram enviados (ex: sem categorias daquele tipo), com o motivo. */
  skipped: { transactionId: string; reason: string }[];
  /** Id versionado do modelo que respondeu (ex "jev-1.13.0"). */
  model?: string;
  /** Requisições efetivamente feitas (lançamentos idênticos compartilham uma). */
  requests: number;
  inputTokens: number;
}

/** Status (mascarado) da integração para a tela de Configurações e para a de Transações. */
export interface JevStatus {
  configured: boolean;
  /** "user" = chave própria salva; "env" = TYPESAFE_API_KEY do servidor. */
  source: "user" | "env" | null;
  maskedKey: string | null;
  /** Modelo salvo pelo usuário (null = não definido; usa `defaultModel`). */
  model: string | null;
  /** Modelo usado quando o usuário não define um: TYPESAFE_MODEL do servidor ou JEV_DEFAULT_MODEL. */
  defaultModel: string;
}

/** Uma decisão confirmada no diálogo, para applyJevDecisions. */
export interface JevApplyAssignment {
  id: string;
  categoryId: string;
  /**
   * Pode virar regra aprendida? O client só marca quando a escolha é
   * sólida (alta confiança ou correção do usuário) e consistente com os
   * outros lançamentos de mesma descrição no lote. O servidor ainda
   * aplica os próprios filtros — este campo só pode RESTRINGIR.
   */
  learn?: boolean;
}
