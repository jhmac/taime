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
import { eq, and, inArray, sql } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { resolveStoreId } from "../services/storeResolver";
import type { IStorage } from "../storage";
import type { InsertSopDocument, InsertTask } from "@shared/schema";
import { processKnowledgeDocument } from "../services/knowledgeExtractor";
import { runAiStudioGenerationJob } from "../services/aiStudioGeneration";
import { indexAiGeneratedItem } from "../services/sopIndexer";
import { anthropic, withAiContext } from "../lib/aiClients";
import { config } from "../lib/config";
import logger from "../lib/logger";
import { resolveAnyPermission } from "../services/permissionResolver";

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

function detectUploadedContentType(fileName: string, textSnippet: string): string | null {
  const name = fileName.toLowerCase();
  const text = textSnippet.slice(0, 600).toLowerCase();
  const combined = name + " " + text;
  if (/supply|supplies|order form|inventory|restock|ordering|stock list|supply list/.test(combined)) {
    return "supply_list";
  }
  if (/chore|cleaning|sweep|mop|sanitiz|vacuum|dressing room|fitting room/.test(combined)) {
    return "chore_list";
  }
  if (/task list|checklist|daily tasks|weekly tasks|opening checklist|closing checklist/.test(combined)) {
    return "task_list";
  }
  if (/sop|standard operating|procedure|policy manual/.test(combined)) {
    return "sop";
  }
  if (/training|learning module|skill guide/.test(combined)) {
    return "training";
  }
  return null;
}

async function requireManager(storage: IStorage, userId: string): Promise<void> {
  const hasAccess = await resolveAnyPermission(userId, ["admin.manage_all", "admin.role_management", "hr.edit_team"], storage);
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
  type AiTaskItem = {
    title: string;
    description?: string;
    estimatedMinutes?: number;
    dayOfWeek?: string;
    timeOfDay?: string;
    eligibleRoles?: string[];
    priority?: string;
  };
  const rawContent = item.content as Record<string, unknown>;
  const taskItems: AiTaskItem[] = Array.isArray(rawContent.tasks) ? (rawContent.tasks as AiTaskItem[]) : [];
  const category = typeof rawContent.category === "string" ? rawContent.category : null;

  const createdIds: string[] = [];
  for (const taskItem of taskItems) {
    const payload: InsertTask = {
      title: `[${item.title}] ${taskItem.title}`,
      description: taskItem.description ?? null,
      createdBy,
      locationId: storeId,
      estimatedMinutes: taskItem.estimatedMinutes ?? null,
      status: "pending",
      priority: (taskItem.priority as "low" | "medium" | "high" | "urgent") ?? "medium",
      category,
      isAIAssigned: true,
      dayOfWeek: taskItem.dayOfWeek ? taskItem.dayOfWeek.toLowerCase() : null,
      timeOfDay: taskItem.timeOfDay ? taskItem.timeOfDay.toLowerCase() : null,
      eligibleRoles: Array.isArray(taskItem.eligibleRoles) && taskItem.eligibleRoles.length > 0
        ? taskItem.eligibleRoles
        : null,
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
      }).then(async () => {
        try {
          const processed = await storage.getKnowledgeDocument(doc.id);
          if (!processed || processed.processingStatus !== "ready") {
            logger.warn(
              { docId: doc.id, status: processed?.processingStatus },
              "ai-studio: skipping KB auto-enqueue — extraction did not finish successfully"
            );
            return;
          }
          const [autoJob] = await db
            .insert(generationJobs)
            .values({
              storeId,
              status: "pending",
              selectedDocumentIds: [doc.id],
              outputTypes: ["knowledge_base"],
              targetRoles: ["New Associate", "Lead", "Manager"],
              selectedCategories: [],
              progressLog: ["Auto-generating knowledge base article from uploaded document..."],
              createdBy: req.user.id,
            })
            .returning();

          await runAiStudioGenerationJob(autoJob.id, storeId, req.user.id);

          const kbItems = await db
            .select()
            .from(aiGeneratedItems)
            .where(
              and(
                eq(aiGeneratedItems.jobId, autoJob.id),
                eq(aiGeneratedItems.type, "knowledge_base"),
              )
            );

          for (const item of kbItems) {
            if (item.status !== "in_review") continue;
            try {
              await db
                .update(aiGeneratedItems)
                .set({ status: "approved", updatedAt: new Date() })
                .where(eq(aiGeneratedItems.id, item.id));

              await publishKnowledgeBaseItem(item, storeId, storage);

              await db
                .update(aiGeneratedItems)
                .set({ status: "published", updatedAt: new Date() })
                .where(eq(aiGeneratedItems.id, item.id));

              indexAiGeneratedItem(item.id).catch((err: Error) =>
                logger.warn({ itemId: item.id, error: err.message }, "[AI Studio] Background index after auto-publish failed")
              );

              logger.info({ docId: doc.id, itemId: item.id, title: item.title }, "ai-studio: auto-published KB item from upload");
            } catch (pubErr: unknown) {
              logger.warn(
                { docId: doc.id, itemId: item.id, err: pubErr instanceof Error ? pubErr.message : String(pubErr) },
                "ai-studio: failed to auto-publish KB item"
              );
            }
          }
        } catch (autoErr: unknown) {
          logger.warn(
            { docId: doc.id, err: autoErr instanceof Error ? autoErr.message : String(autoErr) },
            "Failed to auto-enqueue KB generation after upload"
          );
        }
      }).catch((err: Error) => {
        logger.error({ docId: doc.id, error: err.message }, "ai-studio: async pipeline failed");
      });

      const suggestedAction = detectUploadedContentType(file.originalname, extracted.rawText || "");
      res.status(201).json({ success: true, data: doc, suggestedAction });
    })
  );

  // Quick-action: prompt + optional file → AI creates tasks / other objects directly
  app.post(
    "/api/ai-studio/quick-action",
    isAuthenticated,
    upload.single("file"),
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;
      const prompt = (req.body?.prompt ?? "").toString().trim();
      if (!prompt) throw new AppError(400, "A prompt is required", "NO_PROMPT");

      // Build the Claude message content — PDFs and images are sent natively
      // (one API call) instead of extracting text first (which would be two
      // slow sequential calls for a PDF that needs the Claude fallback).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let messageContent: string | any[];

      const systemPrompt = `You are an AI assistant for Taime, a retail boutique scheduling and operations app.
When given a document and a user prompt, extract the relevant data and return a JSON object describing the action to take.

ALWAYS respond with valid JSON only — no markdown, no explanation, just the JSON object.

Supported actions:
1. create_tasks — create recurring or one-off tasks from the document
   Response shape:
   {
     "action": "create_tasks",
     "summary": "Short description of what was created",
     "category": "supply_check" | null,
     "tasks": [
       {
         "title": "Task name",
         "description": "Optional detail",
         "dayOfWeek": "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday" | null,
         "timeOfDay": "morning" | "afternoon" | "evening" | null,
         "isRecurring": true | false,
         "estimatedMinutes": 15,
         "choreZone": "zone 1" | "dressing room" | etc or null,
         "priority": "low" | "medium" | "high"
       }
     ]
   }
   IMPORTANT: If the document is a supply list, inventory sheet, stock form, or product quantity tracker, set "category": "supply_check". Each line item in the supply list becomes one task. Otherwise set "category": null.

2. answer — answer a question from the document without creating anything
   Response shape:
   { "action": "answer", "text": "Your answer here" }

Infer the action from the user prompt. If the prompt asks to create, add, generate, or schedule tasks/chores, use create_tasks. If the document looks like a supply/inventory list and no explicit action is stated, use create_tasks with category: "supply_check".`;

      if (req.file) {
        const file = req.file;
        const ext = path.extname(file.originalname).toLowerCase();
        const buffer = fs.readFileSync(file.path);
        fs.unlink(file.path, () => {});

        if (ext === ".pdf" || file.mimetype === "application/pdf") {
          // Send PDF directly to Claude — avoids a slow pre-extraction call
          messageContent = [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
            } as any,
            { type: "text", text: `User request: ${prompt}` },
          ];
        } else if ([".jpg", ".jpeg", ".png"].includes(ext) || file.mimetype.startsWith("image/")) {
          const imageMime: ImageMediaType = ext === ".png" ? "image/png" : "image/jpeg";
          messageContent = [
            { type: "image", source: { type: "base64", media_type: imageMime, data: buffer.toString("base64") } } as any,
            { type: "text", text: `User request: ${prompt}` },
          ];
        } else {
          // TXT / DOCX — fast local extraction, then one Claude call
          let fileText = "";
          try {
            if (ext === ".txt" || file.mimetype === "text/plain") {
              fileText = buffer.toString("utf-8");
            } else if (ext === ".docx") {
              const mammoth = await import("mammoth");
              const result = await mammoth.extractRawText({ buffer });
              fileText = result.value;
            }
          } catch {}
          messageContent = `Document content:\n\n${fileText}\n\n---\nUser request: ${prompt}`;
        }
      } else {
        messageContent = prompt;
      }

      let parsed: Record<string, unknown>;
      try {
        const response = await anthropic.messages.create({
          model: DEFAULT_MODEL,
          max_tokens: 8192,
          system: systemPrompt,
          messages: [{ role: "user", content: messageContent }],
        });
        const raw = response.content
          .filter((c) => c.type === "text")
          .map((c) => (c as any).text)
          .join("");
        // Strip markdown code fences if present
        const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
        parsed = JSON.parse(cleaned);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err: msg }, "[QuickAction] Claude call failed");
        throw new AppError(502, "AI failed to process your request. Please try again.", "AI_ERROR");
      }

      if (parsed.action === "create_tasks") {
        type QuickTask = {
          title: string;
          description?: string;
          dayOfWeek?: string;
          timeOfDay?: string;
          isRecurring?: boolean;
          estimatedMinutes?: number;
          choreZone?: string;
          priority?: string;
        };
        const taskList = Array.isArray(parsed.tasks) ? (parsed.tasks as QuickTask[]) : [];
        const taskCategory = typeof parsed.category === "string" ? parsed.category : null;
        const createdTasks = [];
        for (const t of taskList) {
          if (!t.title) continue;
          const created = await storage.createTask({
            title: t.title,
            description: t.description ?? null,
            createdBy: req.user.id,
            locationId: storeId,
            dayOfWeek: t.dayOfWeek ?? null,
            timeOfDay: t.timeOfDay ?? null,
            isRecurring: t.isRecurring ?? false,
            estimatedMinutes: t.estimatedMinutes ?? null,
            choreZone: t.choreZone ?? null,
            priority: (t.priority as any) ?? "medium",
            status: "pending",
            isAIAssigned: true,
            aiReasoning: `Created via Quick Action: "${prompt}"`,
            category: taskCategory,
          });
          createdTasks.push(created);
        }
        return res.json({
          success: true,
          action: "create_tasks",
          summary: parsed.summary ?? `Created ${createdTasks.length} tasks`,
          count: createdTasks.length,
          tasks: createdTasks,
          category: taskCategory,
        });
      }

      if (parsed.action === "answer") {
        return res.json({ success: true, action: "answer", text: parsed.text ?? "" });
      }

      res.json({ success: true, action: "unknown", raw: parsed });
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
          .array(z.enum(["sops", "training", "tasks", "knowledge_base", "ai_decide", "supply_check"]))
          .min(1, "Select at least one output type"),
        targetRoles: z.array(z.string()).min(1, "Select at least one role"),
        aiDecide: z.boolean().optional(),
      });

      const body = bodySchema.parse(req.body);
      const outputTypes = body.aiDecide ? ["ai_decide"] : body.outputTypes;

      const [job] = await db
        .insert(generationJobs)
        .values({
          storeId,
          status: "pending",
          selectedDocumentIds: body.selectedDocumentIds,
          outputTypes,
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
    "/api/ai-studio/jobs/recent",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;

      const recentJobs = await db
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.storeId, storeId))
        .orderBy(sql`${generationJobs.updatedAt} DESC`)
        .limit(5);

      const jobsWithCounts = await Promise.all(
        recentJobs.map(async (j) => {
          const [{ count }] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(aiGeneratedItems)
            .where(eq(aiGeneratedItems.jobId, j.id));
          return {
            jobId: j.id,
            status: j.status,
            itemsGenerated: count ?? 0,
            totalDocuments: ((j.selectedDocumentIds as string[]) || []).length,
            updatedAt: j.updatedAt,
          };
        })
      );

      res.json({ success: true, jobs: jobsWithCounts });
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

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(aiGeneratedItems)
        .where(eq(aiGeneratedItems.jobId, job.id));

      res.json({
        jobId: job.id,
        status: job.status,
        progressLog: (job.progressLog as string[]) || [],
        itemsGenerated: count ?? 0,
        totalDocuments: ((job.selectedDocumentIds as string[]) || []).length,
      });
    })
  );

  app.post(
    "/api/ai-studio/jobs/:jobId/resume",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;

      const [failedJob] = await db
        .select()
        .from(generationJobs)
        .where(and(eq(generationJobs.id, req.params.jobId), eq(generationJobs.storeId, storeId)));
      if (!failedJob) throw new AppError(404, "Job not found", "NOT_FOUND");
      if (failedJob.status !== "failed") throw new AppError(400, "Job is not in a failed state", "INVALID_STATE");

      const allDocIds = (failedJob.selectedDocumentIds as string[]) || [];

      const processedItems = await db
        .select({ sourceDocumentIds: aiGeneratedItems.sourceDocumentIds })
        .from(aiGeneratedItems)
        .where(eq(aiGeneratedItems.jobId, failedJob.id));

      const processedDocIds = new Set<string>();
      for (const item of processedItems) {
        const ids = item.sourceDocumentIds as string[];
        if (Array.isArray(ids)) ids.forEach((id) => processedDocIds.add(id));
      }

      const remainingDocIds = allDocIds.filter((id) => !processedDocIds.has(id));

      if (remainingDocIds.length === 0) {
        res.json({ message: "All documents were already processed", jobId: null, remainingDocuments: 0 });
        return;
      }

      const [newJob] = await db
        .insert(generationJobs)
        .values({
          storeId,
          status: "pending",
          selectedDocumentIds: remainingDocIds,
          outputTypes: failedJob.outputTypes as string[],
          targetRoles: failedJob.targetRoles as string[],
          selectedCategories: [],
          progressLog: [
            `Resuming generation — ${processedDocIds.size} of ${allDocIds.length} documents were already processed.`,
            `Continuing with ${remainingDocIds.length} remaining document(s)...`,
          ],
          createdBy: req.user.id,
        })
        .returning();

      setImmediate(() => {
        runAiStudioGenerationJob(newJob.id, storeId, req.user.id).catch((err: Error) => {
          logger.error({ err: err.message, jobId: newJob.id }, "Resumed AI Studio generation job crashed");
        });
      });

      res.json({
        jobId: newJob.id,
        status: "pending",
        resumedFrom: failedJob.id,
        processedDocuments: processedDocIds.size,
        remainingDocuments: remainingDocIds.length,
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

      if (body.status === "approved") {
        indexAiGeneratedItem(item.id).catch((err: Error) =>
          logger.warn({ itemId: item.id, error: err.message }, "[AI Studio] Background index after approve failed")
        );
      }

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

      const isTaskItem = item.type === "task";
      const taskOpsContext = isTaskItem
        ? `\n\nSTORE CONTEXT: This is a task checklist for a women's fashion boutique. Real daily task lists always include BOTH operational/maintenance tasks (vacuuming dressing rooms, washing windows, inventorying supplies like bags/tissue/hangers, steaming garments, dusting fixtures, straightening merchandise, restocking POS area, cleaning mirrors) AND sales/service tasks. Make sure any task list reflects this balance.`
        : "";

      const prompt = `You are refining AI-generated content for a store management system.${taskOpsContext}

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

      indexAiGeneratedItem(item.id).catch((err: Error) =>
        logger.warn({ itemId: item.id, error: err.message }, "[AI Studio] Background index after publish failed")
      );

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

          indexAiGeneratedItem(itemId).catch((err: Error) =>
            logger.warn({ itemId, error: err.message }, "[AI Studio] Background index after batch-publish failed")
          );

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

  // Approve all in-review items for this store (optionally filtered by type) then publish them.
  // This lets a manager one-click publish everything generated from their uploaded documents.
  app.post(
    "/api/ai-studio/items/approve-and-publish-all",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManager(storage, req.user.id);
      const storeId = await resolveStoreId() as string;
      const { type, categoryId } = z.object({
        type: z.string().optional(),
        categoryId: z.string().optional(),
      }).parse(req.body);

      // Fetch all in_review items for this store
      const conditions: ReturnType<typeof and>[] = [
        eq(aiGeneratedItems.storeId, storeId),
        eq(aiGeneratedItems.status, "in_review"),
      ];
      if (type) conditions.push(eq(aiGeneratedItems.type, type));

      const inReviewItems = await db
        .select()
        .from(aiGeneratedItems)
        .where(and(...conditions));

      if (inReviewItems.length === 0) {
        return res.json({ success: true, results: [], errors: [], approved: 0, published: 0 });
      }

      // Step 1: approve all
      const ids = inReviewItems.map(i => i.id);
      await db
        .update(aiGeneratedItems)
        .set({ status: "approved", updatedAt: new Date() })
        .where(inArray(aiGeneratedItems.id, ids));

      // Step 2: publish all
      const results = [];
      const errors = [];
      for (const item of inReviewItems) {
        try {
          const approved = { ...item, status: "approved" as const };
          let result: Record<string, unknown>;
          if (approved.type === "sop") {
            result = await publishSopItem(approved, storeId, categoryId, storage);
          } else if (approved.type === "training") {
            result = await publishTrainingItem(approved, storeId, storage);
          } else if (approved.type === "task") {
            result = await publishTaskItem(approved, storeId, approved.createdBy || req.user.id, storage);
          } else if (approved.type === "knowledge_base") {
            result = await publishKnowledgeBaseItem(approved, storeId, storage);
          } else {
            errors.push({ id: item.id, error: `Unknown type: ${approved.type}` });
            continue;
          }
          await db
            .update(aiGeneratedItems)
            .set({ status: "published", updatedAt: new Date() })
            .where(eq(aiGeneratedItems.id, item.id));
          results.push({ id: item.id, ...result });
        } catch (err: unknown) {
          errors.push({ id: item.id, error: err instanceof Error ? err.message : "Unknown error" });
        }
      }

      res.json({ success: true, results, errors, approved: ids.length, published: results.length });
    })
  );
}
