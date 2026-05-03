import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { AsyncLocalStorage } from "async_hooks";
import { config } from "./config";
import logger from "./logger";
import {
  recordUsageEvent,
  assertBudgets,
  BudgetExceededError,
} from "../services/aiUsageTracker";
import { costForUsage, type Operation } from "./aiPricing";

/**
 * Per-call metadata propagated through AsyncLocalStorage. Sites that don't
 * call withAiContext still get tracked, but with feature="uncategorized" and
 * isBackground inferred from the request lifecycle (defaults to false).
 */
export interface AiCallContext {
  feature: string;
  operation?: string;
  isBackground?: boolean;
  storeId?: string | null;
  userId?: string | null;
}

const aiContext = new AsyncLocalStorage<AiCallContext>();

export function withAiContext<T>(ctx: AiCallContext, fn: () => Promise<T>): Promise<T> {
  return aiContext.run(ctx, fn);
}

export function getAiContext(): AiCallContext | undefined {
  return aiContext.getStore();
}

export { BudgetExceededError };

// ── Underlying SDK clients ───────────────────────────────────────────────────
const rawAnthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const rawOpenai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

// ── Wrapped clients ──────────────────────────────────────────────────────────

/**
 * Anthropic proxy that intercepts `.messages.create()` to:
 *  1) Pre-flight a budget check (throws BudgetExceededError if any active
 *     budget for the call's storeId is at 100%).
 *  2) Time the call, parse `usage` from the response, compute USD cost from
 *     the model rate sheet, and INSERT one ai_usage_events row.
 *  3) Emit threshold alerts (80% / 100%) once per period via the tracker.
 *
 * Streaming is not currently used in the codebase; if added later, a streaming
 * branch must be added here to capture token totals from the final event.
 */
function createTrackedAnthropic(): Anthropic {
  return new Proxy(rawAnthropic, {
    get(target, prop, receiver) {
      if (prop !== "messages") return Reflect.get(target, prop, receiver);
      const messages = Reflect.get(target, prop, receiver) as Anthropic["messages"];
      return new Proxy(messages, {
        get(mTarget, mProp, mReceiver) {
          if (mProp !== "create") return Reflect.get(mTarget, mProp, mReceiver);
          const create = Reflect.get(mTarget, mProp, mReceiver) as typeof messages.create;
          return async function trackedCreate(this: any, params: any, options?: any) {
            const ctx = getAiContext();
            await assertBudgets(ctx?.storeId ?? null);
            const start = Date.now();
            try {
              const result: any = await create.call(messages, params, options);
              const usage = result?.usage ?? {};
              const inputTokens =
                (usage.input_tokens ?? 0) +
                (usage.cache_creation_input_tokens ?? 0) +
                (usage.cache_read_input_tokens ?? 0);
              const outputTokens = usage.output_tokens ?? 0;
              const model = String(params?.model ?? result?.model ?? "unknown");
              const { costUsd, knownModel } = costForUsage({
                model,
                operation: "chat",
                inputTokens,
                outputTokens,
              });
              if (!knownModel) {
                logger.warn(
                  { model, feature: ctx?.feature ?? "uncategorized" },
                  "AI tracking: unknown Anthropic model, cost recorded as 0",
                );
              }
              await recordUsageEvent({
                provider: "anthropic",
                model,
                operation: "chat",
                feature: ctx?.feature ?? "uncategorized",
                storeId: ctx?.storeId ?? null,
                userId: ctx?.userId ?? null,
                isBackground: ctx?.isBackground ?? false,
                inputTokens,
                outputTokens,
                costUsd,
                latencyMs: Date.now() - start,
                status: "success",
                errorMessage: null,
              });
              return result;
            } catch (err: any) {
              if (err instanceof BudgetExceededError) {
                await recordUsageEvent({
                  provider: "anthropic",
                  model: String(params?.model ?? "unknown"),
                  operation: "chat",
                  feature: ctx?.feature ?? "uncategorized",
                  storeId: ctx?.storeId ?? null,
                  userId: ctx?.userId ?? null,
                  isBackground: ctx?.isBackground ?? false,
                  inputTokens: 0,
                  outputTokens: 0,
                  costUsd: 0,
                  latencyMs: Date.now() - start,
                  status: "blocked",
                  errorMessage: err.message,
                });
                throw err;
              }
              await recordUsageEvent({
                provider: "anthropic",
                model: String(params?.model ?? "unknown"),
                operation: "chat",
                feature: ctx?.feature ?? "uncategorized",
                storeId: ctx?.storeId ?? null,
                userId: ctx?.userId ?? null,
                isBackground: ctx?.isBackground ?? false,
                inputTokens: 0,
                outputTokens: 0,
                costUsd: 0,
                latencyMs: Date.now() - start,
                status: "error",
                errorMessage: String(err?.message ?? err).slice(0, 500),
              });
              throw err;
            }
          };
        },
      });
    },
  }) as Anthropic;
}

/**
 * OpenAI proxy that intercepts:
 *  - .audio.transcriptions.create (logs audioSeconds + cost)
 *  - .chat.completions.create (logs token usage)
 *  - .embeddings.create (logs prompt_tokens)
 * Falls back to passthrough for everything else.
 */
function createTrackedOpenAI(): OpenAI {
  const trackChat = wrapOpenAIChat;
  const trackEmb = wrapOpenAIEmbeddings;
  const trackAudio = wrapOpenAITranscriptions;

  return new Proxy(rawOpenai, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "chat") return trackChat(value);
      if (prop === "embeddings") return trackEmb(value);
      if (prop === "audio") return trackAudio(value);
      return value;
    },
  }) as OpenAI;
}

function wrapOpenAIChat(chat: any): any {
  return new Proxy(chat, {
    get(target, prop, receiver) {
      if (prop !== "completions") return Reflect.get(target, prop, receiver);
      const completions = Reflect.get(target, prop, receiver);
      return new Proxy(completions, {
        get(cTarget, cProp, cReceiver) {
          if (cProp !== "create") return Reflect.get(cTarget, cProp, cReceiver);
          const create = Reflect.get(cTarget, cProp, cReceiver);
          return async function trackedCreate(this: any, params: any, options?: any) {
            return await runTrackedOpenAI("chat", params?.model, async () => {
              const result: any = await create.call(completions, params, options);
              const usage = result?.usage ?? {};
              return {
                result,
                inputTokens: usage.prompt_tokens ?? 0,
                outputTokens: usage.completion_tokens ?? 0,
                audioSeconds: undefined as number | undefined,
              };
            });
          };
        },
      });
    },
  });
}

function wrapOpenAIEmbeddings(embeddings: any): any {
  return new Proxy(embeddings, {
    get(target, prop, receiver) {
      if (prop !== "create") return Reflect.get(target, prop, receiver);
      const create = Reflect.get(target, prop, receiver);
      return async function trackedCreate(this: any, params: any, options?: any) {
        return await runTrackedOpenAI("embedding", params?.model, async () => {
          const result: any = await create.call(embeddings, params, options);
          const usage = result?.usage ?? {};
          return {
            result,
            inputTokens: usage.prompt_tokens ?? usage.total_tokens ?? 0,
            outputTokens: 0,
            audioSeconds: undefined as number | undefined,
          };
        });
      };
    },
  });
}

function wrapOpenAITranscriptions(audio: any): any {
  return new Proxy(audio, {
    get(target, prop, receiver) {
      if (prop !== "transcriptions") return Reflect.get(target, prop, receiver);
      const transcriptions = Reflect.get(target, prop, receiver);
      return new Proxy(transcriptions, {
        get(tTarget, tProp, tReceiver) {
          if (tProp !== "create") return Reflect.get(tTarget, tProp, tReceiver);
          const create = Reflect.get(tTarget, tProp, tReceiver);
          return async function trackedCreate(this: any, params: any, options?: any) {
            return await runTrackedOpenAI("transcription", params?.model, async () => {
              const result: any = await create.call(transcriptions, params, options);
              // gpt-4o-transcribe returns either {text, duration?} or string.
              const audioSeconds =
                typeof result === "object" && result && "duration" in result
                  ? Number((result as any).duration) || undefined
                  : undefined;
              return {
                result,
                inputTokens: 0,
                outputTokens: 0,
                audioSeconds,
              };
            });
          };
        },
      });
    },
  });
}

async function runTrackedOpenAI(
  operation: Operation,
  modelArg: string | undefined,
  exec: () => Promise<{ result: any; inputTokens: number; outputTokens: number; audioSeconds?: number }>,
): Promise<any> {
  const ctx = getAiContext();
  await assertBudgets(ctx?.storeId ?? null);
  const start = Date.now();
  const model = String(modelArg ?? "unknown");
  try {
    const { result, inputTokens, outputTokens, audioSeconds } = await exec();
    const { costUsd, knownModel } = costForUsage({
      model,
      operation,
      inputTokens,
      outputTokens,
      audioSeconds,
    });
    if (!knownModel) {
      logger.warn(
        { model, operation, feature: ctx?.feature ?? "uncategorized" },
        "AI tracking: unknown OpenAI model, cost recorded as 0",
      );
    }
    await recordUsageEvent({
      provider: "openai",
      model,
      operation,
      feature: ctx?.feature ?? "uncategorized",
      storeId: ctx?.storeId ?? null,
      userId: ctx?.userId ?? null,
      isBackground: ctx?.isBackground ?? false,
      inputTokens,
      outputTokens,
      audioSeconds,
      costUsd,
      latencyMs: Date.now() - start,
      status: "success",
      errorMessage: null,
    });
    return result;
  } catch (err: any) {
    if (err instanceof BudgetExceededError) {
      await recordUsageEvent({
        provider: "openai",
        model,
        operation,
        feature: ctx?.feature ?? "uncategorized",
        storeId: ctx?.storeId ?? null,
        userId: ctx?.userId ?? null,
        isBackground: ctx?.isBackground ?? false,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - start,
        status: "blocked",
        errorMessage: err.message,
      });
      throw err;
    }
    await recordUsageEvent({
      provider: "openai",
      model,
      operation,
      feature: ctx?.feature ?? "uncategorized",
      storeId: ctx?.storeId ?? null,
      userId: ctx?.userId ?? null,
      isBackground: ctx?.isBackground ?? false,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      latencyMs: Date.now() - start,
      status: "error",
      errorMessage: String(err?.message ?? err).slice(0, 500),
    });
    throw err;
  }
}

export const anthropic: Anthropic = createTrackedAnthropic();
export const openai: OpenAI = createTrackedOpenAI();

// Re-export the SDK class so files that reference Anthropic.Message types still work.
export { Anthropic, OpenAI };
