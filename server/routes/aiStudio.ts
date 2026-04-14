import type { Express } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { db } from "../db";
import {
  aiGeneratedItems,
  generationJobs,
  sopDocuments,
  sopCategories,
  trainingModules,
  knowledgeDocuments,
  companyAiContext,
  tasks,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { resolveStoreId } from "../lib/storeResolver";
import type { IStorage } from "../storage";
import type { InsertSopDocument, InsertTask } from "@shared/schema";
import { processKnowledgeDocument } from "../services/knowledgeExtractor";
import { runAiStudioGenerationJob } from "../services/aiStudioGeneration";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config";
import logger from "../lib/logger";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "knowledge");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
];
const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".jpg", ".jpeg", ".png"];

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (SUPPORTED_MIME_TYPES.includes(file.mimetype) || SUPPORTED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Please upload PDF, DOCX, TXT, JPG, or PNG files."));
    }
  },
});

type ImageMediaType = "image/jpeg" | "image/png";

async function extractFromFile(
  filePath: string,
  mimeType: string,
  originalName: string
): Promise<{ rawText: string; imageBase64?: string; imageMimeType?: ImageMediaType }> {
  const ext = path.extname(originalName).toLowerCase();

  if (mimeType === "text/plain" || ext === ".txt") {
    return { rawText: fs.readFileSync(filePath, "utf-8") };
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return { rawText: result.value };
  }

  if (mimeType === "application/pdf" || ext === ".pdf") {
    const buffer = fs.readFileSync(filePath);
    let textFromPdfParse = "";

    // Try pdf-parse first (fast, works for text-based PDFs)
    try {
      const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;
      const data = await pdfParse(buffer);
      textFromPdfParse = (data.text || "").trim();
    } catch (pdfErr: unknown) {
      const msg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
      console.warn(`[aiStudio] pdf-parse failed for "${originalName}", falling back to Claude: ${msg}`);
    }

    // If we got meaningful text, use it
    if (textFromPdfParse.length > 50) {
      return { rawText: textFromPdfParse };
    }

    // Fallback: send PDF to Claude's document API (handles scanned/image PDFs, bad XRef, etc.)
    try {
      const base64Pdf = buffer.toString("base64");
      const response = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64Pdf,
                },
              } as any,
              {
                type: "text",
                text: "Extract and return ALL text content from this document. Output only the extracted text, preserving structure and formatting. Do not add any commentary.",
              },
            ],
          },
        ],
      });
      const extracted = response.content
        .filter((c) => c.type === "text")
        .map((c) => (c as any).text)
        .join("\n");
      return { rawText: extracted };
    } catch (claudeErr: unknown) {
      const msg = claudeErr instanceof Error ? claudeErr.message : String(claudeErr);
      console.error(`[aiStudio] Claude PDF fallback failed for "${originalName}": ${msg}`);
      // If we got at least some text from pdf-parse, use it
      if (textFromPdfParse.length > 0) return { rawText: textFromPdfParse };
      throw new AppError(422, "Could not extract text from this PDF. It may be scanned or corrupted.", "EXTRACTION_FAILED");
    }
  }

  if ([".jpg", ".jpeg", ".png"].includes(ext) || mimeType.startsWith("image/")) {
    const buffer = fs.readFileSync(filePath);
    const imageMimeType: ImageMediaType = ext === ".png" ? "image/png" : "image/jpeg";
    return { rawText: "", imageBase64: buffer.toString("base64"), imageMimeType };
  }

  throw new AppError(400, "Cannot extract text from this file type", "UNSUPPORTED_FILE");
}

async function requireManager(storage: IStorage, userId: string): Promise<void> {
  const perms = await storage.getUserPermissions(userId);
  const hasAccess = perms.some(
    (p) =>
      p.name === "admin.manage_all" ||
      p.name === "admin.role_management" ||
      p.name === "hr.edit_team"
  );
  if (!hasAccess) {
    throw new AppError(403, "Manager or Owner access required", "FORBIDDEN");
  }
}

async function getAiItem(id: string, storeId: string) {
  const [item] = await db
    .select()
    .from(aiGeneratedItems)
    .where(and(eq(aiGeneratedItems.id, id), eq(aiGeneratedItems.storeId, storeId)));
  if (!item) throw new AppError(404, "Item not found", "NOT_FOUND");
  return item;
}

async function getOrCreateSopCategory(storeId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(sopCategories)
    .where(and(eq(sopCategories.storeId, storeId), eq(sopCategories.name, "AI Generated")))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(sopCategories)
    .values({ storeId, name: "AI Generated", description: "AI-generated SOPs" })
    .returning();
  return created.id;
}

type AiSopContent = { role?: string; summary?: string; steps?: Array<{ title: string; description: string; decisionOptions?: Array<{ condition: string; action: string }> }>; tags?: string[] };
type AiTrainingContent = { description?: string; markdownContent?: string; content?: string; estimatedMinutes?: number };
type AiKbContent = { summary?: string; paragraphs?: Array<{ heading?: string; body: string }>; tags?: string[] };

function asRecord(val: unknown): Record<string, unknown> {
  return (val && typeof val === "object" && !Array.isArray(val)) ? (val as Record<string, unknown>) : {};
}

async function publishSopItem(
  item: typeof aiGeneratedItems.$inferSelect,
  storeId: string,
  categoryId: string | undefined,
  storage: IStorage
) {
  const content = asRecord(item.content) as AiSopContent;
  const targetCategoryId = categoryId || await getOrCreateSopCategory(storeId);

  const stepsText = Array.isArray(content.steps)
    ? content.steps
        .map((s, i) => {
          let text = `**Step ${i + 1}: ${s.title}**\n${s.description}`;
          if (s.decisionOptions && s.decisionOptions.length > 0) {
            text +=
              "\n" +
              s.decisionOptions
                .map((d) => `- ${d.condition} → ${d.action}`)
                .join("\n");
          }
          return text;
        })
        .join("\n\n")
    : "";

  const sopPayload: InsertSopDocument = {
    categoryId: targetCategoryId,
    title: item.title,
    content: `# ${item.title}\n\n${content.role ? `**Role:** ${content.role}\n\n` : ""}## Steps\n\n${stepsText}`,
    summary: content.summary || "AI-generated SOP",
    tags: ["ai-generated", ...(Array.isArray(content.tags) ? content.tags : [])],
    isPublished: true,
    updatedBy: item.createdBy || undefined,
    source: "ai_generated",
  };
  const doc = await storage.createSopDocument(sopPayload);

  return { type: "sop", publishedId: doc.id };
}

async function publishTrainingItem(
  item: typeof aiGeneratedItems.$inferSelect,
  storeId: string,
  storage: IStorage
) {
  const content = asRecord(item.content) as AiTrainingContent;
  const module = await storage.createTrainingModule({
    ...(storeId ? { storeId } : {}),
    title: item.title,
    description: content.description || "AI-generated training module",
    content: content.markdownContent || content.content || "",
    category: "custom",
    estimatedMinutes: content.estimatedMinutes || 20,
    isActive: true,
    isRequired: false,
  });
  return { type: "training", publishedId: module.id };
}

async function publishTaskItem(
  item: typeof aiGeneratedItems.$inferSelect,
  storeId: string,
  createdBy: string,
  storage: IStorage
) {
  type AiTaskItem = { title: string; description?: string; estimatedMinutes?: number };
  const rawContent = item.content as Record<string, unknown>;
  const taskItems: AiTaskItem[] = Array.isArray(rawContent.tasks) ? (rawContent.tasks as AiTaskItem[]) : [];

  const createdIds: string[] = [];
  for (const taskItem of taskItems) {
    const payload: InsertTask = {
      title: `[${item.title}] ${taskItem.title}`,
      description: taskItem.description ?? null,
      createdBy,
      locationId: storeId,
      estimatedMinutes: taskItem.estimatedMinutes ?? null,
      status: "pending",
      priority: "medium",
    };
    const t = await storage.createTask(payload);
    createdIds.push(t.id);
  }
  return { type: "task", publishedCount: createdIds.length, taskIds: createdIds };
}

async function publishKnowledgeBaseItem(
  item: typeof aiGeneratedItems.$inferSelect,
  storeId: string,
  storage: IStorage
) {
  const content = asRecord(item.content) as AiKbContent;
  const paragraphs = Array.isArray(content.paragraphs)
    ? content.paragraphs.map((p) => `### ${p.heading || ""}\n${p.body || ""}`).join("\n\n")
    : "";

  const [existingCat] = await db
    .select()
    .from(sopCategories)
    .where(and(eq(sopCategories.storeId, storeId), eq(sopCategories.name, "Knowledge Base")))
    .limit(1);
  let categoryId: string;
  if (existingCat) {
    categoryId = existingCat.id;
  } else {
    const [newCat] = await db
      .insert(sopCategories)
      .values({ storeId, name: "Knowledge Base", description: "Knowledge base articles" })
      .returning();
    categoryId = newCat.id;
  }

  const kbPayload: InsertSopDocument = {
    categoryId,
    title: item.title,
    content: `# ${item.title}\n\n${content.summary || ""}\n\n${paragraphs}`,
    summary: content.summary || "AI-generated knowledge base article",
    tags: ["ai-generated", "knowledge-base", ...(Array.isArray(content.tags) ? content.tags : [])],
    isPublished: true,
    updatedBy: item.createdBy ?? undefined,
    source: "ai_generated",
  };
  const doc = await storage.createSopDocument(kbPayload);

  return { type: "knowledge_base", publishedId: doc.id };
}

export function registerAiStudioRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any
) {
  app.post(
    "/api/ai-studio/upload",
    isAuthenticated,
    upload.single("file"),
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);

      if (!req.file) {
        throw new AppError(400, "No file uploaded", "NO_FILE");
      }

      const storeId = await resolveStoreId() as string;
      const file = req.file;
      let extracted: { rawText: string; imageBase64?: string; imageMimeType?: ImageMediaType };
      try {
        extracted = await extractFromFile(file.path, file.mimetype, file.originalname);
      } catch (extractErr: unknown) {
        fs.unlink(file.path, () => {});
        if (extractErr instanceof AppError) throw extractErr;
        throw new AppError(422, "Failed to extract content from file", "EXTRACTION_FAILED");
      } finally {
        fs.unlink(file.path, () => {});
      }

      const doc = await storage.createKnowledgeDocument({
        storeId,
        uploadedByUserId: req.user.id,
        originalFileName: file.originalname,
        fileType: path.extname(file.originalname).toLowerCase().replace(".", "") || file.mimetype,
        rawContent: extracted.rawText || "[image]",
        processingStatus: "pending",
      });

      processKnowledgeDocument(doc.id, extracted.rawText, file.originalname, {
        imageBase64: extracted.imageBase64,
        imageMimeType: extracted.imageMimeType,
      }).catch((err: Error) => {
        logger.error({ docId: doc.id, error: err.message }, "ai-studio: async pipeline failed");
      });

      res.status(201).json({ success: true, data: doc });
    })
  );

  app.get(
    "/api/ai-studio/documents",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;
      const docs = await storage.getKnowledgeDocuments(storeId);
      res.json({ success: true, data: docs });
    })
  );

  app.delete(
    "/api/ai-studio/documents/:id",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const { id } = req.params;
      const existing = await storage.getKnowledgeDocument(id);
      if (!existing) throw new AppError(404, "Document not found", "NOT_FOUND");
      const storeId = await resolveStoreId() as string;
      if (existing.storeId !== storeId) throw new AppError(404, "Document not found", "NOT_FOUND");
      await storage.deleteKnowledgeDocument(id);
      res.json({ success: true });
    })
  );

  app.post(
    "/api/ai-studio/generate",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;

      const bodySchema = z.object({
        selectedDocumentIds: z.array(z.string()).min(1, "Select at least one document"),
        outputTypes: z
          .array(z.enum(["sops", "training", "tasks", "knowledge_base"]))
          .min(1, "Select at least one output type"),
        targetRoles: z.array(z.string()).min(1, "Select at least one role"),
      });

      const body = bodySchema.parse(req.body);

      const [job] = await db
        .insert(generationJobs)
        .values({
          storeId,
          status: "pending",
          selectedDocumentIds: body.selectedDocumentIds,
          outputTypes: body.outputTypes,
          targetRoles: body.targetRoles,
          selectedCategories: [],
          progressLog: ["Starting AI Studio generation..."],
          createdBy: req.user.id,
        })
        .returning();

      setImmediate(() => {
        runAiStudioGenerationJob(job.id, storeId, req.user.id).catch((err: Error) => {
          logger.error({ err: err.message, jobId: job.id }, "AI Studio generation job crashed");
        });
      });

      res.json({ jobId: job.id, status: "pending" });
    })
  );

  app.get(
    "/api/ai-studio/jobs/:jobId/status",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;
      const [job] = await db
        .select()
        .from(generationJobs)
        .where(and(eq(generationJobs.id, req.params.jobId), eq(generationJobs.storeId, storeId)));
      if (!job) throw new AppError(404, "Job not found", "NOT_FOUND");

      res.json({
        jobId: job.id,
        status: job.status,
        progressLog: (job.progressLog as string[]) || [],
      });
    })
  );

  app.get(
    "/api/ai-studio/items",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;

      const type = req.query.type as string | undefined;
      const status = req.query.status as string | undefined;

      const conditions = [eq(aiGeneratedItems.storeId, storeId)];
      if (type) conditions.push(eq(aiGeneratedItems.type, type));
      if (status) conditions.push(eq(aiGeneratedItems.status, status));

      const items = await db
        .select()
        .from(aiGeneratedItems)
        .where(and(...conditions))
        .orderBy(aiGeneratedItems.createdAt);

      res.json({ success: true, data: items });
    })
  );

  app.patch(
    "/api/ai-studio/items/:id",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;
      const item = await getAiItem(req.params.id, storeId);

      const bodySchema = z.object({
        title: z.string().max(255).optional(),
        content: z.record(z.string(), z.unknown()).optional(),
        status: z.enum(["in_review", "approved", "discarded"]).optional(),
        feedbackNotes: z.string().max(5000).optional(),
      });

      const body = bodySchema.parse(req.body);

      const [updated] = await db
        .update(aiGeneratedItems)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(aiGeneratedItems.id, item.id))
        .returning();

      res.json({ success: true, data: updated });
    })
  );

  app.post(
    "/api/ai-studio/items/:id/refine",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;
      const item = await getAiItem(req.params.id, storeId);

      const bodySchema = z.object({
        feedback: z.string().min(1).max(2000),
        sectionKey: z.string().optional(),
      });

      const { feedback, sectionKey } = bodySchema.parse(req.body);

      const currentContent = asRecord(item.content);
      const sectionContent = sectionKey ? currentContent[sectionKey] : currentContent;

      const prompt = `You are refining AI-generated content for a store management system.

CURRENT CONTENT:
${JSON.stringify(sectionContent, null, 2)}

MANAGER FEEDBACK:
${feedback}

INSTRUCTIONS:
- Rewrite the content based on the manager's feedback
- Keep the same structure/format as the original
- Return ONLY the refined content as valid JSON matching the original structure
- Do not add explanations or commentary`;

      const response = await anthropic.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      let refinedContent: unknown;
      try {
        const jsonMatch = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        refinedContent = jsonMatch ? JSON.parse(jsonMatch[0]) : text;
      } catch {
        refinedContent = text;
      }

      const newContent: Record<string, unknown> = sectionKey
        ? { ...currentContent, [sectionKey]: refinedContent }
        : (refinedContent && typeof refinedContent === "object" && !Array.isArray(refinedContent)
            ? (refinedContent as Record<string, unknown>)
            : currentContent);

      const [updated] = await db
        .update(aiGeneratedItems)
        .set({ content: newContent, updatedAt: new Date() })
        .where(eq(aiGeneratedItems.id, item.id))
        .returning();

      res.json({ success: true, data: updated });
    })
  );

  app.post(
    "/api/ai-studio/items/:id/publish",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;
      const item = await getAiItem(req.params.id, storeId);

      if (item.status !== "approved") {
        throw new AppError(400, "Item must be approved before publishing", "NOT_APPROVED");
      }

      const bodySchema = z.object({
        categoryId: z.string().optional(),
      });

      const { categoryId } = bodySchema.parse(req.body);

      let result: Record<string, unknown>;
      if (item.type === "sop") {
        result = await publishSopItem(item, storeId, categoryId, storage);
      } else if (item.type === "training") {
        result = await publishTrainingItem(item, storeId, storage);
      } else if (item.type === "task") {
        result = await publishTaskItem(item, storeId, item.createdBy || req.user.id, storage);
      } else if (item.type === "knowledge_base") {
        result = await publishKnowledgeBaseItem(item, storeId, storage);
      } else {
        throw new AppError(400, `Unknown item type: ${item.type}`, "UNKNOWN_TYPE");
      }

      await db
        .update(aiGeneratedItems)
        .set({ status: "published", updatedAt: new Date() })
        .where(eq(aiGeneratedItems.id, item.id));

      res.json({ success: true, result });
    })
  );

  app.post(
    "/api/ai-studio/items/publish-batch",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;

      const bodySchema = z.object({
        itemIds: z.array(z.string()).min(1),
        categoryId: z.string().optional(),
      });

      const { itemIds, categoryId } = bodySchema.parse(req.body);

      const results = [];
      const errors = [];

      for (const itemId of itemIds) {
        try {
          const item = await getAiItem(itemId, storeId);

          if (item.status !== "approved") {
            errors.push({ id: itemId, error: "Item must be approved before publishing" });
            continue;
          }

          let result: Record<string, unknown>;
          if (item.type === "sop") {
            result = await publishSopItem(item, storeId, categoryId, storage);
          } else if (item.type === "training") {
            result = await publishTrainingItem(item, storeId, storage);
          } else if (item.type === "task") {
            result = await publishTaskItem(item, storeId, item.createdBy || req.user.id, storage);
          } else if (item.type === "knowledge_base") {
            result = await publishKnowledgeBaseItem(item, storeId, storage);
          } else {
            errors.push({ id: itemId, error: `Unknown item type: ${item.type}` });
            continue;
          }

          await db
            .update(aiGeneratedItems)
            .set({ status: "published", updatedAt: new Date() })
            .where(eq(aiGeneratedItems.id, itemId));

          results.push({ id: itemId, ...result });
        } catch (err: unknown) {
          if (err instanceof AppError && err.code === "NOT_FOUND") {
            errors.push({ id: itemId, error: "Item not found or access denied" });
          } else {
            errors.push({ id: itemId, error: err instanceof Error ? err.message : "Unknown error" });
          }
        }
      }

      res.json({ success: true, results, errors });
    })
  );
}
