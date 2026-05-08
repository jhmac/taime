import { db } from "../db";
import { messageThreads, threadParticipants, threadMessages } from "@shared/schema";
import { sql } from "drizzle-orm";
import logger from "../lib/logger";

type WsSender = (userIds: string[], data: Record<string, unknown>) => void;

let _sendToUsers: WsSender | null = null;

export function initTimesheetMessaging(fn: WsSender): void {
  _sendToUsers = fn;
}

/**
 * Find or create a direct thread between senderUserId and recipientUserId,
 * then insert a system-type message and push a WebSocket event.
 * Silently skips when sender === recipient (admin self-reminder scenario).
 */
export async function sendTimesheetSystemMessage(opts: {
  senderUserId: string;
  recipientUserId: string;
  storeId: string;
  content: string;
}): Promise<void> {
  const { senderUserId, recipientUserId, storeId, content } = opts;

  if (!senderUserId || !recipientUserId || senderUserId === recipientUserId) {
    return;
  }

  try {
    const existing = await db.execute(sql`
      SELECT t.id FROM message_threads t
      WHERE t.thread_type = 'direct'
        AND t.store_id = ${storeId}
        AND (SELECT COUNT(*) FROM thread_participants p WHERE p.thread_id = t.id) = 2
        AND EXISTS (SELECT 1 FROM thread_participants p WHERE p.thread_id = t.id AND p.user_id = ${senderUserId})
        AND EXISTS (SELECT 1 FROM thread_participants p WHERE p.thread_id = t.id AND p.user_id = ${recipientUserId})
      LIMIT 1
    `);

    let threadId: string;

    if (existing.rows.length > 0) {
      threadId = existing.rows[0].id as string;
    } else {
      const [thread] = await db
        .insert(messageThreads)
        .values({ storeId, threadType: "direct", createdBy: senderUserId })
        .returning({ id: messageThreads.id });

      threadId = thread.id;

      await db.insert(threadParticipants).values([
        { threadId, userId: senderUserId },
        { threadId, userId: recipientUserId },
      ]);
    }

    const [msg] = await db
      .insert(threadMessages)
      .values({ threadId, senderId: senderUserId, content, messageType: "system" })
      .returning();

    await db.execute(
      sql`UPDATE message_threads SET updated_at = NOW() WHERE id = ${threadId}`,
    );

    if (_sendToUsers) {
      _sendToUsers([recipientUserId], {
        type: "new_message",
        data: {
          threadId,
          message: {
            id: msg.id,
            threadId,
            senderId: senderUserId,
            content,
            messageType: "system",
            createdAt: msg.createdAt,
          },
        },
      });
    }

    logger.info(
      { recipientUserId, threadId },
      "[TimesheetMessaging] In-app reminder delivered",
    );
  } catch (err: unknown) {
    const e = err as { message?: string };
    logger.warn(
      { error: e?.message, recipientUserId },
      "[TimesheetMessaging] In-app message failed (non-fatal)",
    );
  }
}
