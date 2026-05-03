import { anthropic, withAiContext } from "../lib/aiClients";
import { config } from "../lib/config";
import { db } from "../db";
import { knowledgeDocuments } from "@shared/schema";
import { eq } from "drizzle-orm";
import logger from "../lib/logger";
import { indexKnowledgeDocument } from "./sopIndexer";

const MODEL = "claude-sonnet-4-20250514";

const VALID_DOCUMENT_TYPES = [
  "policy_manual",
  "sales_script",
  "sales_training",
  "style_guide",
  "operations_reference",
  "other",
] as const;

type DocumentType = typeof VALID_DOCUMENT_TYPES[number];
type MediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

interface ClaudeExtractionResult {
  extracted_text?: unknown;
  summary?: unknown;
  document_type?: unknown;
  tags?: unknown;
}

function isValidDocumentType(value: string): value is DocumentType {
  return VALID_DOCUMENT_TYPES.includes(value as DocumentType);
}

const MAX_CHUNK_CHARS = 80_000;

const EXTRACTION_SYSTEM = `You are a document analysis assistant for a retail store management system.
You extract and structure content from uploaded store documents (training manuals, sales scripts, operations manuals, style guides, HR policies, etc.).

Return a JSON object with this exact structure:
{
  "extracted_text": "Full preserved text with all structure intact (numbered steps, if/then branching, headers, bullets, exercises). Preserve ALL content.",
  "summary": "2-3 sentence summary of this section's content",
  "document_type": "policy_manual|sales_script|sales_training|style_guide|operations_reference|other",
  "tags": ["topic1", "topic2"] pick from: Customer Greeting, Add-On Sales, Body Type Styling, Scheduling, HR Policy, Product Knowledge, Inventory Management, Opening Procedures, Closing Procedures, Safety, Returns Policy, Commission, Visual Merchandising, Staff Training, Dress Code, Customer Service
}

Return ONLY valid JSON, no markdown fences or extra text.`;

async function extractFromImage(
  imageBase64: string,
  imageMimeType: MediaType,
  fileName: string
): Promise<{ partialExtracted: string; partialSummary: string; partialType: string; partialTags: string[] }> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: imageMimeType,
              data: imageBase64,
            },
          },
          {
            type: "text",
            text: `Extract and classify all text content from this store document image named "${fileName}". Transcribe everything visible including headers, steps, bullet points, and any training content.`,
          },
        ],
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed: ClaudeExtractionResult;
  try {
    parsed = JSON.parse(text.trim()) as ClaudeExtractionResult;
  } catch {
    parsed = {
      extracted_text: text,
      summary: "Document scanned from image.",
      document_type: "other",
      tags: [],
    };
  }
  return {
    partialExtracted: String(parsed.extracted_text ?? text),
    partialSummary: String(parsed.summary ?? ""),
    partialType: String(parsed.document_type ?? "other"),
    partialTags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
  };
}

async function extractChunk(
  chunk: string,
  fileName: string,
  chunkIndex: number,
  totalChunks: number
): Promise<{ partialExtracted: string; partialSummary: string; partialType: string; partialTags: string[] }> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: EXTRACTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Analyze this document chunk (${chunkIndex + 1} of ${totalChunks}) from file "${fileName}":\n\n${chunk}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed: ClaudeExtractionResult;
  try {
    parsed = JSON.parse(text.trim()) as ClaudeExtractionResult;
  } catch {
    parsed = { extracted_text: chunk, summary: "", document_type: "other", tags: [] };
  }
  return {
    partialExtracted: String(parsed.extracted_text ?? chunk),
    partialSummary: String(parsed.summary ?? ""),
    partialType: String(parsed.document_type ?? "other"),
    partialTags: Array.isArray(parsed.tags) ? parsed.tags.map(String) : [],
  };
}

async function mergeSummaries(
  summaries: string[],
  fileName: string,
  documentType: string
): Promise<string> {
  if (summaries.length === 1) return summaries[0];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: `Combine these section summaries from a "${documentType}" document called "${fileName}" into a single 2-3 sentence overall summary:\n\n${summaries.map((s, i) => `Section ${i + 1}: ${s}`).join("\n\n")}\n\nReturn ONLY the summary text, no extra explanation.`,
      },
    ],
  });
  return response.content.find((b) => b.type === "text")?.text.trim() ?? summaries[0];
}

function splitIntoChunks(text: string): string[] {
  if (text.length <= MAX_CHUNK_CHARS) return [text];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    let end = Math.min(offset + MAX_CHUNK_CHARS, text.length);
    if (end < text.length) {
      const lastNewline = text.lastIndexOf("\n", end);
      if (lastNewline > offset + MAX_CHUNK_CHARS * 0.5) end = lastNewline + 1;
    }
    chunks.push(text.slice(offset, end));
    offset = end;
  }
  return chunks;
}

interface ImageContext {
  imageBase64?: string;
  imageMimeType?: MediaType;
}

export async function processKnowledgeDocument(
  documentId: string,
  rawText: string,
  fileName: string,
  imageCtx?: ImageContext
): Promise<void> {
  try {
    await db
      .update(knowledgeDocuments)
      .set({ processingStatus: "processing", updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, documentId));

    logger.info({ documentId, fileName, isImage: !!imageCtx?.imageBase64 }, "knowledge: starting extraction");

    let results: { partialExtracted: string; partialSummary: string; partialType: string; partialTags: string[] }[];

    if (imageCtx?.imageBase64 && imageCtx.imageMimeType) {
      const r = await extractFromImage(imageCtx.imageBase64, imageCtx.imageMimeType, fileName);
      results = [r];
    } else {
      const chunks = splitIntoChunks(rawText);
      results = await Promise.all(
        chunks.map((chunk, idx) => extractChunk(chunk, fileName, idx, chunks.length))
      );
    }

    const extractedText = results.map((r) => r.partialExtracted).join("\n\n---\n\n");
    const summaries = results.map((r) => r.partialSummary);

    const typeCounts: Record<string, number> = {};
    for (const r of results) {
      typeCounts[r.partialType] = (typeCounts[r.partialType] ?? 0) + 1;
    }
    const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "other";
    const documentType: DocumentType = isValidDocumentType(dominantType) ? dominantType : "other";

    const rawTags = results.flatMap((r) => r.partialTags);
    const uniqueTags = Array.from(new Set(rawTags)).slice(0, 10);

    const summaryFromClaude = await mergeSummaries(summaries, fileName, documentType);

    await db
      .update(knowledgeDocuments)
      .set({
        extractedText,
        summaryFromClaude,
        documentType,
        autoTags: uniqueTags,
        processingStatus: "ready",
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, documentId));

    logger.info({ documentId, documentType, tags: uniqueTags }, "knowledge: extraction complete");

    indexKnowledgeDocument(documentId).catch((err: Error) =>
      logger.warn({ documentId, error: err.message }, "knowledge: background index after extraction failed")
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logger.error({ documentId, error: message }, "knowledge: extraction failed");
    await db
      .update(knowledgeDocuments)
      .set({
        processingStatus: "failed",
        errorMessage: message,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, documentId));
  }
}
