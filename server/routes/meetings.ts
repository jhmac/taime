import type { Express } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { db } from "../db";
import { eq, ne, and } from "drizzle-orm";
import { gtdInboxItems, meetingTaskRecommendations, users } from "@shared/schema";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { resolveStoreId } from "../services/storeResolver";
import type { IStorage } from "../storage";
import type { Meeting, MeetingTaskRecommendation } from "@shared/schema";
import { transcribeAudioFile } from "../services/meetingTranscriptionService";
import { generateSynopsis, generateTaskRecommendations } from "../services/meetingAI";
import logger from "../lib/logger";
import { resolveAnyPermission } from "../services/permissionResolver";

const AUDIO_UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "meetings");

if (!fs.existsSync(AUDIO_UPLOAD_DIR)) {
  fs.mkdirSync(AUDIO_UPLOAD_DIR, { recursive: true });
}

const upload = multer({
  dest: AUDIO_UPLOAD_DIR,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "audio/mpeg", "audio/mp3", "audio/wav", "audio/webm",
      "audio/ogg", "audio/mp4", "audio/m4a", "video/mp4",
    ];
    if (allowed.includes(file.mimetype) || /\.(mp3|wav|webm|ogg|m4a|mp4)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported audio format"));
    }
  },
});

const createMeetingSchema = z.object({
  title: z.string().min(1).max(500),
  date: z.string(),
  participantIds: z.array(z.string()).optional().default([]),
});

const updateMeetingSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  date: z.string().optional(),
  participantIds: z.array(z.string()).optional(),
  status: z.enum(["recording", "processing", "ready", "failed"]).optional(),
});

const updateRecommendationSchema = z.object({
  status: z.enum(["pending", "rejected"]).optional(),
  assigneeId: z.string().nullable().optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
});

const acceptRecommendationSchema = z.object({
  assigneeId: z.string().nullable().optional(),
});

async function getStoreId(): Promise<string> {
  const id = await resolveStoreId();
  if (!id) throw new AppError(400, "No store configured", "NO_STORE");
  return id;
}

async function isManagerOrOwner(storage: IStorage, userId: string): Promise<boolean> {
  return resolveAnyPermission(userId, ["admin.manage_all", "admin.role_management", "admin.manage_payroll"], storage);
}

function assertMeetingBelongsToStore(meeting: Meeting, storeId: string): void {
  if (meeting.storeId !== storeId) {
    throw new AppError(404, "Meeting not found", "NOT_FOUND");
  }
}

export function registerMeetingRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  broadcastToAll: (data: any) => void,
  sendToUsers?: (userIds: string[], data: any) => void
) {
  // Emit meeting events to authorized users only (creator + participants + all managers).
  // Falls back to broadcastToAll when sendToUsers is not provided.
  async function broadcastToMeeting(
    meeting: { createdBy: string; participantIds: unknown },
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!sendToUsers) {
      broadcastToAll(payload);
      return;
    }
    const participantIds = (meeting.participantIds ?? []) as string[];
    const recipientIds = Array.from(new Set([meeting.createdBy, ...participantIds]));
    sendToUsers(recipientIds, payload);
  }

  app.post("/api/meetings", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;
    const storeId = await getStoreId();
    const body = createMeetingSchema.parse(req.body);

    const meeting = await storage.createMeeting({
      storeId,
      createdBy: userId,
      title: body.title,
      date: new Date(body.date),
      participantIds: body.participantIds,
      status: "recording",
    });

    await broadcastToMeeting(meeting, { type: "meeting_created", data: { meetingId: meeting.id, title: meeting.title, storeId: meeting.storeId } });
    res.status(201).json({ success: true, data: meeting });
  }));

  app.get("/api/meetings", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;
    const storeId = await getStoreId();
    const isManager = await isManagerOrOwner(storage, userId);

    let meetingList = await storage.getMeetingsByStore(storeId);

    if (!isManager) {
      meetingList = meetingList.filter(
        m => m.createdBy === userId || (m.participantIds as string[]).includes(userId)
      );
    }

    res.json({ success: true, data: meetingList });
  }));

  app.get("/api/meetings/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;
    const { id } = req.params as { id: string };
    const storeId = await getStoreId();

    const meeting = await storage.getMeeting(id);
    if (!meeting) throw new AppError(404, "Meeting not found", "NOT_FOUND");
    assertMeetingBelongsToStore(meeting, storeId);

    const isManager = await isManagerOrOwner(storage, userId);
    const isParticipant = (meeting.participantIds as string[]).includes(userId);
    if (!isManager && meeting.createdBy !== userId && !isParticipant) {
      throw new AppError(403, "Not authorized to view this meeting", "FORBIDDEN");
    }

    const recommendations = await storage.getMeetingTaskRecommendations(id);

    // Enrich recommendations with assignee names for the frontend
    const allUsers = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users);
    const userMap = Object.fromEntries(allUsers.map(u => [u.id, u]));

    const enrichedRecs = recommendations.map(r => ({
      ...r,
      assigneeName: r.assigneeId && userMap[r.assigneeId]
        ? `${userMap[r.assigneeId].firstName || ""} ${userMap[r.assigneeId].lastName || ""}`.trim()
        : null,
    }));

    res.json({
      success: true,
      data: {
        ...meeting,
        recommendations: enrichedRecs,
        teamMembers: allUsers.map(u => ({
          id: u.id,
          name: `${u.firstName || ""} ${u.lastName || ""}`.trim(),
        })),
      },
    });
  }));

  app.patch("/api/meetings/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;
    const { id } = req.params as { id: string };
    const storeId = await getStoreId();

    const meeting = await storage.getMeeting(id);
    if (!meeting) throw new AppError(404, "Meeting not found", "NOT_FOUND");
    assertMeetingBelongsToStore(meeting, storeId);

    const isManager = await isManagerOrOwner(storage, userId);
    if (!isManager && meeting.createdBy !== userId) {
      throw new AppError(403, "Not authorized to update this meeting", "FORBIDDEN");
    }

    const body = updateMeetingSchema.parse(req.body);
    const updates: Partial<Meeting> = {};
    if (body.title !== undefined) updates.title = body.title;
    if (body.date !== undefined) updates.date = new Date(body.date);
    if (body.participantIds !== undefined) updates.participantIds = body.participantIds;
    if (body.status !== undefined) updates.status = body.status;

    const updated = await storage.updateMeeting(id, updates);
    res.json({ success: true, data: updated });
  }));

  app.post(
    "/api/meetings/:id/audio",
    isAuthenticated,
    upload.single("audio"),
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id as string;
      const { id } = req.params as { id: string };
      const storeId = await getStoreId();

      const meeting = await storage.getMeeting(id);
      if (!meeting) throw new AppError(404, "Meeting not found", "NOT_FOUND");
      assertMeetingBelongsToStore(meeting, storeId);

      const isManager = await isManagerOrOwner(storage, userId);
      if (!isManager && meeting.createdBy !== userId) {
        throw new AppError(403, "Not authorized to upload audio for this meeting", "FORBIDDEN");
      }

      if (!req.file) throw new AppError(400, "No audio file provided", "NO_FILE");

      const audioPath = req.file.path as string;
      const audioUrl = `/uploads/meetings/${path.basename(audioPath)}`;

      // Update duration if provided
      const durationSeconds = req.body.durationSeconds ? parseInt(req.body.durationSeconds, 10) : undefined;
      await storage.updateMeeting(id, { audioUrl, status: "processing", ...(durationSeconds ? { durationSeconds } : {}) });
      await broadcastToMeeting(meeting, { type: "meeting_processing_started", data: { meetingId: id } });

      res.json({ success: true, data: { meetingId: id, status: "processing" } });

      setImmediate(async () => {
        try {
          // Clear pending/rejected recommendations from any previous upload before inserting new AI output
          const existingRecs = await storage.getMeetingTaskRecommendations(id);
          for (const existingRec of existingRecs) {
            if (existingRec.status !== "accepted") {
              await storage.deleteMeetingTaskRecommendation(existingRec.id);
            }
          }

          const transcript = await transcribeAudioFile(audioPath);
          await storage.updateMeeting(id, { transcript });
          await broadcastToMeeting(meeting, { type: "meeting_transcribed", data: { meetingId: id } });

          const synopsis = await generateSynopsis(transcript);
          await storage.updateMeeting(id, { synopsis });
          await broadcastToMeeting(meeting, { type: "meeting_synopsis_ready", data: { meetingId: id } });

          // Defensively normalize participantIds to avoid null runtime errors
          const participantIds = (meeting.participantIds ?? []) as string[];
          const participantUsers: Array<{ id: string; name: string }> = [];
          for (const pid of participantIds) {
            const u = await storage.getUser(pid);
            if (u) {
              participantUsers.push({
                id: u.id,
                name: `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
              });
            }
          }

          const recommendations = await generateTaskRecommendations(synopsis, participantUsers);

          for (const rec of recommendations) {
            let assigneeId: string | null = null;
            if (rec.suggestedAssigneeHint) {
              const hintLower = rec.suggestedAssigneeHint.toLowerCase();
              const matched = participantUsers.find(p => p.name.toLowerCase().includes(hintLower));
              if (matched) assigneeId = matched.id;
            }

            await storage.createMeetingTaskRecommendation({
              meetingId: id,
              description: rec.description,
              context: rec.context,
              priority: rec.priority,
              assigneeId,
              status: "pending",
            });
          }

          await storage.updateMeeting(id, { status: "ready" });
          await broadcastToMeeting(meeting, { type: "meeting_ready", data: { meetingId: id } });
          logger.info({ meetingId: id, recommendationCount: recommendations.length }, "Meeting pipeline complete");
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          logger.error({ meetingId: id, error: message }, "Meeting pipeline failed");
          await storage.updateMeeting(id, { status: "failed" }).catch(() => {});
          await broadcastToMeeting(meeting, { type: "meeting_failed", data: { meetingId: id, error: message } });
        } finally {
          // Always clean up the temp audio file to prevent disk bloat
          fs.unlink(audioPath, (unlinkErr) => {
            if (unlinkErr) logger.warn({ meetingId: id, audioPath }, "Failed to delete audio temp file");
          });
        }
      });
    })
  );

  app.patch(
    "/api/meetings/:id/recommendations/:recId",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id as string;
      const { id, recId } = req.params as { id: string; recId: string };
      const storeId = await getStoreId();

      const meeting = await storage.getMeeting(id);
      if (!meeting) throw new AppError(404, "Meeting not found", "NOT_FOUND");
      assertMeetingBelongsToStore(meeting, storeId);

      const rec = await storage.getMeetingTaskRecommendation(recId);
      if (!rec || rec.meetingId !== id) throw new AppError(404, "Recommendation not found", "NOT_FOUND");

      if (rec.status === "accepted") {
        throw new AppError(409, "Cannot modify an accepted recommendation", "RECOMMENDATION_ACCEPTED");
      }

      const isManager = await isManagerOrOwner(storage, userId);
      if (!isManager && meeting.createdBy !== userId) {
        throw new AppError(403, "Not authorized", "FORBIDDEN");
      }

      const body = updateRecommendationSchema.parse(req.body);

      if (body.assigneeId) {
        const assigneeUser = await storage.getUser(body.assigneeId);
        if (!assigneeUser || !assigneeUser.isActive) {
          throw new AppError(400, "Assignee user not found or inactive", "INVALID_ASSIGNEE");
        }
        const participantIds = meeting.participantIds as string[];
        const isKnownToMeeting =
          body.assigneeId === meeting.createdBy ||
          participantIds.includes(body.assigneeId);

        if (!isKnownToMeeting) {
          const assigneeIsManager = await isManagerOrOwner(storage, body.assigneeId);
          if (!assigneeIsManager) {
            throw new AppError(400, "Assignee must be a meeting participant, creator, or store manager", "INVALID_ASSIGNEE");
          }
        }
      }

      const updates: Partial<MeetingTaskRecommendation> = {};
      if (body.status !== undefined) updates.status = body.status;
      if (body.assigneeId !== undefined) updates.assigneeId = body.assigneeId;
      if (body.priority !== undefined) updates.priority = body.priority;

      const updated = await storage.updateMeetingTaskRecommendation(recId, updates);
      res.json({ success: true, data: updated });
    })
  );

  app.post(
    "/api/meetings/:id/recommendations/:recId/accept",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id as string;
      const { id, recId } = req.params as { id: string; recId: string };
      const storeId = await getStoreId();

      const meeting = await storage.getMeeting(id);
      if (!meeting) throw new AppError(404, "Meeting not found", "NOT_FOUND");
      assertMeetingBelongsToStore(meeting, storeId);

      const rec = await storage.getMeetingTaskRecommendation(recId);
      if (!rec || rec.meetingId !== id) throw new AppError(404, "Recommendation not found", "NOT_FOUND");

      const isManager = await isManagerOrOwner(storage, userId);
      if (!isManager && meeting.createdBy !== userId) {
        throw new AppError(403, "Not authorized", "FORBIDDEN");
      }

      if (rec.status === "accepted") {
        return res.json({ success: true, data: rec, message: "Already accepted" });
      }

      // Allow overriding assignee via request body
      const body = acceptRecommendationSchema.parse(req.body);
      const assigneeOverride = body.assigneeId || null;

      // GTD inbox item is owned by the recommendation assignee when present, else the meeting creator
      const inboxOwner = assigneeOverride ?? rec.assigneeId ?? meeting.createdBy;
      const rawInput = rec.context
        ? `${rec.description}\n\nContext: ${rec.context}`
        : rec.description;

      // Atomically create inbox item and mark recommendation accepted.
      const { inboxItem, updated } = await db.transaction(async (tx) => {
        const [item] = await tx.insert(gtdInboxItems).values({
          storeId,
          capturedBy: inboxOwner,
          rawInput,
          source: "meeting_recommendation",
          status: "unprocessed",
        }).returning();

        const [rec_updated] = await tx
          .update(meetingTaskRecommendations)
          .set({
            status: "accepted",
            gtdInboxItemId: item.id,
            assigneeId: assigneeOverride ?? rec.assigneeId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(meetingTaskRecommendations.id, recId),
              ne(meetingTaskRecommendations.status, "accepted")
            )
          )
          .returning();

        if (!rec_updated) {
          throw new AppError(409, "Recommendation was already accepted", "RECOMMENDATION_ACCEPTED");
        }

        return { inboxItem: item, updated: rec_updated };
      });

      await broadcastToMeeting(meeting, {
        type: "meeting_recommendation_accepted",
        data: { meetingId: id, recId, inboxItemId: inboxItem.id, assigneeId: inboxOwner },
      });

      // Return with enriched assignee name for the frontend
      const assigneeUser = inboxOwner ? await storage.getUserWithRole(inboxOwner) : null;
      const assigneeName = assigneeUser
        ? `${assigneeUser.firstName || ""} ${assigneeUser.lastName || ""}`.trim()
        : null;

      res.json({ success: true, data: { ...updated, assigneeName }, inboxItemId: inboxItem.id });
    })
  );

  app.post(
    "/api/meetings/:id/recommendations/:recId/reject",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id as string;
      const { id, recId } = req.params as { id: string; recId: string };
      const storeId = await getStoreId();

      const meeting = await storage.getMeeting(id);
      if (!meeting) throw new AppError(404, "Meeting not found", "NOT_FOUND");
      assertMeetingBelongsToStore(meeting, storeId);

      const rec = await storage.getMeetingTaskRecommendation(recId);
      if (!rec || rec.meetingId !== id) throw new AppError(404, "Recommendation not found", "NOT_FOUND");

      const isManager = await isManagerOrOwner(storage, userId);
      if (!isManager && meeting.createdBy !== userId) {
        throw new AppError(403, "Not authorized", "FORBIDDEN");
      }

      const updated = await storage.updateMeetingTaskRecommendation(recId, { status: "rejected" });
      res.json({ success: true, data: updated });
    })
  );

  app.delete("/api/meetings/:id", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;
    const { id } = req.params as { id: string };
    const storeId = await getStoreId();

    const meeting = await storage.getMeeting(id);
    if (!meeting) throw new AppError(404, "Meeting not found", "NOT_FOUND");
    assertMeetingBelongsToStore(meeting, storeId);

    const isManager = await isManagerOrOwner(storage, userId);
    if (!isManager && meeting.createdBy !== userId) {
      throw new AppError(403, "Not authorized to delete this meeting", "FORBIDDEN");
    }

    await storage.deleteMeeting(id);
    res.json({ success: true });
  }));

  // Team members endpoint for participant/assignee pickers
  app.get("/api/team/members", isAuthenticated, asyncHandler(async (req: any, res) => {
    const userId = req.user.id as string;
    const isAdmin = await isManagerOrOwner(storage, userId);
    if (!isAdmin) throw new AppError(403, "Only managers and owners can list team members", "FORBIDDEN");

    const allUsers = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
    }).from(users);

    res.json({
      success: true,
      data: allUsers.map(u => ({
        id: u.id,
        name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || "Unknown",
      })),
    });
  }));
}
