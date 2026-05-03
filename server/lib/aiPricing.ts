// Hardcoded provider rates. Update when providers change pricing.
// All token rates are in USD per 1,000,000 tokens.
// Audio rates are in USD per second of input audio.

type ChatPrice = { input: number; output: number };
type AudioPrice = { perSecond: number };
type ImagePrice = { perImage: number };

const CHAT_PRICES: Record<string, ChatPrice> = {
  // Anthropic Claude (per 1M tokens)
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-20250514": { input: 0.8, output: 4.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
  "claude-3-5-sonnet-20241022": { input: 3.0, output: 15.0 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4.0 },

  // OpenAI chat (per 1M tokens)
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },

  // Embeddings (per 1M tokens, output cost is 0)
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "text-embedding-ada-002": { input: 0.1, output: 0 },
};

const AUDIO_PRICES: Record<string, AudioPrice> = {
  // gpt-4o-transcribe: $0.006/min = $0.0001/sec
  "gpt-4o-transcribe": { perSecond: 0.0001 },
  "gpt-4o-mini-transcribe": { perSecond: 0.00005 },
  "whisper-1": { perSecond: 0.0001 },
};

const IMAGE_PRICES: Record<string, ImagePrice> = {
  "gpt-image-1": { perImage: 0.04 },
  "dall-e-3": { perImage: 0.04 },
};

export type Operation = "chat" | "embedding" | "transcription" | "image";

export interface UsageInputs {
  model: string;
  operation: Operation;
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  imageCount?: number;
}

export interface PriceResult {
  costUsd: number;
  knownModel: boolean;
}

/** Compute the USD cost for one call. Returns 0 with knownModel=false if model isn't priced. */
export function costForUsage(inputs: UsageInputs): PriceResult {
  const { model, operation } = inputs;

  if (operation === "chat" || operation === "embedding") {
    const p = CHAT_PRICES[model];
    if (!p) return { costUsd: 0, knownModel: false };
    const inputCost = ((inputs.inputTokens ?? 0) / 1_000_000) * p.input;
    const outputCost = ((inputs.outputTokens ?? 0) / 1_000_000) * p.output;
    return { costUsd: round6(inputCost + outputCost), knownModel: true };
  }

  if (operation === "transcription") {
    const p = AUDIO_PRICES[model];
    if (!p) return { costUsd: 0, knownModel: false };
    return { costUsd: round6((inputs.audioSeconds ?? 0) * p.perSecond), knownModel: true };
  }

  if (operation === "image") {
    const p = IMAGE_PRICES[model];
    if (!p) return { costUsd: 0, knownModel: false };
    return { costUsd: round6((inputs.imageCount ?? 1) * p.perImage), knownModel: true };
  }

  return { costUsd: 0, knownModel: false };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Exposed for the admin UI ("Known model rate sheet"). */
export function getRateSheet() {
  return {
    chat: CHAT_PRICES,
    audio: AUDIO_PRICES,
    image: IMAGE_PRICES,
  };
}
