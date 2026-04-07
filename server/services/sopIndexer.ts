import { db } from "../db";
import { eq, and, sql } from "drizzle-orm";
import { sopTemplates, sopSteps, sopEmbeddings } from "@shared/schema";
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

export async function searchSOPs(storeId: string, query: string, topK: number = 5): Promise<SOPSearchResult[]> {
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
  const templateIds = rows.filter((r: any) => r.source_type !== "sop_step").map((r: any) => r.source_id);

  let stepTemplateMap: Record<string, { templateId: string; templateTitle: string }> = {};

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
        stepTemplateMap[s.id] = {
          templateId: s.templateId,
          templateTitle: tMap[s.templateId] || "Unknown SOP",
        };
      }
    }
  }

  if (templateIds.length > 0) {
    const tRows = await db.select({
      id: sopTemplates.id,
      title: sopTemplates.title,
    }).from(sopTemplates)
      .where(sql`${sopTemplates.id} IN (${sql.join(templateIds.map((id: string) => sql`${id}`), sql`, `)})`);

    for (const t of tRows) {
      stepTemplateMap[t.id] = { templateId: t.id, templateTitle: t.title };
    }
  }

  return rows.map((r: any) => ({
    sourceType: r.source_type,
    sourceId: r.source_id,
    contentText: r.content_text,
    similarityScore: parseFloat(r.similarity_score) || 0,
    templateId: stepTemplateMap[r.source_id]?.templateId || r.source_id,
    templateTitle: stepTemplateMap[r.source_id]?.templateTitle || "Unknown SOP",
  }));
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
      const { workLocations } = await import("@shared/schema");
      const stores = await db.select({ id: workLocations.id }).from(workLocations);

      for (const store of stores) {
        await indexAllSOPs(store.id);
      }
      logger.info("[SOPIndexer] Nightly re-index complete");
    } catch (err: any) {
      logger.error({ error: err.message }, "[SOPIndexer] Nightly re-index failed");
    }
  }, 15 * 60 * 1000);

  logger.info("[SOPIndexer] Nightly cron started (checks every 15 minutes, runs at 2am)");
}
