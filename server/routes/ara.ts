import type { Express } from "express";
import type { IStorage } from "../storage";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "../lib/config";
import { searchSOPs } from "../services/sopIndexer";
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

      const storeId = await tryResolveStoreIdForUser(userId);
      if (storeId) {
        try {
          const results = await searchSOPs(storeId, question, 5);
          if (results.length > 0) {
            const excerpts = results
              .map((r) => `[${r.templateTitle}]\n${r.contentText.slice(0, 500)}`)
              .join("\n\n---\n\n");
            knowledgeContext = `\n\nRelevant store knowledge:\n${excerpts}`;
          }
        } catch (ragErr: any) {
          logger.warn({ error: ragErr.message }, "ara: RAG search failed, proceeding without KB context");
        }
      }

      const systemPrompt = `You are Ara, a helpful AI assistant for a retail store team. You answer questions clearly and concisely based on store procedures, policies, and best practices.${knowledgeContext}

Guidelines:
- Give direct, actionable answers
- Keep responses concise (2-4 sentences for simple questions, up to a short paragraph for complex ones)
- When you reference a specific procedure or policy from the knowledge base, mention it by name
- If the answer isn't covered in the store's knowledge base, say so and offer general retail best-practice guidance
- Be friendly and supportive
- If the user is asking a follow-up question, use the prior conversation context to give a coherent answer`;

      // Build the messages array: prior conversation history + the new question
      // History should already alternate user/assistant; ensure the last message is the user's new question.
      const conversationMessages: Array<{ role: "user" | "assistant"; content: string }> = [
        ...history,
        { role: "user", content: question },
      ];

      const response = await anthropic.messages.create({
        model: "claude-haiku-4-20250514",
        max_tokens: 512,
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
          ragResults: knowledgeContext ? "yes" : "no",
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
