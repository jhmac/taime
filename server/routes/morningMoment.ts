import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import { db } from "../db";
import { clockEvents, performanceScoreSettings, knowledgeDocuments } from "@shared/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { anthropic, withAiContext } from "../lib/aiClients";
import { resolveStoreId } from "../services/storeResolver";

const MORNING_MOMENT_POINTS = 10;

async function awardMomentPoints(userId: string): Promise<number> {
  const [setting] = await db.select().from(performanceScoreSettings).where(eq(performanceScoreSettings.eventType, "training-morning-moment")).limit(1);
  const points = setting?.isActive ? setting.pointValue : MORNING_MOMENT_POINTS;
  if (points > 0) {
    await db.insert(clockEvents).values({ userId, eventType: "training-morning-moment", pointValue: points, metadata: null });
  }
  return points;
}

async function generateMorningMoment(knowledgeTexts: string[], dayOfWeek: string): Promise<{
  tipText: string;
  quizQuestion: string;
  quizChoices: string[];
  quizCorrectIndex: number;
  quizContext: string;
}> {
  const knowledgeSnippet = knowledgeTexts.slice(0, 3).map((t, i) => `[Doc ${i + 1}]: ${t.substring(0, 600)}`).join("\n\n");
  const prompt = `You are an expert retail boutique training coach. Today is ${dayOfWeek}.

Based on the following store knowledge base excerpts, generate a brief "Learning Moment" for the team morning huddle.

${knowledgeSnippet || "General retail boutique best practices: greet every customer warmly, listen actively, suggest complementary items, use the store's signature sales script."}

Return ONLY a valid JSON object with this structure:
{
  "tipText": "A single short tip or technique (2-3 sentences max)",
  "quizQuestion": "A multiple-choice quiz question testing this tip",
  "quizChoices": ["Option A", "Option B", "Option C", "Option D"],
  "quizCorrectIndex": 0,
  "quizContext": "Brief explanation of why the correct answer is right (for manager context)"
}`;

  const message = await anthropic.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 600,
    messages: [{ role: "user", content: prompt }],
  });

  const text = message.content[0].type === "text" ? message.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Failed to parse AI response");

  return JSON.parse(jsonMatch[0]);
}

export function registerMorningMomentRoutes(app: Express, storage: IStorage, isAuthenticated: any) {

  // ── GET today's learning moment ──────────────────────────────────────────────
  app.get("/api/ai/morning-moment", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.id;
      const storeId = await resolveStoreId() || "default";
      const today = new Date().toISOString().split("T")[0];

      let moment = await storage.getMorningLearningMoment(storeId, today);

      if (!moment) {
        const docs = await storage.getKnowledgeDocuments(storeId);
        const readyDocs = docs.filter(d => d.processingStatus === "ready" && d.extractedText);
        const knowledgeTexts = readyDocs.map(d => d.extractedText ?? "");

        const dayOfWeek = new Date().toLocaleDateString("en-US", { weekday: "long" });
        const generated = await generateMorningMoment(knowledgeTexts, dayOfWeek);

        moment = await storage.upsertMorningLearningMoment({
          storeId,
          momentDate: today,
          tipText: generated.tipText,
          quizQuestion: generated.quizQuestion,
          quizChoices: generated.quizChoices,
          quizCorrectIndex: generated.quizCorrectIndex,
          quizContext: generated.quizContext,
        });
      }

      const userWithRole = await storage.getUserWithRole(userId);
      const isManager = ["admin", "owner", "manager"].includes(userWithRole?.role?.name ?? "");

      // Check if this user already answered today
      const existingAnswer = await storage.getMorningMomentAnswer(moment.id, userId);

      const response: Record<string, unknown> = {
        id: moment.id,
        tipText: moment.tipText,
        quizQuestion: moment.quizQuestion,
        quizChoices: moment.quizChoices,
        quizCorrectIndex: isManager ? moment.quizCorrectIndex : undefined,
        quizContext: isManager ? moment.quizContext : undefined,
        alreadyAnswered: !!existingAnswer,
        isCorrect: existingAnswer?.isCorrect ?? null,
        selectedIndex: existingAnswer?.selectedIndex ?? null,
      };

      res.json({ success: true, data: response });
    } catch (err: any) {
      console.error("[MorningMoment] Error:", err.message);
      res.status(500).json({ message: err.message });
    }
  });

  // ── POST answer a morning moment quiz ────────────────────────────────────────
  app.post("/api/ai/morning-moment/answer", isAuthenticated, async (req: any, res: Response) => {
    try {
      const userId = req.user.id;
      const storeId = await resolveStoreId() || "default";
      const today = new Date().toISOString().split("T")[0];

      const schema = z.object({ selectedIndex: z.number().int().min(0) });
      const { selectedIndex } = schema.parse(req.body);

      const moment = await storage.getMorningLearningMoment(storeId, today);
      if (!moment) return res.status(404).json({ message: "No learning moment for today" });

      const existingAnswer = await storage.getMorningMomentAnswer(moment.id, userId);
      if (existingAnswer) return res.status(409).json({ message: "Already answered today's learning moment" });

      const isCorrect = selectedIndex === moment.quizCorrectIndex;
      let pointsAwarded = 0;
      if (isCorrect) {
        pointsAwarded = await awardMomentPoints(userId);
      }

      const answer = await storage.recordMorningMomentAnswer({
        momentId: moment.id,
        employeeId: userId,
        selectedIndex,
        isCorrect,
        pointsAwarded,
      });

      res.json({
        success: true,
        data: {
          isCorrect,
          correctAnswerIndex: moment.quizCorrectIndex,
          quizContext: moment.quizContext,
          pointsAwarded,
        },
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });
}
