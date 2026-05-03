import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import {
  companyAiContext,
  generationJobs,
  aiStoreQASessions,
  aiStoreQAMessages,
  sopDocuments,
} from "@shared/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { resolveStoreIdForUser, tryResolveStoreIdForUser } from "../services/storeResolver";
import type { IStorage } from "../storage";
import { runGenerationJob } from "../services/aiLearningGeneration";
import { anthropic, withAiContext } from "../lib/aiClients";
import { config } from "../lib/config";
import logger from "../lib/logger";
import { resolveAnyPermission } from "../services/permissionResolver";

const DEFAULT_MODEL = "claude-sonnet-4-20250514";

async function requireManager(storage: IStorage, userId: string): Promise<void> {
  const isManager = await resolveAnyPermission(userId, ["admin.manage_all", "admin.role_management", "admin.manage_payroll"], storage);
  if (!isManager) {
    throw new AppError(403, "Manager access required", "FORBIDDEN");
  }
}

export function registerAiLearningRoutes(app: Express, storage: IStorage, isAuthenticated: any) {
  // ── Store Context ────────────────────────────────────────────────────────

  app.get("/api/company/ai-context", isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await tryResolveStoreIdForUser(req.user.id);
    const conditions = storeId ? [eq(companyAiContext.storeId, storeId)] : [];
    const [ctx] = await db.select().from(companyAiContext).where(conditions.length > 0 ? and(...conditions) : undefined).limit(1);
    res.json(ctx || null);
  }));

  app.put("/api/company/ai-context", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireManager(storage, req.user.id);

    const storeId = await resolveStoreIdForUser(req.user.id);

    const bodySchema = z.object({
      storeName: z.string().min(1).max(200),
      businessType: z.string().min(1).max(200),
      brandVoice: z.string().max(1000).optional().nullable(),
      teamRoles: z.array(z.string().min(1)).min(1),
      goals: z.array(z.string().min(1)),
    });

    const body = bodySchema.parse(req.body);
    const [existing] = await db.select().from(companyAiContext).where(eq(companyAiContext.storeId, storeId)).limit(1);

    let result;
    if (existing) {
      [result] = await db.update(companyAiContext)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(companyAiContext.id, existing.id))
        .returning();
    } else {
      [result] = await db.insert(companyAiContext).values({ ...body, storeId }).returning();
    }

    res.json(result);
  }));

  // ── Generation Jobs ───────────────────────────────────────────────────────

  app.post("/api/ai/generate", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireManager(storage, req.user.id);

    const storeId = await resolveStoreIdForUser(req.user.id);

    const bodySchema = z.object({
      selectedDocumentIds: z.array(z.string()).min(1, "Select at least one document"),
      outputTypes: z.array(z.enum(["sops", "training"])).min(1, "Select at least one output type"),
      targetRoles: z.array(z.string()).min(1, "Select at least one role"),
      selectedCategories: z.array(z.string()).default([]),
    });

    const body = bodySchema.parse(req.body);

    const [job] = await db.insert(generationJobs).values({
      storeId,
      status: "pending",
      selectedDocumentIds: body.selectedDocumentIds,
      outputTypes: body.outputTypes,
      targetRoles: body.targetRoles,
      selectedCategories: body.selectedCategories,
      progressLog: ["Starting generation..."],
      createdBy: req.user.id,
    }).returning();

    setImmediate(() => {
      runGenerationJob(job.id).catch(err => {
        logger.error({ err: err.message, jobId: job.id }, "Generation job runner crashed");
      });
    });

    res.json({ jobId: job.id, status: "pending" });
  }));

  app.get("/api/ai/generate/:jobId/status", isAuthenticated, asyncHandler(async (req: any, res) => {
    const storeId = await tryResolveStoreIdForUser(req.user.id);
    const whereClause = storeId
      ? and(eq(generationJobs.id, req.params.jobId), eq(generationJobs.storeId, storeId))
      : eq(generationJobs.id, req.params.jobId);
    const [job] = await db.select().from(generationJobs).where(whereClause);
    if (!job) throw new AppError(404, "Job not found", "NOT_FOUND");

    res.json({
      jobId: job.id,
      status: job.status,
      progressLog: (job.progressLog as string[]) || [],
      resultsJson: job.status === "complete" ? job.resultsJson : null,
    });
  }));

  // ── Draft SOPs – save & publish ───────────────────────────────────────────

  app.post("/api/ai/generate/:jobId/publish-sop", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireManager(storage, req.user.id);

    const storeId = await tryResolveStoreIdForUser(req.user.id);

    const bodySchema = z.object({
      sopIndex: z.number().int().min(0),
      categoryId: z.string().min(1),
    });

    const { sopIndex, categoryId } = bodySchema.parse(req.body);
    const whereClause = storeId
      ? and(eq(generationJobs.id, req.params.jobId), eq(generationJobs.storeId, storeId))
      : eq(generationJobs.id, req.params.jobId);
    const [job] = await db.select().from(generationJobs).where(whereClause);
    if (!job || job.status !== "complete") throw new AppError(400, "Job not complete", "BAD_REQUEST");

    const results = job.resultsJson as any;
    const sop = results?.sops?.[sopIndex];
    if (!sop) throw new AppError(404, "SOP draft not found", "NOT_FOUND");

    const stepsText = sop.steps.map((s: any, i: number) => {
      let text = `**Step ${i + 1}: ${s.title}**\n${s.description}`;
      if (s.decisionOptions && s.decisionOptions.length > 0) {
        text += "\n" + s.decisionOptions.map((d: any) => `- ${d.condition} → ${d.action}`).join("\n");
      }
      return text;
    }).join("\n\n");

    const doc = await storage.createSopDocument({
      categoryId,
      title: sop.title,
      content: `# ${sop.title}\n\n**Role:** ${sop.role}\n\n## Steps\n\n${stepsText}`,
      summary: `AI-generated SOP for ${sop.role}. Source: ${sop.sourceDocumentTitle || "Knowledge base"}`,
      tags: [sop.category, sop.role, "ai-generated"],
      isPublished: true,
      updatedBy: req.user.id,
    });

    res.json({ success: true, document: doc });
  }));

  app.post("/api/ai/generate/:jobId/publish-training", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireManager(storage, req.user.id);

    const storeId = await tryResolveStoreIdForUser(req.user.id);

    const bodySchema = z.object({
      moduleIndex: z.number().int().min(0),
    });

    const { moduleIndex } = bodySchema.parse(req.body);
    const whereClause = storeId
      ? and(eq(generationJobs.id, req.params.jobId), eq(generationJobs.storeId, storeId))
      : eq(generationJobs.id, req.params.jobId);
    const [job] = await db.select().from(generationJobs).where(whereClause);
    if (!job || job.status !== "complete") throw new AppError(400, "Job not complete", "BAD_REQUEST");

    const results = job.resultsJson as any;
    const mod = results?.trainingModules?.[moduleIndex];
    if (!mod) throw new AppError(404, "Training module draft not found", "NOT_FOUND");

    const exerciseText = mod.exercises && mod.exercises.length > 0
      ? "\n\n## Practice Exercises\n\n" + mod.exercises.map((e: any, i: number) =>
          `**Exercise ${i + 1}:** ${e.scenario}\n*Question:* ${e.question}\n*Guidance:* ${e.guidance}`
        ).join("\n\n")
      : "";

    const objectivesText = mod.objectives && mod.objectives.length > 0
      ? "\n\n## Learning Objectives\n" + mod.objectives.map((o: string) => `- ${o}`).join("\n")
      : "";

    const module = await storage.createTrainingModule({
      ...(storeId ? { storeId } : {}),
      title: mod.title,
      description: `Training for ${mod.role}. Source: ${mod.sourceDocumentTitle || "Knowledge base"}`,
      content: `# ${mod.title}${objectivesText}\n\n${mod.content}${exerciseText}`,
      category: "custom",
      estimatedMinutes: mod.estimatedMinutes || 20,
      isActive: true,
      isRequired: false,
    });

    res.json({ success: true, module });
  }));

  // ── Store Q&A ─────────────────────────────────────────────────────────────

  app.get("/api/ai/ask/sessions", isAuthenticated, asyncHandler(async (req: any, res) => {
    const sessions = await db.select()
      .from(aiStoreQASessions)
      .where(eq(aiStoreQASessions.userId, req.user.id))
      .orderBy(desc(aiStoreQASessions.updatedAt))
      .limit(20);
    res.json(sessions);
  }));

  app.post("/api/ai/ask/sessions", isAuthenticated, asyncHandler(async (req: any, res) => {
    const [session] = await db.insert(aiStoreQASessions).values({
      userId: req.user.id,
      title: "Store Q&A",
    }).returning();
    res.json(session);
  }));

  app.get("/api/ai/ask/sessions/:sessionId/messages", isAuthenticated, asyncHandler(async (req: any, res) => {
    const [session] = await db.select().from(aiStoreQASessions)
      .where(eq(aiStoreQASessions.id, req.params.sessionId));
    if (!session || session.userId !== req.user.id) {
      throw new AppError(403, "Access denied", "FORBIDDEN");
    }
    const messages = await db.select().from(aiStoreQAMessages)
      .where(eq(aiStoreQAMessages.sessionId, req.params.sessionId))
      .orderBy(aiStoreQAMessages.createdAt);
    res.json(messages);
  }));

  app.post("/api/ai/ask", isAuthenticated, asyncHandler(async (req: any, res) => {
    const bodySchema = z.object({
      questionText: z.string().min(1).max(2000),
      sessionId: z.string().optional(),
    });

    const { questionText, sessionId } = bodySchema.parse(req.body);

    let activeSessionId = sessionId;
    if (!activeSessionId) {
      const [newSession] = await db.insert(aiStoreQASessions).values({
        userId: req.user.id,
        title: questionText.substring(0, 60),
      }).returning();
      activeSessionId = newSession.id;
    } else {
      const [existing] = await db.select().from(aiStoreQASessions)
        .where(eq(aiStoreQASessions.id, activeSessionId));
      if (!existing || existing.userId !== req.user.id) {
        throw new AppError(403, "Access denied", "FORBIDDEN");
      }
    }

    await db.insert(aiStoreQAMessages).values({
      sessionId: activeSessionId,
      role: "user",
      content: questionText,
    });

    const allDocs = await db.select().from(sopDocuments).where(eq(sopDocuments.isPublished, true));

    const [ctx] = await db.select().from(companyAiContext).limit(1);
    const storeName = ctx?.storeName || "Our Store";

    const knowledgeContext = allDocs.length > 0
      ? allDocs.map(d => `### ${d.title}\n${d.content}`).join("\n\n---\n\n")
      : "No knowledge base documents are available yet.";

    const previousMessages = await db.select()
      .from(aiStoreQAMessages)
      .where(eq(aiStoreQAMessages.sessionId, activeSessionId))
      .orderBy(aiStoreQAMessages.createdAt);

    const chatHistory = previousMessages
      .slice(-10)
      .filter(m => m.role === "user" || m.role === "assistant")
      .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

    const systemPrompt = `You are the Store AI for "${storeName}". You help team members by answering questions about store operations, policies, products, and selling techniques.

CRITICAL RULES:
- Answer ONLY from the knowledge base documents provided below
- If the answer is not in the documents, say clearly: "I don't have information about that in our knowledge base. Please check with your manager."
- Always cite which document your answer comes from using this format: [From: Document Title]
- Be conversational, helpful, and specific
- Use the store's own language, scripts, and terminology from the documents

KNOWLEDGE BASE:
${knowledgeContext}`;

    const response = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: chatHistory,
    });

    const answerText = response.content[0].type === "text"
      ? response.content[0].text
      : "I'm sorry, I had trouble generating a response. Please try again.";

    const citedDocs = allDocs
      .filter(d => answerText.toLowerCase().includes(d.title.toLowerCase()))
      .map(d => d.id);

    const [savedMsg] = await db.insert(aiStoreQAMessages).values({
      sessionId: activeSessionId,
      role: "assistant",
      content: answerText,
      sourceDocumentIds: citedDocs,
    }).returning();

    await db.update(aiStoreQASessions)
      .set({ updatedAt: new Date() })
      .where(eq(aiStoreQASessions.id, activeSessionId));

    res.json({
      sessionId: activeSessionId,
      message: answerText,
      messageId: savedMsg.id,
      sourceDocumentIds: citedDocs,
    });
  }));

  // ── Q&A Analytics (manager only) ─────────────────────────────────────────

  app.get("/api/ai/ask/analytics", isAuthenticated, asyncHandler(async (req: any, res) => {
    await requireManager(storage, req.user.id);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentMessages = await db.select()
      .from(aiStoreQAMessages)
      .where(eq(aiStoreQAMessages.role, "user"));

    const questionCounts: Record<string, number> = {};
    for (const msg of recentMessages) {
      const q = msg.content.toLowerCase().trim();
      const key = q.length > 80 ? q.substring(0, 80) + "..." : q;
      questionCounts[key] = (questionCounts[key] || 0) + 1;
    }

    const topQuestions = Object.entries(questionCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([question, count]) => ({ question, count }));

    res.json({
      topQuestions,
      totalQuestions: recentMessages.length,
      period: "Last 30 days",
    });
  }));
}
