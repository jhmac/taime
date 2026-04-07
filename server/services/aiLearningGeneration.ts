import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config";
import { db } from "../db";
import { generationJobs, sopDocuments, sopCategories, trainingModules, companyAiContext } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";
import logger from "../lib/logger";

const anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

interface GeneratedSOP {
  title: string;
  category: string;
  role: string;
  steps: Array<{
    order: number;
    title: string;
    description: string;
    type: "action" | "verification" | "decision";
    decisionOptions?: Array<{ condition: string; action: string }>;
  }>;
  sourceDocumentId?: string;
  sourceDocumentTitle?: string;
}

interface GeneratedTrainingModule {
  title: string;
  role: string;
  objectives: string[];
  content: string;
  exercises: Array<{ scenario: string; question: string; guidance: string }>;
  estimatedMinutes: number;
  sourceDocumentId?: string;
  sourceDocumentTitle?: string;
}

interface GenerationResults {
  sops: GeneratedSOP[];
  trainingModules: GeneratedTrainingModule[];
}

async function appendProgress(jobId: string, message: string) {
  try {
    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    if (!job) return;
    const log = (job.progressLog as string[]) || [];
    log.push(message);
    await db.update(generationJobs).set({ progressLog: log, updatedAt: new Date() }).where(eq(generationJobs.id, jobId));
  } catch (err: any) {
    logger.warn({ err: err.message }, "Failed to append progress log");
  }
}

export async function runGenerationJob(jobId: string): Promise<void> {
  try {
    await db.update(generationJobs).set({ status: "running", updatedAt: new Date() }).where(eq(generationJobs.id, jobId));

    const [job] = await db.select().from(generationJobs).where(eq(generationJobs.id, jobId));
    if (!job) throw new Error("Job not found");

    const [context] = await db.select().from(companyAiContext).limit(1);
    const storeName = context?.storeName || "Our Store";
    const businessType = context?.businessType || "Fashion Boutique";
    const brandVoice = context?.brandVoice || "professional and warm";
    const teamRoles = (context?.teamRoles as string[]) || ["New Associate", "Lead", "Manager"];
    const goals = (context?.goals as string[]) || [];

    const docIds = (job.selectedDocumentIds as string[]) || [];
    const outputTypes = (job.outputTypes as string[]) || [];
    const targetRoles = (job.targetRoles as string[]) || teamRoles;
    const selectedCategories = (job.selectedCategories as string[]) || [];

    let documents: typeof sopDocuments.$inferSelect[] = [];
    if (docIds.length > 0) {
      documents = await db.select().from(sopDocuments).where(inArray(sopDocuments.id, docIds));
    } else {
      documents = await db.select().from(sopDocuments).where(eq(sopDocuments.isPublished, true));
    }

    if (documents.length === 0) {
      await appendProgress(jobId, "No documents found. Please add knowledge base documents first.");
      await db.update(generationJobs).set({ status: "failed", updatedAt: new Date() }).where(eq(generationJobs.id, jobId));
      return;
    }

    await appendProgress(jobId, `Analyzing ${documents.length} document(s) from your knowledge base...`);

    const documentContext = documents.map(d =>
      `### Document: "${d.title}"\nContent:\n${d.content}\n${d.summary ? `Summary: ${d.summary}` : ""}`
    ).join("\n\n---\n\n");

    const results: GenerationResults = { sops: [], trainingModules: [] };

    if (outputTypes.includes("sops")) {
      await appendProgress(jobId, "Building SOPs from your documents...");
      for (const doc of documents) {
        await appendProgress(jobId, `Analyzing "${doc.title}" for SOP structure...`);

        const sopPrompt = `You are an expert retail operations consultant specializing in fashion boutiques. 
        
Generate structured SOPs for the store based on this document. The store name is "${storeName}" (${businessType}).
Brand voice: ${brandVoice}
Target roles: ${targetRoles.join(", ")}
${goals.length > 0 ? `Business goals: ${goals.join(", ")}` : ""}
${selectedCategories.length > 0 ? `Focus categories: ${selectedCategories.join(", ")}` : ""}

DOCUMENT TO ANALYZE:
${doc.title}
${doc.content}

INSTRUCTIONS:
- Preserve all brand-specific names, product lines, and terminology exactly as written
- Convert if/then dialogue branches into structured decision-tree steps
- Create 1-3 SOPs that can be derived from this document
- Each SOP should have a clear title, role assignment, and numbered steps
- For steps with branching logic, use type "decision" and include decisionOptions
- Focus on actionable, specific steps not generic advice

Return a JSON object with this exact structure:
{
  "sops": [
    {
      "title": "SOP title",
      "category": "one of: customer_service, sales, opening, closing, inventory, visual_merchandising, custom",
      "role": "target role",
      "steps": [
        {
          "order": 1,
          "title": "Step title",
          "description": "Detailed description",
          "type": "action",
          "decisionOptions": null
        },
        {
          "order": 2,
          "title": "Decision point title",
          "description": "When to choose each path",
          "type": "decision",
          "decisionOptions": [
            { "condition": "If customer says X", "action": "Do Y" },
            { "condition": "If customer says Z", "action": "Do W" }
          ]
        }
      ]
    }
  ]
}`;

        try {
          const response = await anthropic.messages.create({
            model: DEFAULT_MODEL,
            max_tokens: 4096,
            messages: [{ role: "user", content: sopPrompt }],
          });

          const text = response.content[0].type === "text" ? response.content[0].text : "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.sops && Array.isArray(parsed.sops)) {
              for (const sop of parsed.sops) {
                sop.sourceDocumentId = doc.id;
                sop.sourceDocumentTitle = doc.title;
                results.sops.push(sop);
                await appendProgress(jobId, `Built SOP: "${sop.title}"`);
              }
            }
          }
        } catch (err: any) {
          logger.warn({ err: err.message, docId: doc.id }, "Failed to generate SOPs for document");
          await appendProgress(jobId, `Skipped "${doc.title}" — could not parse structure`);
        }
      }
    }

    if (outputTypes.includes("training")) {
      await appendProgress(jobId, "Building training modules from your documents...");

      const trainingSequence = ["Greeting", "Qualifying", "Dressing Room", "Closing", "Add-Ons", "Follow-Up"];

      for (const doc of documents) {
        await appendProgress(jobId, `Extracting training content from "${doc.title}"...`);

        const trainingPrompt = `You are an expert retail training developer specializing in fashion boutiques.

Generate training modules from this document for "${storeName}" (${businessType}).
Brand voice: ${brandVoice}
Target roles: ${targetRoles.join(", ")}
${goals.length > 0 ? `Business goals: ${goals.join(", ")}` : ""}

Natural training sequence to consider: ${trainingSequence.join(" → ")}

DOCUMENT TO ANALYZE:
${doc.title}
${doc.content}

INSTRUCTIONS:
- Preserve all brand-specific names, product lines, scripts, and terminology exactly
- Detect and extract training exercises (like "Let's Apply It" sections) as scenario-based questions
- Structure content following the boutique's natural sales sequence when applicable
- Create 1-2 training modules from this document
- Include clear learning objectives and practical exercises

Return a JSON object with this exact structure:
{
  "trainingModules": [
    {
      "title": "Module title",
      "role": "target role (e.g., New Associate)",
      "objectives": ["Objective 1", "Objective 2"],
      "content": "Full module content in markdown format with sections, explanations, and examples from the document",
      "exercises": [
        {
          "scenario": "Customer scenario description",
          "question": "What would you do/say?",
          "guidance": "Guidance on the ideal response based on the training"
        }
      ],
      "estimatedMinutes": 20
    }
  ]
}`;

        try {
          const response = await anthropic.messages.create({
            model: DEFAULT_MODEL,
            max_tokens: 4096,
            messages: [{ role: "user", content: trainingPrompt }],
          });

          const text = response.content[0].type === "text" ? response.content[0].text : "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.trainingModules && Array.isArray(parsed.trainingModules)) {
              for (const mod of parsed.trainingModules) {
                mod.sourceDocumentId = doc.id;
                mod.sourceDocumentTitle = doc.title;
                results.trainingModules.push(mod);
                await appendProgress(jobId, `Built training module: "${mod.title}"`);
                await appendProgress(jobId, `Generating quiz questions for "${mod.title}"...`);
              }
            }
          }
        } catch (err: any) {
          logger.warn({ err: err.message, docId: doc.id }, "Failed to generate training module");
          await appendProgress(jobId, `Skipped training for "${doc.title}" — could not parse content`);
        }
      }
    }

    await appendProgress(jobId, `Generation complete! Created ${results.sops.length} SOP(s) and ${results.trainingModules.length} training module(s).`);

    await db.update(generationJobs).set({
      status: "complete",
      resultsJson: results as any,
      updatedAt: new Date(),
    }).where(eq(generationJobs.id, jobId));

  } catch (err: any) {
    logger.error({ err: err.message, jobId }, "Generation job failed");
    try {
      await appendProgress(jobId, `Error: ${err.message}`);
      await db.update(generationJobs).set({ status: "failed", updatedAt: new Date() }).where(eq(generationJobs.id, jobId));
    } catch {}
  }
}
