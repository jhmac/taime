import { db } from '../db';
import { eq, and } from 'drizzle-orm';
import { sopTemplates, sopSteps, workLocations } from '@shared/schema';
import logger from '../lib/logger';

const HANDOFF_STEPS = [
  {
    stepOrder: 1,
    title: "Review open issues",
    description: "Check the issue tracker for any unresolved issues from this shift",
    stepType: "action" as const,
  },
  {
    stepOrder: 2,
    title: "Handoff notes",
    description: "Tell your teammate: what happened today, any customer situations, anything that needs attention",
    stepType: "action" as const,
  },
  {
    stepOrder: 3,
    title: "Check task board",
    description: "Review the task list — are there incomplete tasks to pass along?",
    stepType: "verification" as const,
  },
  {
    stepOrder: 4,
    title: "3S: Sweep",
    description: "Walk the store together. What's out of place?",
    stepType: "action" as const,
  },
  {
    stepOrder: 5,
    title: "3S: Sort",
    description: "Put things where they belong. Discard what doesn't",
    stepType: "action" as const,
  },
  {
    stepOrder: 6,
    title: "3S: Standardize",
    description: "Is everything set up the standard way? If not, fix it now",
    stepType: "action" as const,
  },
  {
    stepOrder: 7,
    title: "Ready to go",
    description: "Incoming team member confirms they're briefed and ready",
    stepType: "verification" as const,
  },
];

export async function seedShiftHandoffSOP(): Promise<void> {
  try {
    const stores = await db.select({ id: workLocations.id })
      .from(workLocations)
      .where(eq(workLocations.isActive, true));

    if (stores.length === 0) return;

    for (const store of stores) {
      const existing = await db.select({ id: sopTemplates.id })
        .from(sopTemplates)
        .where(and(
          eq(sopTemplates.storeId, store.id),
          eq(sopTemplates.category, 'shift_handoff'),
          eq(sopTemplates.isActive, true)
        ))
        .limit(1);

      if (existing.length > 0) continue;

      const [template] = await db.insert(sopTemplates).values({
        storeId: store.id,
        title: "Shift Handoff Protocol",
        description: "A structured handoff between shifts ensuring nothing falls through the cracks. Includes briefing, open issues review, and 3S.",
        category: "shift_handoff",
        estimatedDurationMinutes: 15,
        trainingNotes: "A smooth handoff means nothing falls through the cracks. The outgoing team member shares what happened, what's open, and what to watch for. The incoming team member asks questions and starts with 3S.",
        isActive: true,
        version: 1,
        createdBy: 'system',
      }).returning();

      await db.insert(sopSteps).values(
        HANDOFF_STEPS.map(step => ({ templateId: template.id, ...step }))
      );

      logger.info({ storeId: store.id, templateId: template.id }, 'Shift Handoff Protocol SOP seeded');
    }
  } catch (err: any) {
    logger.error({ error: err.message }, 'Failed to seed Shift Handoff SOP');
  }
}
