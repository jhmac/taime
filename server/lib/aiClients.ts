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

// ── Generic tracking helper ──────────────────────────────────────────────────
//
// Every tracked call goes through `runTracked`, which:
//   1) Reads ambient AiCallContext (feature/store/user/background) from ALS.
//   2) Pre-flights `assertBudgets` — throws BudgetExceededError on hard-cap.
//   3) Times the call, runs the supplied `exec` to get the result + usage.
//   4) Computes USD cost from the static rate sheet and records ONE
//      ai_usage_events row (status = success | blocked | error).
//   5) Re-throws the original error so callers see normal SDK semantics.
//
// All three openai branches and the anthropic branch funnel through this so
// behavior is identical and there's a single place to evolve.

interface UsageBundle {
  result: any;
  inputTokens: number;
  outputTokens: number;
  audioSeconds?: number;
}

async function runTracked(
  provider: "anthropic" | "openai",
  operation: Operation,
  modelArg: string | undefined,
  exec: () => Promise<UsageBundle>,
): Promise<any> {
  const ctx = getAiContext();
  const feature = ctx?.feature ?? "uncategorized";
  const baseRow = {
    provider,
    operation,
    feature,
    storeId: ctx?.storeId ?? null,
    userId: ctx?.userId ?? null,
    isBackground: ctx?.isBackground ?? false,
  } as const;

  await assertBudgets(ctx?.storeId ?? null).catch((err) => {
    if (err instanceof BudgetExceededError) {
      // Log a blocked attempt before re-throwing so admins can see hits.
      void recordUsageEvent({
        ...baseRow,
        model: String(modelArg ?? "unknown"),
        inputTokens: 0,
        outputTokens: 0,
        costUsd: "0",
        latencyMs: 0,
        status: "blocked",
        errorMessage: err.message,
      });
    }
    throw err;
  });

  const start = Date.now();
  const model = String(modelArg ?? "unknown");
  try {
    const { result, inputTokens, outputTokens, audioSeconds } = await exec();
    const resolvedModel = model === "unknown" ? String(result?.model ?? "unknown") : model;
    const { costUsd, knownModel } = costForUsage({
      model: resolvedModel,
      operation,
      inputTokens,
      outputTokens,
      audioSeconds,
    });
    if (!knownModel) {
      logger.warn(
        { provider, model: resolvedModel, operation, feature },
        "AI tracking: unknown model, cost recorded as 0",
      );
    }
    await recordUsageEvent({
      ...baseRow,
      model: resolvedModel,
      inputTokens,
      outputTokens,
      audioSeconds: audioSeconds != null ? String(audioSeconds) : null,
      costUsd: String(costUsd),
      latencyMs: Date.now() - start,
      status: "success",
      errorMessage: null,
    });
    return result;
  } catch (err: any) {
    await recordUsageEvent({
      ...baseRow,
      model,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: "0",
      latencyMs: Date.now() - start,
      status: "error",
      errorMessage: String(err?.message ?? err).slice(0, 500),
    });
    throw err;
  }
}

// ── Anthropic proxy ──────────────────────────────────────────────────────────
//
// Streaming is not currently used in this codebase; if added later, the
// streaming branch must capture token totals from the final event.
function createTrackedAnthropic(): Anthropic {
  return new Proxy(rawAnthropic, {
    get(target, prop, receiver) {
      if (prop !== "messages") return Reflect.get(target, prop, receiver);
      const messages = Reflect.get(target, prop, receiver) as Anthropic["messages"];
      return new Proxy(messages, {
        get(mTarget, mProp, mReceiver) {
          if (mProp !== "create") return Reflect.get(mTarget, mProp, mReceiver);
          const create = Reflect.get(mTarget, mProp, mReceiver) as typeof messages.create;
          return (params: any, options?: any) =>
            runTracked("anthropic", "chat", params?.model, async () => {
              const result: any = await create.call(messages, params, options);
              const u = result?.usage ?? {};
              return {
                result,
                inputTokens:
                  (u.input_tokens ?? 0) +
                  (u.cache_creation_input_tokens ?? 0) +
                  (u.cache_read_input_tokens ?? 0),
                outputTokens: u.output_tokens ?? 0,
              };
            });
        },
      });
    },
  }) as Anthropic;
}

// ── OpenAI proxy ─────────────────────────────────────────────────────────────
//
// Intercepts:
//   - chat.completions.create  → operation="chat" (prompt/completion tokens)
//   - embeddings.create        → operation="embedding" (prompt tokens)
//   - audio.transcriptions.create → operation="transcription" (audio seconds)
// Everything else passes through untouched.
function createTrackedOpenAI(): OpenAI {
  return new Proxy(rawOpenai, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (prop === "chat") return wrapOpenAIChat(value);
      if (prop === "embeddings") return wrapOpenAIEmbeddings(value);
      if (prop === "audio") return wrapOpenAIAudio(value);
      return value;
    },
  }) as OpenAI;
}

function wrapMethod(
  parent: any,
  childKey: string,
  methodKey: string,
  build: (raw: Function) => (...args: any[]) => Promise<any>,
): any {
  return new Proxy(parent, {
    get(t, p, r) {
      if (p !== childKey) return Reflect.get(t, p, r);
      const child = Reflect.get(t, p, r);
      return new Proxy(child, {
        get(t2, p2, r2) {
          if (p2 !== methodKey) return Reflect.get(t2, p2, r2);
          const fn = Reflect.get(t2, p2, r2) as Function;
          return build(fn.bind(child));
        },
      });
    },
  });
}

function wrapOpenAIChat(chat: any): any {
  return wrapMethod(chat, "completions", "create", (create) =>
    (params: any, options?: any) =>
      runTracked("openai", "chat", params?.model, async () => {
        const result: any = await create(params, options);
        const u = result?.usage ?? {};
        return { result, inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 };
      }),
  );
}

function wrapOpenAIEmbeddings(embeddings: any): any {
  return new Proxy(embeddings, {
    get(t, p, r) {
      if (p !== "create") return Reflect.get(t, p, r);
      const create = (Reflect.get(t, p, r) as Function).bind(embeddings);
      return (params: any, options?: any) =>
        runTracked("openai", "embedding", params?.model, async () => {
          const result: any = await create(params, options);
          const u = result?.usage ?? {};
          return {
            result,
            inputTokens: u.prompt_tokens ?? u.total_tokens ?? 0,
            outputTokens: 0,
          };
        });
    },
  });
}

function wrapOpenAIAudio(audio: any): any {
  return wrapMethod(audio, "transcriptions", "create", (create) =>
    (params: any, options?: any) =>
      runTracked("openai", "transcription", params?.model, async () => {
        const result: any = await create(params, options);
        // gpt-4o-transcribe returns {text, duration?} (object) or a string.
        const audioSeconds =
          typeof result === "object" && result && "duration" in result
            ? Number((result as any).duration) || undefined
            : undefined;
        return { result, inputTokens: 0, outputTokens: 0, audioSeconds };
      }),
  );
}

export const anthropic: Anthropic = createTrackedAnthropic();
export const openai: OpenAI = createTrackedOpenAI();

// Re-export the SDK class so files that reference Anthropic.Message types still work.
export { Anthropic, OpenAI };
