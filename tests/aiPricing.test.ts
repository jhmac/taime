import { describe, it, expect } from "vitest";
import { costForUsage, getRateSheet } from "../server/lib/aiPricing";

describe("aiPricing — costForUsage", () => {
  it("prices Claude sonnet-4 chat tokens correctly", () => {
    // 1M input + 1M output = $3 + $15 = $18
    const r = costForUsage({
      model: "claude-sonnet-4-20250514",
      operation: "chat",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(r.knownModel).toBe(true);
    expect(r.costUsd).toBeCloseTo(18, 6);
  });

  it("prices Claude haiku-4 cheaper than sonnet-4 for same usage", () => {
    const haiku = costForUsage({ model: "claude-haiku-4-20250514", operation: "chat", inputTokens: 100_000, outputTokens: 50_000 });
    const sonnet = costForUsage({ model: "claude-sonnet-4-20250514", operation: "chat", inputTokens: 100_000, outputTokens: 50_000 });
    expect(haiku.costUsd).toBeLessThan(sonnet.costUsd);
  });

  it("prices gpt-4o chat correctly: 100k in + 50k out", () => {
    // (100k * 2.5 + 50k * 10) / 1M = 0.25 + 0.5 = 0.75
    const r = costForUsage({
      model: "gpt-4o",
      operation: "chat",
      inputTokens: 100_000,
      outputTokens: 50_000,
    });
    expect(r.costUsd).toBeCloseTo(0.75, 6);
  });

  it("prices transcription per second", () => {
    // 60 seconds * $0.0001 = $0.006
    const r = costForUsage({
      model: "gpt-4o-transcribe",
      operation: "transcription",
      audioSeconds: 60,
    });
    expect(r.knownModel).toBe(true);
    expect(r.costUsd).toBeCloseTo(0.006, 6);
  });

  it("prices embeddings on input tokens only (output rate is 0)", () => {
    const r = costForUsage({
      model: "text-embedding-3-small",
      operation: "embedding",
      inputTokens: 1_000_000,
      outputTokens: 999_999,
    });
    expect(r.costUsd).toBeCloseTo(0.02, 6);
  });

  it("returns knownModel=false and cost=0 for unknown models", () => {
    const r = costForUsage({
      model: "claude-future-9999",
      operation: "chat",
      inputTokens: 1000,
      outputTokens: 1000,
    });
    expect(r.knownModel).toBe(false);
    expect(r.costUsd).toBe(0);
  });

  it("getRateSheet returns chat / audio / image sections", () => {
    const sheet = getRateSheet();
    expect(sheet.chat["claude-sonnet-4-20250514"]).toBeDefined();
    expect(sheet.audio["gpt-4o-transcribe"]).toBeDefined();
    expect(sheet.image["gpt-image-1"]).toBeDefined();
  });
});
