import type { Express } from "express";
import { z } from "zod";
import { db } from "../db";
import { eq, and, desc, asc, sql, gte, lte, ilike, or } from "drizzle-orm";
import { issues, issueComments, insertIssueSchema, insertIssueCommentSchema, users, sopTemplates, workLocations, gtdInboxItems } from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import type { IStorage } from "../storage";
import { getIssueBasedSOPs } from "../services/sopSurfacing";
import { triggerClarification } from "../services/gtdClarificationAI";
import logger from "../lib/logger";

export function registerIssueRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  broadcastToAll: (data: any) => void
) {
  app.post('/api/issues', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;

    const allLocations = await db.select({ id: workLocations.id }).from(workLocations).limit(1);
    const storeId = allLocations[0]?.id;
    if (!storeId) throw new AppError(400, "No store configured", "NO_STORE");

    const body = insertIssueSchema.parse({
      ...req.body,
      storeId,
      reportedBy: userId,
      status: 'open',
      priority: req.body.priority || 'medium',
    });

    const [issue] = await db.insert(issues).values(body).returning();

    await storage.createActivityLog({
      userId,
      action: 'create',
      targetType: 'issue',
      targetId: issue.id,
      details: `Created issue: ${issue.title}`,
      metadata: { category: issue.category, priority: issue.priority },
    });

    broadcastToAll({ type: 'issue_created', data: { issue } });

    try {
      const relatedSOPs = await getIssueBasedSOPs(issue.category, issue.title, storeId);
      if (relatedSOPs.length > 0) {
        logger.info(
          { issueId: issue.id, sopCount: relatedSOPs.length, trigger: "issue_created" },
          "SOP surfacing: issue-based SOPs found"
        );
        broadcastToAll({
          type: "sop_surfaced",
          data: { sops: relatedSOPs, trigger: "issue_created", issueId: issue.id },
        });
      }
    } catch (err: any) {
      logger.error({ error: err.message }, "SOP surfacing error on issue creation");
    }

    try {
      const rawInput = `[Issue] ${issue.title}${issue.description ? ': ' + issue.description : ''}`;
      const [inboxItem] = await db.insert(gtdInboxItems).values({
        storeId,
        capturedBy: userId,
        rawInput,
        source: 'issue_auto',
        status: 'unprocessed',
      }).returning();

      const user = await storage.getUserWithRole(userId);
      const empName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : 'Unknown';
      const empRole = user?.role?.name || 'employee';

      triggerClarification(inboxItem.id, inboxItem.rawInput, storeId, empName, empRole, broadcastToAll)
        .catch(err => logger.error({ error: err.message, itemId: inboxItem.id }, 'GTD issue auto-capture clarification failed'));
    } catch (err: any) {
      logger.error({ error: err.message }, 'Failed to create GTD inbox item from issue');
    }

    res.status(201).json({ success: true, data: issue });
  }));

  app.get('/api/issues', isAuthenticated, asyncHandler(async (req: any, res) => {
    const {
      status, category, priority, assigned_to, date_from, date_to, search,
      limit: limitStr, offset: offsetStr,
    } = req.query as Record<string, string | undefined>;

    const conditions: any[] = [];
    if (status) conditions.push(eq(issues.status, status));
    if (category) conditions.push(eq(issues.category, category));
    if (priority) conditions.push(eq(issues.priority, priority));
    if (assigned_to) conditions.push(eq(issues.assignedTo, assigned_to));
    if (date_from) conditions.push(gte(issues.createdAt, new Date(date_from)));
    if (date_to) conditions.push(lte(issues.createdAt, new Date(date_to)));
    if (search) {
      conditions.push(or(
        ilike(issues.title, `%${search}%`),
        ilike(issues.description, `%${search}%`)
      ));
    }

    const limit = Math.min(Math.max(parseInt(limitStr || '50'), 1), 200);
    const offset = Math.max(parseInt(offsetStr || '0'), 0);

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db.select()
      .from(issues)
      .where(whereClause)
      .orderBy(
        asc(sql`CASE ${issues.priority} WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END`),
        desc(issues.createdAt)
      )
      .limit(limit)
      .offset(offset);

    const reporterIds = [...new Set(rows.map(r => r.reportedBy))];
    const assigneeIds = [...new Set(rows.filter(r => r.assignedTo).map(r => r.assignedTo!))];
    const allUserIds = [...new Set([...reporterIds, ...assigneeIds])];

    let userMap: Record<string, { firstName: string | null; lastName: string | null; profileImageUrl: string | null }> = {};
    if (allUserIds.length > 0) {
      const userRows = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
      }).from(users).where(
        sql`${users.id} IN (${sql.join(allUserIds.map(id => sql`${id}`), sql`, `)})`
      );
      userMap = Object.fromEntries(userRows.map(u => [u.id, u]));
    }

    const enriched = rows.map(r => ({
      ...r,
      reporterName: userMap[r.reportedBy]
        ? `${userMap[r.reportedBy].firstName || ''} ${userMap[r.reportedBy].lastName || ''}`.trim() || 'Unknown'
        : 'Unknown',
      assigneeName: r.assignedTo && userMap[r.assignedTo]
        ? `${userMap[r.assignedTo].firstName || ''} ${userMap[r.assignedTo].lastName || ''}`.trim()
        : null,
    }));

    res.json({ success: true, data: enriched });
  }));

  app.get('/api/issues/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const { id } = req.params;

    const [issue] = await db.select().from(issues).where(eq(issues.id, id));
    if (!issue) throw new AppError(404, "Issue not found", "NOT_FOUND");

    const comments = await db.select()
      .from(issueComments)
      .where(eq(issueComments.issueId, id))
      .orderBy(asc(issueComments.createdAt));

    const allUserIds = [
      issue.reportedBy,
      ...(issue.assignedTo ? [issue.assignedTo] : []),
      ...(issue.resolvedBy ? [issue.resolvedBy] : []),
      ...comments.map(c => c.authorId),
    ];
    const uniqueIds = [...new Set(allUserIds)];

    let userMap: Record<string, { firstName: string | null; lastName: string | null; profileImageUrl: string | null }> = {};
    if (uniqueIds.length > 0) {
      const userRows = await db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        profileImageUrl: users.profileImageUrl,
      }).from(users).where(
        sql`${users.id} IN (${sql.join(uniqueIds.map(uid => sql`${uid}`), sql`, `)})`
      );
      userMap = Object.fromEntries(userRows.map(u => [u.id, u]));
    }

    const userName = (uid: string) => {
      const u = userMap[uid];
      return u ? `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Unknown' : 'Unknown';
    };

    let relatedSop = null;
    if (issue.relatedSopId) {
      const [sop] = await db.select({ id: sopTemplates.id, title: sopTemplates.title })
        .from(sopTemplates).where(eq(sopTemplates.id, issue.relatedSopId));
      relatedSop = sop || null;
    }

    res.json({
      success: true,
      data: {
        ...issue,
        reporterName: userName(issue.reportedBy),
        reporterImage: userMap[issue.reportedBy]?.profileImageUrl || null,
        assigneeName: issue.assignedTo ? userName(issue.assignedTo) : null,
        resolverName: issue.resolvedBy ? userName(issue.resolvedBy) : null,
        relatedSop,
        comments: comments.map(c => ({
          ...c,
          authorName: userName(c.authorId),
          authorImage: userMap[c.authorId]?.profileImageUrl || null,
        })),
      },
    });
  }));

  app.put('/api/issues/:id', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const [existing] = await db.select().from(issues).where(eq(issues.id, id));
    if (!existing) throw new AppError(404, "Issue not found", "NOT_FOUND");

    const updateSchema = z.object({
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      category: z.string().optional(),
      priority: z.string().optional(),
      status: z.string().optional(),
      assignedTo: z.string().nullable().optional(),
      resolutionNotes: z.string().nullable().optional(),
    });

    const updates = updateSchema.parse(req.body);
    const statusChanging = updates.status && updates.status !== existing.status;

    const needsPermCheck = (statusChanging && ['in_progress', 'waiting', 'resolved', 'closed'].includes(updates.status!))
      || updates.assignedTo !== undefined;

    let isManager = false;
    if (needsPermCheck) {
      const perms = await storage.getUserPermissions(userId);
      isManager = perms.some(p => p.name === 'admin.manage_all' || p.name === 'hr.view_team');
    }

    if (statusChanging && ['in_progress', 'waiting', 'resolved', 'closed'].includes(updates.status!)) {
      if (!isManager && existing.reportedBy !== userId) {
        throw new AppError(403, "Only managers can change issue status", "FORBIDDEN");
      }
    }

    if (updates.assignedTo !== undefined && !isManager) {
      throw new AppError(403, "Only managers can assign issues", "FORBIDDEN");
    }

    const setPayload: any = { ...updates, updatedAt: new Date() };

    if (updates.status === 'resolved') {
      setPayload.resolvedAt = new Date();
      setPayload.resolvedBy = userId;
    }

    if (updates.status === 'open' && existing.status === 'resolved') {
      setPayload.resolvedAt = null;
      setPayload.resolvedBy = null;
    }

    const [updated] = await db.update(issues)
      .set(setPayload)
      .where(eq(issues.id, id))
      .returning();

    if (statusChanging) {
      await storage.createActivityLog({
        userId,
        action: 'status_change',
        targetType: 'issue',
        targetId: id,
        details: `Issue status changed from ${existing.status} to ${updates.status}`,
        metadata: { fromStatus: existing.status, toStatus: updates.status },
      });
    }

    broadcastToAll({ type: 'issue_updated', data: { issue: updated } });

    res.json({ success: true, data: updated });
  }));

  app.post('/api/issues/:id/comments', isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const [issue] = await db.select({ id: issues.id }).from(issues).where(eq(issues.id, id));
    if (!issue) throw new AppError(404, "Issue not found", "NOT_FOUND");

    const body = insertIssueCommentSchema.parse({
      ...req.body,
      issueId: id,
      authorId: userId,
    });

    const [comment] = await db.insert(issueComments).values(body).returning();

    const author = await storage.getUser(userId);
    const authorName = author ? `${author.firstName || ''} ${author.lastName || ''}`.trim() : 'Unknown';

    broadcastToAll({
      type: 'issue_comment_added',
      data: { issueId: id, comment: { ...comment, authorName } },
    });

    res.status(201).json({
      success: true,
      data: { ...comment, authorName, authorImage: author?.profileImageUrl || null },
    });
  }));
}
