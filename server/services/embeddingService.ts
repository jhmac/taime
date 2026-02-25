import crypto from "crypto";
import logger from "../lib/logger";

let pipeline: any = null;
let pipelineLoading = false;
let pipelineReady = false;

async function getPipeline() {
  if (pipelineReady && pipeline) return pipeline;
  if (pipelineLoading) {
    while (pipelineLoading) {
      await new Promise(r => setTimeout(r, 200));
    }
    return pipeline;
  }

  pipelineLoading = true;
  try {
    const { pipeline: createPipeline } = await import("@xenova/transformers");
    pipeline = await createPipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      quantized: true,
    });
    pipelineReady = true;
    logger.info("[Embeddings] Model loaded: Xenova/all-MiniLM-L6-v2 (384 dimensions)");
  } catch (err: any) {
    logger.error({ error: err.message }, "[Embeddings] Failed to load model");
    pipeline = null;
  } finally {
    pipelineLoading = false;
  }
  return pipeline;
}

const embeddingCache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 500;

export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const hash = contentHash(text);
  const cached = embeddingCache.get(hash);
  if (cached) return cached;

  const start = Date.now();
  try {
    const pipe = await getPipeline();
    if (!pipe) {
      logger.warn("[Embeddings] Pipeline not available, skipping embedding");
      return null;
    }

    const truncated = text.slice(0, 1000);
    const output = await pipe(truncated, { pooling: "mean", normalize: true });
    const embedding = Array.from(output.data as Float32Array) as number[];

    if (embeddingCache.size >= MAX_CACHE_SIZE) {
      const firstKey = embeddingCache.keys().next().value;
      if (firstKey) embeddingCache.delete(firstKey);
    }
    embeddingCache.set(hash, embedding);

    const latency = Date.now() - start;
    if (latency > 2000) {
      logger.warn({ latency }, "[Embeddings] Slow embedding generation");
    }

    return embedding;
  } catch (err: any) {
    logger.error({ error: err.message, latency: Date.now() - start }, "[Embeddings] Generation failed");
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function preloadModel(): Promise<boolean> {
  try {
    const pipe = await getPipeline();
    return !!pipe;
  } catch {
    return false;
  }
}
