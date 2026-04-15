import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config";
import { db } from "../db";
import {
  generationJobs,
  knowledgeDocuments,
  companyAiContext,
  aiGeneratedItems,
  quizQuestions,
} from "@shared/schema";
import { eq, inArray, and } from "drizzle-orm";
import logger from "../lib/logger";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

/** Asks Claude to decide which output types fit a given document.
 *  Returns a subset of ["sops","training","tasks","knowledge_base"]. */
async function classifyDocument(
  fileName: string,
  summary: string,
  contentSnippet: string
): Promise<string[]> {
  const prompt = `You are a retail operations expert. Given this document, decide which content types would be most valuable to generate from it.

DOCUMENT: "${fileName}"
${summary ? `SUMMARY: ${summary}` : ""}
CONTENT SNIPPET:
${contentSnippet.slice(0, 2000)}

Choose from these types (select ALL that apply — you may pick 1 to 4):
- "sops" → Step-by-step procedures (good for: customer interactions, workflows, processes, scripts)
- "training" → Learning modules with exercises (good for: skills training, sales techniques, product knowledge)
- "tasks" → Daily/weekly checklists (good for: recurring duties, opening/closing procedures, operational routines)
- "knowledge_base" → Reference articles (good for: facts, policies, product info, quick reference guides)

Return ONLY a JSON array like: ["sops","training"]`;

  try {
    const response = await claudeCall({ model: DEFAULT_MODEL, max_tokens: 100, messages: [{ role: "user", content: prompt }] }, 30_000);
    const text = response.content[0].type === "text" ? response.content[0].text : "[]";
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed: string[] = JSON.parse(match[0]);
      const valid = parsed.filter((t) => ["sops", "training", "tasks", "knowledge_base"].includes(t));
      if (valid.length > 0) return valid;
    }
  } catch (err: unknown) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), fileName }, "classifyDocument failed — defaulting to sops+training");
  }
  return ["sops", "training"];
}

/** Wraps an Anthropic API call with an explicit timeout so a hung response
 *  can never freeze the entire generation job. */
async function claudeCall(
  params: Parameters<typeof anthropic.messages.create>[0],
  timeoutMs = 90_000
): Promise<Anthropic.Message> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Claude call timed out after ${timeoutMs / 1000}s`)), timeoutMs)
  );
  return Promise.race([anthropic.messages.create(params), timeout]);
}

async function appendProgress(jobId: string, message: string) {
  try {
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    if (!job) return;
    const log = (job.progressLog as string[]) || [];
    log.push(message);
    await db
      .update(generationJobs)
      .set({ progressLog: log, updatedAt: new Date() })
      .where(eq(generationJobs.id, jobId));
  } catch (err: unknown) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "Failed to append progress log");
  }
}

export async function runAiStudioGenerationJob(
  jobId: string,
  storeId: string,
  createdBy: string
): Promise<void> {
  try {
    await db
      .update(generationJobs)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(generationJobs.id, jobId));

    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    if (!job) throw new Error("Job not found");

    const contextQuery = storeId
      ? db.select().from(companyAiContext).where(eq(companyAiContext.storeId, storeId)).limit(1)
      : db.select().from(companyAiContext).limit(1);
    const [context] = await contextQuery;
    const storeName = context?.storeName || "Our Store";
    const businessType = context?.businessType || "Fashion Boutique";
    const brandVoice = context?.brandVoice || "professional and warm";
    const teamRoles = (context?.teamRoles as string[]) || ["New Associate", "Lead", "Manager"];

    const docIds = (job.selectedDocumentIds as string[]) || [];
    const outputTypes = (job.outputTypes as string[]) || [];
    const targetRoles = (job.targetRoles as string[]) || teamRoles;

    let documents: typeof knowledgeDocuments.$inferSelect[] = [];
    if (docIds.length > 0) {
      documents = await db
        .select()
        .from(knowledgeDocuments)
        .where(and(inArray(knowledgeDocuments.id, docIds), eq(knowledgeDocuments.storeId, storeId)));
    }

    if (documents.length === 0) {
      await appendProgress(jobId, "No documents found. Please upload source documents first.");
      await db
        .update(generationJobs)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(generationJobs.id, jobId));
      return;
    }

    const aiDecideMode = outputTypes.includes("ai_decide");

    await appendProgress(
      jobId,
      aiDecideMode
        ? `Asking Claude to analyze and categorize ${documents.length} document(s)...`
        : `Analyzing ${documents.length} document(s) from your source library...`
    );

    const generatedItemIds: string[] = [];

    for (const doc of documents) {
      const docContent =
        doc.extractedText || doc.rawContent || "";
      const docSummary = doc.summaryFromClaude || "";

      // In AI-decide mode, classify each document before generating
      let docOutputTypes = outputTypes;
      if (aiDecideMode) {
        const classified = await classifyDocument(doc.originalFileName, docSummary, docContent);
        docOutputTypes = classified;
        await appendProgress(
          jobId,
          `"${doc.originalFileName}" → ${classified.map((t) => ({ sops: "SOPs", training: "Training", tasks: "Tasks", knowledge_base: "Knowledge Base" }[t] || t)).join(", ")}`
        );
      }

      if (docOutputTypes.includes("sops")) {
        await appendProgress(jobId, `Generating SOPs from "${doc.originalFileName}"...`);

        const sopPrompt = `You are an expert retail operations consultant. Generate structured SOPs for "${storeName}" (${businessType}).
Brand voice: ${brandVoice}
Target roles: ${targetRoles.join(", ")}

SOURCE DOCUMENT: ${doc.originalFileName}
${docSummary ? `Summary: ${docSummary}` : ""}

CONTENT:
${docContent.slice(0, 15000)}

Create 1-3 actionable SOPs from this document. Each SOP must have clear numbered steps.

Return a JSON array of SOP objects:
[
  {
    "title": "SOP title",
    "role": "target role",
    "summary": "1-2 sentence summary",
    "tags": ["tag1", "tag2"],
    "steps": [
      {
        "order": 1,
        "title": "Step title",
        "description": "Detailed description of what to do",
        "type": "action",
        "decisionOptions": null
      },
      {
        "order": 2,
        "title": "Decision: customer response",
        "description": "Choose based on customer reaction",
        "type": "decision",
        "decisionOptions": [
          { "condition": "If customer says yes", "action": "Proceed to fitting room" },
          { "condition": "If customer says no", "action": "Suggest alternatives" }
        ]
      }
    ]
  }
]

Return ONLY the JSON array, no other text.`;

        try {
          const response = await claudeCall({
            model: DEFAULT_MODEL,
            max_tokens: 2048,
            messages: [{ role: "user", content: sopPrompt }],
          });

          const text = response.content[0].type === "text" ? response.content[0].text : "";
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const sops = JSON.parse(jsonMatch[0]);
            for (const sop of sops) {
              const [item] = await db
                .insert(aiGeneratedItems)
                .values({
                  storeId,
                  jobId,
                  type: "sop",
                  title: sop.title || "Untitled SOP",
                  content: sop,
                  sourceDocumentIds: [doc.id],
                  status: "in_review",
                  createdBy,
                })
                .returning();
              generatedItemIds.push(item.id);
              await appendProgress(jobId, `Built SOP: "${sop.title}"`);
            }
          }
        } catch (err: unknown) {
          logger.warn({ err: err instanceof Error ? err.message : String(err), docId: doc.id }, "Failed to generate SOPs");
          await appendProgress(
            jobId,
            `Skipped SOPs for "${doc.originalFileName}" — could not parse`
          );
        }
      }

      if (docOutputTypes.includes("training")) {
        await appendProgress(
          jobId,
          `Generating training modules from "${doc.originalFileName}"...`
        );

        const trainingPrompt = `You are an expert retail training developer. Generate training modules for "${storeName}" (${businessType}).
Brand voice: ${brandVoice}
Target roles: ${targetRoles.join(", ")}

SOURCE DOCUMENT: ${doc.originalFileName}
${docSummary ? `Summary: ${docSummary}` : ""}

CONTENT:
${docContent.slice(0, 10000)}

Create 1 training module from this document.

Return a JSON array:
[
  {
    "title": "Module title",
    "role": "target role",
    "description": "Module description",
    "objectives": ["Objective 1", "Objective 2"],
    "markdownContent": "# Module Title\n\nFull content in markdown...",
    "exercises": [
      {
        "scenario": "Customer scenario",
        "question": "What would you do?",
        "guidance": "Ideal response guidance"
      }
    ],
    "estimatedMinutes": 20
  }
]

Return ONLY the JSON array, no other text.`;

        try {
          const response = await claudeCall({
            model: DEFAULT_MODEL,
            max_tokens: 2048,
            messages: [{ role: "user", content: trainingPrompt }],
          }, 120_000);

          const text = response.content[0].type === "text" ? response.content[0].text : "";
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const modules = JSON.parse(jsonMatch[0]);
            for (const mod of modules) {
              const [item] = await db
                .insert(aiGeneratedItems)
                .values({
                  storeId,
                  jobId,
                  type: "training",
                  title: mod.title || "Untitled Training",
                  content: mod,
                  sourceDocumentIds: [doc.id],
                  status: "in_review",
                  createdBy,
                })
                .returning();
              generatedItemIds.push(item.id);
              await appendProgress(jobId, `Built training module: "${mod.title}"`);
            }
          }
        } catch (err: unknown) {
          logger.warn({ err: err instanceof Error ? err.message : String(err), docId: doc.id }, "Failed to generate training");
          await appendProgress(
            jobId,
            `Skipped training for "${doc.originalFileName}" — could not parse`
          );
        }
      }

      if (docOutputTypes.includes("tasks")) {
        await appendProgress(jobId, `Generating task lists from "${doc.originalFileName}"...`);

        const taskPrompt = `You are a retail operations expert creating daily task checklists for "${storeName}", a ${businessType} in Ridgeland, MS.
Target roles: ${targetRoles.join(", ")}

SOURCE DOCUMENT: ${doc.originalFileName}
CONTENT:
${docContent.slice(0, 10000)}

Generate 1-2 COMPLETE daily task checklists that blend TWO categories of tasks:

CATEGORY 1 — STORE OPERATIONS (always include physical/maintenance tasks):
These are the real, hands-on daily duties that keep a boutique running. Include tasks like:
- Vacuum dressing rooms and fitting room floors
- Clean and wipe fitting room mirrors and hooks
- Wash or wipe front windows/glass doors
- Inventory and restock supplies (bags, tissue paper, hangers, receipt paper)
- Straighten, fold, and size-sort all floor displays
- Steam or iron wrinkled garments on the floor
- Dust display fixtures, shelves, and counters
- Check and restock the POS area (bags, wrapping supplies, pens)
- Take out trash and sanitize checkout counter
- Sweep/mop entryway and any tiled areas
- Walk the floor to check lighting and all displays look full and intentional

CATEGORY 2 — SALES & SERVICE (from the source document):
Extract actionable daily tasks from the document above that improve customer service and sales performance.

Create realistic, timed checklists a boutique associate or lead would actually use on the floor.
Mix both categories naturally — a real daily checklist for a boutique has both operational AND sales tasks.

Return a JSON array:
[
  {
    "title": "Task list title (e.g., Daily Opening Checklist — New Associate)",
    "role": "target role from: ${targetRoles.join(", ")}",
    "description": "Brief description of what this checklist accomplishes",
    "frequency": "daily|weekly|opening|closing",
    "tasks": [
      {
        "order": 1,
        "title": "Concise task name",
        "description": "Clear, specific instruction of what to do and how to verify it's done",
        "isRequired": true,
        "estimatedMinutes": 5
      }
    ]
  }
]

Return ONLY the JSON array, no other text.`;

        try {
          const response = await claudeCall({
            model: DEFAULT_MODEL,
            max_tokens: 1500,
            messages: [{ role: "user", content: taskPrompt }],
          });

          const text = response.content[0].type === "text" ? response.content[0].text : "";
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const taskLists = JSON.parse(jsonMatch[0]);
            for (const taskList of taskLists) {
              const [item] = await db
                .insert(aiGeneratedItems)
                .values({
                  storeId,
                  jobId,
                  type: "task",
                  title: taskList.title || "Untitled Task List",
                  content: taskList,
                  sourceDocumentIds: [doc.id],
                  status: "in_review",
                  createdBy,
                })
                .returning();
              generatedItemIds.push(item.id);
              await appendProgress(jobId, `Built task list: "${taskList.title}"`);
            }
          }
        } catch (err: unknown) {
          logger.warn({ err: err instanceof Error ? err.message : String(err), docId: doc.id }, "Failed to generate tasks");
          await appendProgress(
            jobId,
            `Skipped tasks for "${doc.originalFileName}" — could not parse`
          );
        }
      }

      if (docOutputTypes.includes("knowledge_base")) {
        await appendProgress(
          jobId,
          `Generating knowledge base articles from "${doc.originalFileName}"...`
        );

        const kbPrompt = `You are a knowledge base author for "${storeName}" (${businessType}).
Create concise, searchable reference articles from this document.

SOURCE DOCUMENT: ${doc.originalFileName}
${docSummary ? `Summary: ${docSummary}` : ""}
CONTENT:
${docContent.slice(0, 12000)}

Create 1-3 knowledge base articles. Each should be a standalone reference.

Return a JSON array:
[
  {
    "title": "Article title",
    "category": "category (e.g., Policies, Products, Procedures)",
    "summary": "1-2 sentence summary",
    "paragraphs": [
      {
        "heading": "Section heading",
        "body": "Section content in plain text"
      }
    ],
    "tags": ["tag1", "tag2"],
    "audience": "who this is for"
  }
]

Return ONLY the JSON array, no other text.`;

        try {
          const response = await claudeCall({
            model: DEFAULT_MODEL,
            max_tokens: 1500,
            messages: [{ role: "user", content: kbPrompt }],
          });

          const text = response.content[0].type === "text" ? response.content[0].text : "";
          const jsonMatch = text.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const articles = JSON.parse(jsonMatch[0]);
            for (const article of articles) {
              const [item] = await db
                .insert(aiGeneratedItems)
                .values({
                  storeId,
                  jobId,
                  type: "knowledge_base",
                  title: article.title || "Untitled Article",
                  content: article,
                  sourceDocumentIds: [doc.id],
                  status: "in_review",
                  createdBy,
                })
                .returning();
              generatedItemIds.push(item.id);
              await appendProgress(jobId, `Built KB article: "${article.title}"`);
            }
          }
        } catch (err: unknown) {
          logger.warn({ err: err instanceof Error ? err.message : String(err), docId: doc.id }, "Failed to generate KB articles");
          await appendProgress(
            jobId,
            `Skipped KB for "${doc.originalFileName}" — could not parse`
          );
        }
      }
    }

    // ── Always generate quiz questions for the question bank ────────────────
    for (const doc of documents) {
      const docContent = doc.extractedText || doc.rawContent || "";
      if (!docContent.trim()) continue;
      await appendProgress(jobId, `Generating quiz questions from "${doc.originalFileName}"...`);

      const quizPrompt = `You are a retail training expert creating a quiz question bank for "${storeName}" (${businessType}).

SOURCE DOCUMENT: ${doc.originalFileName}
CONTENT:
${docContent.slice(0, 12000)}

Generate 10-20 multiple-choice quiz questions to test employee knowledge of this document.
Each question must have exactly 4 answer choices and one correct answer.
Include a mix of:
- "easy" questions (direct knowledge recall)
- "medium" questions (application and understanding)
- "hard" questions (analysis and edge cases)
- "scenario" questions ("What Would You Do?" situations, starting with "You are working a shift and...")

Extract a short topic tag (2-4 words, snake_case) that groups these questions.

Return ONLY a valid JSON array:
[
  {
    "topicTag": "customer_returns",
    "difficulty": "easy",
    "questionText": "What is the store's return window?",
    "answerChoices": ["7 days", "14 days", "30 days", "60 days"],
    "correctAnswerIndex": 2,
    "coachingText": "Our return policy allows 30 days with receipt. Always verify this with a receipt check first."
  }
]`;

      try {
        const response = await claudeCall({
          model: DEFAULT_MODEL,
          max_tokens: 5000,
          messages: [{ role: "user", content: quizPrompt }],
        }, 90_000);

        const raw = response.content?.[0]?.type === "text" ? response.content[0].text : "";
        const jsonMatch = raw.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const questions = JSON.parse(jsonMatch[0]);
          for (const q of questions) {
            if (!q.questionText || !Array.isArray(q.answerChoices) || q.answerChoices.length !== 4) continue;
            await db.insert(quizQuestions).values({
              storeId,
              sourceDocumentId: doc.id,
              jobId,
              topicTag: q.topicTag || "general",
              difficulty: q.difficulty || "medium",
              questionText: q.questionText,
              answerChoices: q.answerChoices,
              correctAnswerIndex: q.correctAnswerIndex ?? 0,
              coachingText: q.coachingText || null,
              isActive: true,
            });
          }
          await appendProgress(jobId, `Added ${questions.length} quiz questions from "${doc.originalFileName}"`);
        }
      } catch (err: unknown) {
        logger.warn({ err: err instanceof Error ? err.message : String(err), docId: doc.id }, "Failed to generate quiz questions");
        await appendProgress(jobId, `Skipped quiz questions for "${doc.originalFileName}"`);
      }
    }

    await appendProgress(
      jobId,
      `Generation complete! Created ${generatedItemIds.length} item(s) ready for review.`
    );

    await db
      .update(generationJobs)
      .set({
        status: "complete",
        resultsJson: { generatedItemIds },
        updatedAt: new Date(),
      })
      .where(eq(generationJobs.id, jobId));
  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? err.message : String(err), jobId }, "AI Studio generation job failed");
    try {
      await appendProgress(jobId, `Error: ${err instanceof Error ? err.message : String(err)}`);
      await db
        .update(generationJobs)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(generationJobs.id, jobId));
    } catch {}
  }
}
