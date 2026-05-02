import { db } from "../db";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { sopTemplates, sopSteps, sopEmbeddings, aiGeneratedItems, knowledgeDocuments, workLocations } from "@shared/schema";
import { generateEmbedding, contentHash } from "./embeddingService";
import logger from "../lib/logger";

export interface SOPSearchResult {
  sourceType: string;
  sourceId: string;
  contentText: string;
  similarityScore: number;
  templateId: string;
  templateTitle: string;
}

interface EmbeddingEntry {
  storeId: string;
  sourceType: string;
  sourceId: string;
  contentText: string;
  contentHash: string;
  embedding: number[];
}

async function upsertEmbedding(entry: EmbeddingEntry): Promise<boolean> {
  const [existing] = await db.select({
    id: sopEmbeddings.id,
    contentHash: sopEmbeddings.contentHash,
  }).from(sopEmbeddings)
    .where(and(
      eq(sopEmbeddings.sourceId, entry.sourceId),
      eq(sopEmbeddings.sourceType, entry.sourceType),
    ));

  if (existing && existing.contentHash === entry.contentHash) {
    return false;
  }

  const embeddingStr = `[${entry.embedding.join(",")}]`;

  if (existing) {
    await db.execute(sql`
      UPDATE sop_embeddings
      SET content_text = ${entry.contentText},
          content_hash = ${entry.contentHash},
          embedding = ${embeddingStr}::vector,
          updated_at = NOW()
      WHERE id = ${existing.id}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO sop_embeddings (store_id, source_type, source_id, content_text, content_hash, embedding)
      VALUES (${entry.storeId}, ${entry.sourceType}, ${entry.sourceId}, ${entry.contentText}, ${entry.contentHash}, ${embeddingStr}::vector)
    `);
  }

  return true;
}

export async function indexSOPTemplate(templateId: string): Promise<{ indexed: number; skipped: number }> {
  let indexed = 0;
  let skipped = 0;

  const [template] = await db.select().from(sopTemplates)
    .where(eq(sopTemplates.id, templateId));

  if (!template) {
    logger.warn({ templateId }, "[SOPIndexer] Template not found");
    return { indexed: 0, skipped: 0 };
  }

  const steps = await db.select().from(sopSteps)
    .where(eq(sopSteps.templateId, templateId))
    .orderBy(sopSteps.stepOrder);

  const templateText = [template.title, template.description].filter(Boolean).join(" — ");
  const templateHash = contentHash(templateText);
  const templateEmbedding = await generateEmbedding(templateText);

  if (templateEmbedding) {
    const changed = await upsertEmbedding({
      storeId: template.storeId,
      sourceType: "sop_template",
      sourceId: template.id,
      contentText: templateText,
      contentHash: templateHash,
      embedding: templateEmbedding,
    });
    if (changed) indexed++; else skipped++;
  }

  if (template.trainingNotes) {
    const trainingText = `${template.title}: ${template.trainingNotes}`;
    const trainingHash = contentHash(trainingText);
    const trainingEmbedding = await generateEmbedding(trainingText);

    if (trainingEmbedding) {
      const changed = await upsertEmbedding({
        storeId: template.storeId,
        sourceType: "sop_training_notes",
        sourceId: template.id,
        contentText: trainingText,
        contentHash: trainingHash,
        embedding: trainingEmbedding,
      });
      if (changed) indexed++; else skipped++;
    }
  }

  for (const step of steps) {
    let stepText = `Step ${step.stepOrder}: ${step.title}`;
    if (step.description) stepText += ` — ${step.description}`;
    if (step.trainingDetail) stepText += ` [Training: ${step.trainingDetail}]`;

    const stepHash = contentHash(stepText);
    const stepEmbedding = await generateEmbedding(stepText);

    if (stepEmbedding) {
      const changed = await upsertEmbedding({
        storeId: template.storeId,
        sourceType: "sop_step",
        sourceId: step.id,
        contentText: stepText,
        contentHash: stepHash,
        embedding: stepEmbedding,
      });
      if (changed) indexed++; else skipped++;
    }
  }

  logger.info({ templateId, title: template.title, indexed, skipped }, "[SOPIndexer] Template indexed");
  return { indexed, skipped };
}

export async function indexAllSOPs(storeId: string): Promise<{ indexed: number; skipped: number }> {
  const templates = await db.select({ id: sopTemplates.id })
    .from(sopTemplates)
    .where(and(
      eq(sopTemplates.storeId, storeId),
      eq(sopTemplates.isActive, true),
    ));

  let totalIndexed = 0;
  let totalSkipped = 0;

  for (const t of templates) {
    const result = await indexSOPTemplate(t.id);
    totalIndexed += result.indexed;
    totalSkipped += result.skipped;
  }

  logger.info({ storeId, templates: templates.length, totalIndexed, totalSkipped }, "[SOPIndexer] Full index complete");
  return { indexed: totalIndexed, skipped: totalSkipped };
}

function extractAiItemText(item: typeof aiGeneratedItems.$inferSelect): string {
  const content = (item.content || {}) as Record<string, unknown>;
  const parts: string[] = [item.title];

  if (item.type === "sop") {
    if (content.role) parts.push(`Role: ${content.role}`);
    if (content.summary) parts.push(String(content.summary));
    if (Array.isArray(content.steps)) {
      for (const step of content.steps as Array<{ title?: string; description?: string }>) {
        if (step.title) parts.push(step.title);
        if (step.description) parts.push(step.description);
      }
    }
  } else if (item.type === "training") {
    if (content.description) parts.push(String(content.description));
    if (Array.isArray(content.objectives)) {
      parts.push((content.objectives as string[]).join(". "));
    }
    if (content.markdownContent) parts.push(String(content.markdownContent).slice(0, 2000));
    else if (content.content) parts.push(String(content.content).slice(0, 2000));
  } else if (item.type === "task") {
    if (Array.isArray(content.tasks)) {
      for (const t of content.tasks as Array<{ title?: string; description?: string }>) {
        if (t.title) parts.push(t.title);
        if (t.description) parts.push(t.description);
      }
    }
  } else if (item.type === "knowledge_base") {
    if (content.summary) parts.push(String(content.summary));
    if (Array.isArray(content.paragraphs)) {
      for (const p of content.paragraphs as Array<{ heading?: string; body?: string }>) {
        if (p.heading) parts.push(p.heading);
        if (p.body) parts.push(p.body);
      }
    }
  }

  return parts.filter(Boolean).join(" | ").slice(0, 3000);
}

export async function indexAiGeneratedItem(itemId: string): Promise<{ indexed: number; skipped: number }> {
  const [item] = await db.select().from(aiGeneratedItems)
    .where(eq(aiGeneratedItems.id, itemId));

  if (!item || !item.storeId) {
    logger.warn({ itemId }, "[SOPIndexer] AI item not found or missing storeId");
    return { indexed: 0, skipped: 0 };
  }

  const text = extractAiItemText(item);
  if (!text || text.length < 5) return { indexed: 0, skipped: 0 };

  const hash = contentHash(text);
  const embedding = await generateEmbedding(text);
  if (!embedding) return { indexed: 0, skipped: 0 };

  const changed = await upsertEmbedding({
    storeId: item.storeId,
    sourceType: "ai_item",
    sourceId: item.id,
    contentText: text,
    contentHash: hash,
    embedding,
  });

  logger.info({ itemId, title: item.title, changed }, "[SOPIndexer] AI item indexed");
  return { indexed: changed ? 1 : 0, skipped: changed ? 0 : 1 };
}

const CHUNK_SIZE = 1000;

export async function indexKnowledgeDocument(docId: string): Promise<{ indexed: number; skipped: number }> {
  const [doc] = await db.select().from(knowledgeDocuments)
    .where(eq(knowledgeDocuments.id, docId));

  if (!doc || !doc.storeId) {
    logger.warn({ docId }, "[SOPIndexer] Knowledge doc not found or missing storeId");
    return { indexed: 0, skipped: 0 };
  }

  const fullText = doc.extractedText || doc.rawContent || "";
  if (!fullText || fullText.length < 10) return { indexed: 0, skipped: 0 };

  const chunks: string[] = [];
  for (let i = 0; i < fullText.length; i += CHUNK_SIZE) {
    chunks.push(fullText.slice(i, i + CHUNK_SIZE));
  }

  let indexed = 0;
  let skipped = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = `[${doc.originalFileName}] ${chunks[i]}`;
    const hash = contentHash(chunkText);
    const embedding = await generateEmbedding(chunkText);
    if (!embedding) continue;

    const changed = await upsertEmbedding({
      storeId: doc.storeId,
      sourceType: "knowledge_doc",
      sourceId: `${docId}:chunk:${i}`,
      contentText: chunkText,
      contentHash: hash,
      embedding,
    });
    if (changed) indexed++; else skipped++;
  }

  logger.info({ docId, filename: doc.originalFileName, chunks: chunks.length, indexed, skipped }, "[SOPIndexer] Knowledge doc indexed");
  return { indexed, skipped };
}

export async function indexAllAiContent(storeId: string): Promise<{ indexed: number; skipped: number }> {
  let totalIndexed = 0;
  let totalSkipped = 0;

  const items = await db.select({ id: aiGeneratedItems.id })
    .from(aiGeneratedItems)
    .where(and(
      eq(aiGeneratedItems.storeId, storeId),
      sql`${aiGeneratedItems.status} IN ('in_review', 'approved', 'published')`,
    ));

  for (const item of items) {
    const result = await indexAiGeneratedItem(item.id);
    totalIndexed += result.indexed;
    totalSkipped += result.skipped;
  }

  const docs = await db.select({ id: knowledgeDocuments.id })
    .from(knowledgeDocuments)
    .where(and(
      eq(knowledgeDocuments.storeId, storeId),
      isNotNull(knowledgeDocuments.extractedText),
    ));

  for (const doc of docs) {
    const result = await indexKnowledgeDocument(doc.id);
    totalIndexed += result.indexed;
    totalSkipped += result.skipped;
  }

  logger.info({ storeId, items: items.length, docs: docs.length, totalIndexed, totalSkipped }, "[SOPIndexer] AI content index complete");
  return { indexed: totalIndexed, skipped: totalSkipped };
}

export async function searchSOPs(storeId: string, query: string, topK: number = 10): Promise<SOPSearchResult[]> {
  const queryEmbedding = await generateEmbedding(query);
  if (!queryEmbedding) {
    logger.warn("[SOPIndexer] Could not generate query embedding");
    return [];
  }

  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  const results = await db.execute(sql`
    SELECT
      se.source_type,
      se.source_id,
      se.content_text,
      1 - (se.embedding <=> ${embeddingStr}::vector) as similarity_score
    FROM sop_embeddings se
    WHERE se.store_id = ${storeId}
    ORDER BY se.embedding <=> ${embeddingStr}::vector
    LIMIT ${topK}
  `);

  const rows = (results as any).rows || results;
  if (!rows || rows.length === 0) return [];

  const stepIds = rows.filter((r: any) => r.source_type === "sop_step").map((r: any) => r.source_id);
  const sopTemplateIds = rows
    .filter((r: any) => r.source_type === "sop_template" || r.source_type === "sop_training_notes")
    .map((r: any) => r.source_id);
  const aiItemIds = rows.filter((r: any) => r.source_type === "ai_item").map((r: any) => r.source_id);
  const knowledgeDocChunkIds = rows
    .filter((r: any) => r.source_type === "knowledge_doc")
    .map((r: any) => (r.source_id as string).split(":chunk:")[0]);

  const titleMap: Record<string, { templateId: string; templateTitle: string }> = {};

  if (stepIds.length > 0) {
    const stepRows = await db.select({
      id: sopSteps.id,
      templateId: sopSteps.templateId,
    }).from(sopSteps)
      .where(sql`${sopSteps.id} IN (${sql.join(stepIds.map((id: string) => sql`${id}`), sql`, `)})`);

    const tIds = Array.from(new Set(stepRows.map(s => s.templateId)));
    if (tIds.length > 0) {
      const tRows = await db.select({
        id: sopTemplates.id,
        title: sopTemplates.title,
      }).from(sopTemplates)
        .where(sql`${sopTemplates.id} IN (${sql.join(tIds.map((id: string) => sql`${id}`), sql`, `)})`);

      const tMap = Object.fromEntries(tRows.map(t => [t.id, t.title]));
      for (const s of stepRows) {
        titleMap[s.id] = {
          templateId: s.templateId,
          templateTitle: tMap[s.templateId] || "Unknown SOP",
        };
      }
    }
  }

  if (sopTemplateIds.length > 0) {
    const tRows = await db.select({
      id: sopTemplates.id,
      title: sopTemplates.title,
    }).from(sopTemplates)
      .where(sql`${sopTemplates.id} IN (${sql.join(sopTemplateIds.map((id: string) => sql`${id}`), sql`, `)})`);

    for (const t of tRows) {
      titleMap[t.id] = { templateId: t.id, templateTitle: t.title };
    }
  }

  if (aiItemIds.length > 0) {
    const aiRows = await db.select({
      id: aiGeneratedItems.id,
      title: aiGeneratedItems.title,
    }).from(aiGeneratedItems)
      .where(sql`${aiGeneratedItems.id} IN (${sql.join(aiItemIds.map((id: string) => sql`${id}`), sql`, `)})`);

    for (const ai of aiRows) {
      titleMap[ai.id] = { templateId: ai.id, templateTitle: ai.title };
    }
  }

  if (knowledgeDocChunkIds.length > 0) {
    const uniqueDocIds: string[] = Array.from(new Set(knowledgeDocChunkIds));
    const docRows = await db.select({
      id: knowledgeDocuments.id,
      originalFileName: knowledgeDocuments.originalFileName,
    }).from(knowledgeDocuments)
      .where(sql`${knowledgeDocuments.id} IN (${sql.join(uniqueDocIds.map((id) => sql`${id}`), sql`, `)})`);

    for (const doc of docRows) {
      const displayTitle = doc.originalFileName.replace(/\.[^.]+$/, "");
      const chunkRows = rows.filter((r: any) =>
        r.source_type === "knowledge_doc" && (r.source_id as string).startsWith(doc.id)
      );
      for (const cr of chunkRows) {
        titleMap[cr.source_id] = { templateId: doc.id, templateTitle: displayTitle };
      }
    }
  }

  return rows.map((r: any) => ({
    sourceType: r.source_type,
    sourceId: r.source_id,
    contentText: r.content_text,
    similarityScore: parseFloat(r.similarity_score) || 0,
    templateId: titleMap[r.source_id]?.templateId || r.source_id,
    templateTitle: titleMap[r.source_id]?.templateTitle || "Store Content",
  }));
}

export async function runStartupAiContentBackfill(): Promise<void> {
  try {
    const stores = await db.select({ id: workLocations.id }).from(workLocations);
    let totalIndexed = 0;
    for (const store of stores) {
      const result = await indexAllAiContent(store.id);
      totalIndexed += result.indexed;
    }
    logger.info({ stores: stores.length, totalIndexed }, "[SOPIndexer] Startup AI content backfill complete");
  } catch (err: any) {
    logger.error({ error: err.message }, "[SOPIndexer] Startup AI content backfill failed");
  }
}

let lastNightlyRun = "";

export function startSOPIndexCron() {
  setInterval(async () => {
    const today = new Date().toISOString().split("T")[0];
    const hour = new Date().getHours();

    if (hour !== 2 || lastNightlyRun === today) return;
    lastNightlyRun = today;

    logger.info("[SOPIndexer] Starting nightly re-index");
    try {
      const stores = await db.select({ id: workLocations.id }).from(workLocations);

      for (const store of stores) {
        await indexAllSOPs(store.id);
        await indexAllAiContent(store.id);
      }
      logger.info("[SOPIndexer] Nightly re-index complete");
    } catch (err: any) {
      logger.error({ error: err.message }, "[SOPIndexer] Nightly re-index failed");
    }
  }, 15 * 60 * 1000);

  logger.info("[SOPIndexer] Nightly cron started (checks every 15 minutes, runs at 2am)");
}
