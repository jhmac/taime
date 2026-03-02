import type { Express, RequestHandler } from "express";
import { eq, and, desc, sql, lt, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { messageThreads, threadParticipants, threadMessages, users } from "@shared/schema";
import type { IStorage } from "../storage";
import { resolveStoreId } from "../lib/storeResolver";

const createThreadSchema = z.object({
  thread_type: z.enum(["direct", "group", "channel"]),
  title: z.string().optional(),
  participant_ids: z.array(z.string()).min(1),
});

const sendMessageSchema = z.object({
  content: z.string().min(1).max(5000),
  message_type: z.enum(["text", "image", "system"]).default("text"),
  image_url: z.string().optional(),
  reply_to_id: z.string().optional(),
  temp_id: z.string().optional(),
});

const editMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

export function registerMessageRoutes(
  app: Express,
  _storage: IStorage,
  isAuthenticated: RequestHandler,
  sendToUsers: (userIds: string[], data: Record<string, unknown>) => void,
) {

  app.get("/api/messages/contacts", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      const allUsers = await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
          roleId: users.roleId,
        })
        .from(users)
        .where(eq(users.isActive, true));
      const contacts = allUsers.filter(u => u.id !== userId);
      res.json(contacts);
    } catch (error) {
      console.error("Error fetching messaging contacts:", error);
      res.status(500).json({ message: "Failed to fetch contacts" });
    }
  });

  app.get("/api/messages/threads", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const myThreadIds = await db
        .select({ threadId: threadParticipants.threadId })
        .from(threadParticipants)
        .where(eq(threadParticipants.userId, user.id));

      if (myThreadIds.length === 0) {
        return res.json({ success: true, data: [] });
      }

      const threadIdList = myThreadIds.map(t => t.threadId);

      const threads = await db
        .select()
        .from(messageThreads)
        .where(inArray(messageThreads.id, threadIdList))
        .orderBy(desc(messageThreads.updatedAt));

      const allParticipants = await db
        .select()
        .from(threadParticipants)
        .where(inArray(threadParticipants.threadId, threadIdList));

      const participantUserIds = [...new Set(allParticipants.map(p => p.userId))];
      const userRows = participantUserIds.length > 0
        ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, participantUserIds))
        : [];
      const userMap = new Map(userRows.map(u => [u.id, u]));

      const lastMessages = await db.execute(sql`
        SELECT DISTINCT ON (thread_id) thread_id, id, sender_id, content, message_type, deleted_at, created_at
        FROM thread_messages
        WHERE thread_id = ANY(${threadIdList})
        ORDER BY thread_id, created_at DESC
      `);

      const lastMsgMap = new Map<string, any>();
      for (const row of lastMessages.rows) {
        lastMsgMap.set(row.thread_id as string, row);
      }

      const myParticipantMap = new Map(
        allParticipants
          .filter(p => p.userId === user.id)
          .map(p => [p.threadId, p])
      );

      const unreadCounts = await db.execute(sql`
        SELECT m.thread_id, COUNT(*) as count
        FROM thread_messages m
        JOIN thread_participants p ON p.thread_id = m.thread_id AND p.user_id = ${user.id}
        WHERE m.thread_id = ANY(${threadIdList})
          AND m.sender_id != ${user.id}
          AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
        GROUP BY m.thread_id
      `);
      const unreadMap = new Map<string, number>();
      for (const row of unreadCounts.rows) {
        unreadMap.set(row.thread_id as string, Number(row.count));
      }

      const result = threads.map(thread => {
        const participants = allParticipants
          .filter(p => p.threadId === thread.id)
          .map(p => ({
            userId: p.userId,
            firstName: userMap.get(p.userId)?.firstName || null,
            lastName: userMap.get(p.userId)?.lastName || null,
          }));

        const lastMsg = lastMsgMap.get(thread.id);
        const lastMessage = lastMsg ? {
          content: lastMsg.deleted_at ? "[Message deleted]" : lastMsg.content,
          senderId: lastMsg.sender_id,
          senderName: userMap.get(lastMsg.sender_id as string)?.firstName || "Unknown",
          createdAt: lastMsg.created_at,
          messageType: lastMsg.message_type,
        } : null;

        return {
          ...thread,
          participants,
          lastMessage,
          unreadCount: unreadMap.get(thread.id) || 0,
        };
      });

      res.json({ success: true, data: result });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/messages/threads", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const parsed = createThreadSchema.parse(req.body);
      const allParticipantIds = [...new Set([user.id, ...parsed.participant_ids])];

      const validUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, parsed.participant_ids));
      if (validUsers.length !== parsed.participant_ids.length) {
        return res.status(400).json({ error: "One or more participants not found" });
      }

      const storeId = await resolveStoreId() || "default";

      if (parsed.thread_type === "direct" && allParticipantIds.length === 2) {
        const existingThreads = await db.execute(sql`
          SELECT t.id FROM message_threads t
          WHERE t.thread_type = 'direct'
            AND t.store_id = ${storeId}
            AND (SELECT COUNT(*) FROM thread_participants p WHERE p.thread_id = t.id) = 2
            AND EXISTS (SELECT 1 FROM thread_participants p WHERE p.thread_id = t.id AND p.user_id = ${allParticipantIds[0]})
            AND EXISTS (SELECT 1 FROM thread_participants p WHERE p.thread_id = t.id AND p.user_id = ${allParticipantIds[1]})
        `);

        if (existingThreads.rows.length > 0) {
          const existingId = existingThreads.rows[0].id as string;
          return res.json({ success: true, data: { id: existingId, reused: true } });
        }
      }

      const [thread] = await db.insert(messageThreads).values({
        storeId,
        threadType: parsed.thread_type,
        title: parsed.title || null,
        createdBy: user.id,
      }).returning();

      await db.insert(threadParticipants).values(
        allParticipantIds.map(pid => ({
          threadId: thread.id,
          userId: pid,
        }))
      );

      const otherIds = allParticipantIds.filter(id => id !== user.id);
      sendToUsers(otherIds, {
        type: "thread_created",
        data: { threadId: thread.id, createdBy: user.id },
      });

      res.json({ success: true, data: { id: thread.id, reused: false } });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/messages/threads/:id", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const threadId = req.params.id;

      const [participant] = await db
        .select()
        .from(threadParticipants)
        .where(and(
          eq(threadParticipants.threadId, threadId),
          eq(threadParticipants.userId, user.id),
        ));

      if (!participant) return res.status(403).json({ error: "Not a participant" });

      const [thread] = await db
        .select()
        .from(messageThreads)
        .where(eq(messageThreads.id, threadId));

      if (!thread) return res.status(404).json({ error: "Thread not found" });

      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const before = req.query.before as string | undefined;

      let messagesQuery = db
        .select()
        .from(threadMessages)
        .where(
          before
            ? and(
                eq(threadMessages.threadId, threadId),
                lt(threadMessages.createdAt, new Date(before)),
              )
            : eq(threadMessages.threadId, threadId),
        )
        .orderBy(desc(threadMessages.createdAt))
        .limit(limit);

      const messages = await messagesQuery;

      const participants = await db
        .select()
        .from(threadParticipants)
        .where(eq(threadParticipants.threadId, threadId));

      const pUserIds = [...new Set(participants.map(p => p.userId))];
      const senderIds = [...new Set(messages.map(m => m.senderId))];
      const allUserIds = [...new Set([...pUserIds, ...senderIds])];

      const userRows = allUserIds.length > 0
        ? await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
            .from(users)
            .where(inArray(users.id, allUserIds))
        : [];
      const userMap = new Map(userRows.map(u => [u.id, u]));

      let replyMessages: any[] = [];
      const replyIds = messages.filter(m => m.replyToId).map(m => m.replyToId!);
      if (replyIds.length > 0) {
        replyMessages = await db
          .select()
          .from(threadMessages)
          .where(inArray(threadMessages.id, replyIds));
      }
      const replyMap = new Map(replyMessages.map(m => [m.id, m]));

      await db
        .update(threadParticipants)
        .set({ lastReadAt: new Date() })
        .where(and(
          eq(threadParticipants.threadId, threadId),
          eq(threadParticipants.userId, user.id),
        ));

      const otherParticipantIds = participants
        .filter(p => p.userId !== user.id)
        .map(p => p.userId);

      sendToUsers(otherParticipantIds, {
        type: "thread_read",
        data: { threadId, userId: user.id },
      });

      const formattedMessages = messages.map(m => ({
        ...m,
        content: m.deletedAt ? "[Message deleted]" : m.content,
        senderName: userMap.get(m.senderId)?.firstName || "Unknown",
        senderLastName: userMap.get(m.senderId)?.lastName || "",
        replyTo: m.replyToId ? (() => {
          const r = replyMap.get(m.replyToId!);
          return r ? {
            id: r.id,
            content: r.deletedAt ? "[Message deleted]" : r.content,
            senderName: userMap.get(r.senderId)?.firstName || "Unknown",
          } : null;
        })() : null,
      }));

      res.json({
        success: true,
        data: {
          thread: {
            ...thread,
            participants: participants.map(p => ({
              userId: p.userId,
              firstName: userMap.get(p.userId)?.firstName || null,
              lastName: userMap.get(p.userId)?.lastName || null,
              lastReadAt: p.lastReadAt,
            })),
          },
          messages: formattedMessages.reverse(),
          hasMore: messages.length === limit,
        },
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/messages/threads/:id/messages", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const threadId = req.params.id;

      const [participant] = await db
        .select()
        .from(threadParticipants)
        .where(and(
          eq(threadParticipants.threadId, threadId),
          eq(threadParticipants.userId, user.id),
        ));

      if (!participant) return res.status(403).json({ error: "Not a participant" });

      const parsed = sendMessageSchema.parse(req.body);

      const [message] = await db.insert(threadMessages).values({
        threadId,
        senderId: user.id,
        content: parsed.content,
        messageType: parsed.message_type || "text",
        imageUrl: parsed.image_url || null,
        replyToId: parsed.reply_to_id || null,
      }).returning();

      await db
        .update(messageThreads)
        .set({ updatedAt: new Date() })
        .where(eq(messageThreads.id, threadId));

      await db
        .update(threadParticipants)
        .set({ lastReadAt: new Date() })
        .where(and(
          eq(threadParticipants.threadId, threadId),
          eq(threadParticipants.userId, user.id),
        ));

      const senderUser = await db.select({ firstName: users.firstName, lastName: users.lastName })
        .from(users).where(eq(users.id, user.id)).then(r => r[0]);

      const allParticipants = await db
        .select({ userId: threadParticipants.userId })
        .from(threadParticipants)
        .where(eq(threadParticipants.threadId, threadId));

      const otherIds = allParticipants
        .filter(p => p.userId !== user.id)
        .map(p => p.userId);

      let replyTo = null;
      if (parsed.reply_to_id) {
        const [orig] = await db.select().from(threadMessages)
          .where(eq(threadMessages.id, parsed.reply_to_id));
        if (orig) {
          const origSender = await db.select({ firstName: users.firstName })
            .from(users).where(eq(users.id, orig.senderId)).then(r => r[0]);
          replyTo = {
            id: orig.id,
            content: orig.deletedAt ? "[Message deleted]" : orig.content,
            senderName: origSender?.firstName || "Unknown",
          };
        }
      }

      const messagePayload = {
        ...message,
        senderName: senderUser?.firstName || "Unknown",
        senderLastName: senderUser?.lastName || "",
        replyTo,
        tempId: parsed.temp_id,
      };

      sendToUsers(otherIds, {
        type: "new_message",
        data: { threadId, message: messagePayload },
      });

      sendToUsers([user.id], {
        type: "message_confirmed",
        data: { threadId, message: messagePayload, tempId: parsed.temp_id },
      });

      res.json({ success: true, data: messagePayload });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/messages/:messageId", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const [message] = await db
        .select()
        .from(threadMessages)
        .where(eq(threadMessages.id, req.params.messageId));

      if (!message) return res.status(404).json({ error: "Message not found" });
      if (message.senderId !== user.id) return res.status(403).json({ error: "Not your message" });
      if (message.deletedAt) return res.status(400).json({ error: "Message is deleted" });

      const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (message.createdAt && message.createdAt < fifteenMinAgo) {
        return res.status(400).json({ error: "Can only edit within 15 minutes" });
      }

      const parsed = editMessageSchema.parse(req.body);

      const [updated] = await db
        .update(threadMessages)
        .set({ content: parsed.content, editedAt: new Date() })
        .where(eq(threadMessages.id, message.id))
        .returning();

      const allParticipants = await db
        .select({ userId: threadParticipants.userId })
        .from(threadParticipants)
        .where(eq(threadParticipants.threadId, message.threadId));

      const otherIds = allParticipants
        .filter(p => p.userId !== user.id)
        .map(p => p.userId);

      sendToUsers(otherIds, {
        type: "message_edited",
        data: { threadId: message.threadId, messageId: message.id, content: parsed.content, editedAt: updated.editedAt },
      });

      res.json({ success: true, data: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/messages/:messageId", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const [message] = await db
        .select()
        .from(threadMessages)
        .where(eq(threadMessages.id, req.params.messageId));

      if (!message) return res.status(404).json({ error: "Message not found" });

      const isAdmin = user.role?.name === "admin" || user.role?.name === "owner";
      if (message.senderId !== user.id && !isAdmin) {
        return res.status(403).json({ error: "Not authorized" });
      }

      await db
        .update(threadMessages)
        .set({ deletedAt: new Date() })
        .where(eq(threadMessages.id, message.id));

      const allParticipants = await db
        .select({ userId: threadParticipants.userId })
        .from(threadParticipants)
        .where(eq(threadParticipants.threadId, message.threadId));

      const otherIds = allParticipants
        .filter(p => p.userId !== user.id)
        .map(p => p.userId);

      sendToUsers(otherIds, {
        type: "message_deleted",
        data: { threadId: message.threadId, messageId: message.id },
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/messages/unread-count", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const result = await db.execute(sql`
        SELECT COALESCE(SUM(cnt), 0) as total FROM (
          SELECT COUNT(*) as cnt
          FROM thread_messages m
          JOIN thread_participants p ON p.thread_id = m.thread_id AND p.user_id = ${user.id}
          WHERE m.sender_id != ${user.id}
            AND (p.last_read_at IS NULL OR m.created_at > p.last_read_at)
        ) sub
      `);

      res.json({ success: true, data: { count: Number(result.rows[0]?.total || 0) } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/messages/typing", isAuthenticated, async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const { thread_id } = req.body;
      if (!thread_id) return res.status(400).json({ error: "thread_id required" });

      const allParticipants = await db
        .select({ userId: threadParticipants.userId })
        .from(threadParticipants)
        .where(eq(threadParticipants.threadId, thread_id));

      const otherIds = allParticipants
        .filter(p => p.userId !== user.id)
        .map(p => p.userId);

      sendToUsers(otherIds, {
        type: "typing",
        data: {
          threadId: thread_id,
          userId: user.id,
          userName: user.firstName || "Someone",
        },
      });

      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
