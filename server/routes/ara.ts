import type { Express } from "express";
import type { IStorage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../lib/config";
import { searchSOPs, type SOPSearchResult } from "../services/sopIndexer";
import { tryResolveStoreIdForUser } from "../services/storeResolver";
import logger from "../lib/logger";

const anthropic = new Anthropic({
  apiKey: config.anthropic.apiKey,
});

const historyMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

const askSchema = z.object({
  question: z.string().min(1).max(2000),
  history: z.array(historyMessageSchema).max(20).optional(),
});

const RAG_TOP_K = 10;
const RAG_MIN_SIMILARITY = 0.25;
const RAG_EXCERPT_CHARS = 900;
const RAG_MAX_EXCERPTS = 6;
const RAG_TOTAL_CONTEXT_CHARS = 6000;

const SOURCE_TYPE_LABELS: Record<string, string> = {
  sop_template: "SOP",
  sop_training_notes: "SOP training notes",
  sop_step: "SOP step",
  ai_item: "Knowledge item",
  knowledge_doc: "Knowledge document",
};

function formatSourceLabel(sourceType: string): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? "Store content";
}

function buildKnowledgeContext(results: SOPSearchResult[]): {
  contextBlock: string;
  used: SOPSearchResult[];
} {
  const filtered = results.filter((r) => r.similarityScore >= RAG_MIN_SIMILARITY);
  if (filtered.length === 0) return { contextBlock: "", used: [] };

  // De-duplicate by templateId so a single doc with many similar chunks doesn't
  // crowd out other relevant sources. Keep the highest-scoring chunk per doc.
  const bestByTemplate = new Map<string, SOPSearchResult>();
  for (const r of filtered) {
    const existing = bestByTemplate.get(r.templateId);
    if (!existing || r.similarityScore > existing.similarityScore) {
      bestByTemplate.set(r.templateId, r);
    }
  }

  const ordered = Array.from(bestByTemplate.values())
    .sort((a, b) => b.similarityScore - a.similarityScore)
    .slice(0, RAG_MAX_EXCERPTS);

  const used: SOPSearchResult[] = [];
  const parts: string[] = [];
  let totalChars = 0;
  for (const r of ordered) {
    const label = formatSourceLabel(r.sourceType);
    const excerpt = r.contentText.slice(0, RAG_EXCERPT_CHARS).trim();
    const block = `[${label}: ${r.templateTitle}]\n${excerpt}`;
    if (totalChars + block.length > RAG_TOTAL_CONTEXT_CHARS && used.length > 0) break;
    parts.push(block);
    used.push(r);
    totalChars += block.length;
  }

  return {
    contextBlock: parts.length > 0 ? `\n\nRelevant store knowledge (use this first, cite by name):\n${parts.join("\n\n---\n\n")}` : "",
    used,
  };
}

export function registerAraRoutes(app: Express, _storage: IStorage, isAuthenticated: any) {
  app.post("/api/ara/ask", isAuthenticated, async (req: any, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid request", errors: parsed.error.errors });
    }

    const { question, history = [] } = parsed.data;
    const userId = req.user?.id;

    try {
      let knowledgeContext = "";
      let usedResults: SOPSearchResult[] = [];

      const storeId = await tryResolveStoreIdForUser(userId);
      if (storeId) {
        try {
          const results = await searchSOPs(storeId, question, RAG_TOP_K);
          const built = buildKnowledgeContext(results);
          knowledgeContext = built.contextBlock;
          usedResults = built.used;
        } catch (ragErr: any) {
          logger.warn({ error: ragErr.message }, "ara: RAG search failed, proceeding without KB context");
        }
      }

      const systemPrompt = `You are Ara, a helpful AI assistant for a retail store team. You answer questions clearly and accurately based on this store's specific procedures, policies, training materials, and uploaded knowledge documents.${knowledgeContext}

Guidelines:
- ALWAYS prefer the store's own knowledge above general retail advice. Quote, paraphrase, or summarize the relevant excerpts when answering.
- When you draw from a specific SOP, training note, or knowledge document, mention it by its exact title in your reply (e.g. "According to the 'Opening Checklist' SOP...").
- If multiple sources are relevant, you may reference more than one.
- If the store's knowledge does not cover the question, say so explicitly ("I don't see this in your store's documented procedures") and then offer general retail best-practice guidance, clearly labeled as such.
- Give direct, actionable answers. Use short paragraphs or bullet points when steps are involved; keep simple answers to 2-4 sentences.
- Be friendly and supportive.
- If the user is asking a follow-up question, use the prior conversation context to give a coherent answer.`;

      // Build the messages array: prior conversation history + the new question.
      // Anthropic requires strict user/assistant alternation starting from user, so defensively
      // normalize the client-supplied history (drop any role that breaks alternation, then drop
      // a trailing user turn so we can append the new question without violating alternation).
      const normalizedHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
      let expected: "user" | "assistant" = "user";
      for (const h of history) {
        if (h.role !== expected) continue;
        normalizedHistory.push(h);
        expected = expected === "user" ? "assistant" : "user";
      }
      if (normalizedHistory.length > 0 && normalizedHistory[normalizedHistory.length - 1].role === "user") {
        normalizedHistory.pop();
      }

      const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...normalizedHistory,
        { role: "user", content: question },
      ];

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-20250514",
        max_tokens: 900,
        system: systemPrompt,
        messages: conversationMessages,
      });

      const answer =
        response.content[0]?.type === "text"
          ? response.content[0].text
          : "I wasn't able to generate an answer. Please try again.";

      logger.info(
        {
          userId,
          storeId,
          questionLength: question.length,
          historyLength: history.length,
          normalizedHistoryLength: normalizedHistory.length,
          ragResultsUsed: usedResults.length,
          ragSourceTypes: Array.from(new Set(usedResults.map((r) => r.sourceType))),
          ragTopScore: usedResults[0]?.similarityScore ?? null,
        },
        "ara: answered question"
      );
      return res.json({ answer });
    } catch (error: any) {
      logger.error({ userId, error: error.message }, "ara: failed to answer question");
      return res.status(500).json({ message: "Failed to get an answer. Please try again." });
    }
  });
}
