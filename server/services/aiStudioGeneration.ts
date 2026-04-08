import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config";
import { db } from "../db";
import {
  generationJobs,
  knowledgeDocuments,
  companyAiContext,
  aiGeneratedItems,
} from "@shared/schema";
import { eq, inArray, and } from "drizzle-orm";
import logger from "../lib/logger";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

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

    await appendProgress(
      jobId,
      `Analyzing ${documents.length} document(s) from your source library...`
    );

    const generatedItemIds: string[] = [];

    for (const doc of documents) {
      const docContent =
        doc.extractedText || doc.rawContent || "";
      const docSummary = doc.summaryFromClaude || "";

      if (outputTypes.includes("sops")) {
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
          const response = await anthropic.messages.create({
            model: DEFAULT_MODEL,
            max_tokens: 4096,
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

      if (outputTypes.includes("training")) {
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
${docContent.slice(0, 15000)}

Create 1-2 training modules from this document.

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
          const response = await anthropic.messages.create({
            model: DEFAULT_MODEL,
            max_tokens: 4096,
            messages: [{ role: "user", content: trainingPrompt }],
          });

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

      if (outputTypes.includes("tasks")) {
        await appendProgress(jobId, `Generating task lists from "${doc.originalFileName}"...`);

        const taskPrompt = `You are a retail operations expert. Generate actionable task checklists for "${storeName}" (${businessType}).
Target roles: ${targetRoles.join(", ")}

SOURCE DOCUMENT: ${doc.originalFileName}
CONTENT:
${docContent.slice(0, 10000)}

Create 1-2 task lists (e.g., opening checklist, closing checklist, daily tasks).

Return a JSON array:
[
  {
    "title": "Task list title (e.g., Opening Checklist)",
    "role": "target role",
    "description": "Brief description",
    "frequency": "daily|weekly|monthly|as-needed",
    "tasks": [
      {
        "order": 1,
        "title": "Task title",
        "description": "What to do",
        "isRequired": true,
        "estimatedMinutes": 5
      }
    ]
  }
]

Return ONLY the JSON array, no other text.`;

        try {
          const response = await anthropic.messages.create({
            model: DEFAULT_MODEL,
            max_tokens: 3000,
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

      if (outputTypes.includes("knowledge_base")) {
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
          const response = await anthropic.messages.create({
            model: DEFAULT_MODEL,
            max_tokens: 3000,
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
