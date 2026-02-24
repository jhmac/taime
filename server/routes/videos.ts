import type { Express } from "express";
import type { IStorage } from "../storage";
import multer from "multer";
import { z } from "zod";
import { db } from "../db";
import {
  improvementVideos,
  videoLikes,
  videoComments,
  users,
  insertImprovementVideoSchema,
  insertVideoCommentSchema,
} from "@shared/schema";
import { eq, and, desc, sql, count } from "drizzle-orm";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import {
  initVideoStorage,
  isLocalStorage,
  validateContentType,
  validateFileSize,
  getUploadInfo,
  saveLocalFile,
  getVideoUrl,
  deleteVideoFile,
} from "../services/videoUpload";
import logger from "../lib/logger";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "video/mp4" || file.mimetype === "video/quicktime") {
      cb(null, true);
    } else {
      cb(new Error("Only MP4 and QuickTime video files are allowed"));
    }
  },
});

const uploadUrlSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.enum(["video/mp4", "video/quicktime"]),
  fileSize: z.number().int().positive().max(100 * 1024 * 1024),
});

const createVideoSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  category: z.enum([
    "process",
    "workspace",
    "customer_experience",
    "visual_merchandising",
    "inventory",
    "equipment",
    "other",
  ]),
  storageType: z.enum(["youtube", "s3", "local"]),
  s3Key: z.string().optional(),
  youtubeVideoId: z.string().optional(),
  durationSeconds: z.number().int().positive().optional(),
  thumbnailUrl: z.string().url().optional(),
});

const commentSchema = z.object({
  commentText: z.string().min(1).max(500),
});

export function registerVideoRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any,
  broadcastToAll: (data: any) => void
) {
  initVideoStorage();

  app.post(
    "/api/videos/upload-url",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const body = uploadUrlSchema.parse(req.body);

      if (!validateContentType(body.contentType)) {
        throw new AppError(400, "Invalid content type", "INVALID_CONTENT_TYPE");
      }
      if (!validateFileSize(body.fileSize)) {
        throw new AppError(400, "File too large (max 100MB)", "FILE_TOO_LARGE");
      }

      const storeId = await resolveStoreId(storage);
      const info = getUploadInfo(storeId, body.fileName, body.contentType);

      res.json(info);
    })
  );

  app.post(
    "/api/videos/upload",
    isAuthenticated,
    upload.single("video"),
    asyncHandler(async (req: any, res) => {
      if (!req.file) {
        throw new AppError(400, "No video file provided", "MISSING_FILE");
      }

      const s3Key =
        req.body.s3Key ||
        `stores/default/videos/${Date.now()}/${req.file.originalname}`;
      const result = saveLocalFile(req.file.buffer, s3Key);

      res.json({
        filePath: result.filePath,
        url: result.url,
        s3Key,
      });
    })
  );

  app.post(
    "/api/videos",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id;
      const body = createVideoSchema.parse(req.body);

      const storeId = await resolveStoreId(storage);

      const s3Url = body.s3Key ? getVideoUrl(body.s3Key) : null;

      const [video] = await db
        .insert(improvementVideos)
        .values({
          storeId,
          employeeId: userId,
          title: body.title,
          description: body.description || null,
          category: body.category,
          storageType: body.storageType,
          s3Key: body.s3Key || null,
          s3Url,
          youtubeVideoId: body.youtubeVideoId || null,
          thumbnailUrl: body.thumbnailUrl || null,
          durationSeconds: body.durationSeconds || null,
          status: "ready",
        })
        .returning();

      broadcastToAll({
        type: "new_improvement_video",
        data: { video },
      });

      try {
        await storage.createActivityLog({
          userId,
          action: "create",
          targetType: "improvement_video",
          details: `Created improvement video: ${body.title}`,
        });
      } catch {}

      logger.info(
        { videoId: video.id, userId, category: body.category },
        "Improvement video created"
      );

      res.json(video);
    })
  );

  app.get(
    "/api/videos",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id;
      const {
        category,
        employee_id,
        sort_by = "recent",
        limit: limitStr = "20",
        offset: offsetStr = "0",
      } = req.query;

      const limit = Math.min(Math.max(parseInt(limitStr as string) || 20, 1), 50);
      const offset = Math.max(parseInt(offsetStr as string) || 0, 0);

      const storeId = await resolveStoreId(storage);

      const conditions: any[] = [eq(improvementVideos.storeId, storeId), eq(improvementVideos.status, "ready")];
      if (category) conditions.push(eq(improvementVideos.category, category as string));
      if (employee_id)
        conditions.push(eq(improvementVideos.employeeId, employee_id as string));

      let orderBy;
      if (sort_by === "popular") {
        orderBy = desc(improvementVideos.viewCount);
      } else if (sort_by === "featured") {
        orderBy = desc(improvementVideos.isFeatured);
      } else {
        orderBy = desc(improvementVideos.createdAt);
      }

      const videos = await db
        .select()
        .from(improvementVideos)
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      const videoIds = videos.map((v) => v.id);
      if (videoIds.length === 0) {
        return res.json({ videos: [], total: 0 });
      }

      const likeCounts = await db
        .select({
          videoId: videoLikes.videoId,
          count: count(),
        })
        .from(videoLikes)
        .where(sql`${videoLikes.videoId} IN (${sql.join(videoIds.map((id) => sql`${id}`), sql`, `)})`)
        .groupBy(videoLikes.videoId);

      const commentCounts = await db
        .select({
          videoId: videoComments.videoId,
          count: count(),
        })
        .from(videoComments)
        .where(sql`${videoComments.videoId} IN (${sql.join(videoIds.map((id) => sql`${id}`), sql`, `)})`)
        .groupBy(videoComments.videoId);

      const userLikes = await db
        .select({ videoId: videoLikes.videoId })
        .from(videoLikes)
        .where(
          and(
            eq(videoLikes.employeeId, userId),
            sql`${videoLikes.videoId} IN (${sql.join(videoIds.map((id) => sql`${id}`), sql`, `)})`
          )
        );

      const authorIds = [...new Set(videos.map((v) => v.employeeId))];
      const authorRows = await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl })
        .from(users)
        .where(sql`${users.id} IN (${sql.join(authorIds.map((id) => sql`${id}`), sql`, `)})`);

      const likeMap = new Map(likeCounts.map((r) => [r.videoId, r.count]));
      const commentMap = new Map(commentCounts.map((r) => [r.videoId, r.count]));
      const userLikeSet = new Set(userLikes.map((r) => r.videoId));
      const authorMap = new Map(authorRows.map((u) => [u.id, u]));

      const enriched = videos.map((v) => ({
        ...v,
        likeCount: likeMap.get(v.id) || 0,
        commentCount: commentMap.get(v.id) || 0,
        hasLiked: userLikeSet.has(v.id),
        author: authorMap.get(v.employeeId) || null,
      }));

      const [totalResult] = await db
        .select({ count: count() })
        .from(improvementVideos)
        .where(and(...conditions));

      res.json({ videos: enriched, total: totalResult?.count || 0 });
    })
  );

  app.get(
    "/api/videos/:id",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id;
      const { id } = req.params;

      const [video] = await db
        .select()
        .from(improvementVideos)
        .where(eq(improvementVideos.id, id));

      if (!video) {
        throw new AppError(404, "Video not found", "VIDEO_NOT_FOUND");
      }

      db.update(improvementVideos)
        .set({ viewCount: sql`${improvementVideos.viewCount} + 1` })
        .where(eq(improvementVideos.id, id))
        .execute()
        .catch(() => {});

      const comments = await db
        .select()
        .from(videoComments)
        .where(eq(videoComments.videoId, id))
        .orderBy(desc(videoComments.createdAt))
        .limit(200);

      const commentAuthorIds = [...new Set(comments.map((c) => c.employeeId))];
      commentAuthorIds.push(video.employeeId);
      const uniqueAuthorIds = [...new Set(commentAuthorIds)];

      let authorMap = new Map<string, any>();
      if (uniqueAuthorIds.length > 0) {
        const authorRows = await db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, profileImageUrl: users.profileImageUrl })
          .from(users)
          .where(sql`${users.id} IN (${sql.join(uniqueAuthorIds.map((id) => sql`${id}`), sql`, `)})`);
        authorMap = new Map(authorRows.map((u) => [u.id, u]));
      }

      const [likeResult] = await db
        .select({ count: count() })
        .from(videoLikes)
        .where(eq(videoLikes.videoId, id));

      const [userLike] = await db
        .select({ id: videoLikes.id })
        .from(videoLikes)
        .where(
          and(eq(videoLikes.videoId, id), eq(videoLikes.employeeId, userId))
        )
        .limit(1);

      const enrichedComments = comments.map((c) => ({
        ...c,
        author: authorMap.get(c.employeeId) || null,
      }));

      res.json({
        ...video,
        author: authorMap.get(video.employeeId) || null,
        likeCount: likeResult?.count || 0,
        hasLiked: !!userLike,
        comments: enrichedComments,
      });
    })
  );

  app.post(
    "/api/videos/:id/like",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id;
      const { id } = req.params;

      const [existing] = await db
        .select({ id: videoLikes.id })
        .from(videoLikes)
        .where(
          and(eq(videoLikes.videoId, id), eq(videoLikes.employeeId, userId))
        )
        .limit(1);

      if (existing) {
        await db
          .delete(videoLikes)
          .where(eq(videoLikes.id, existing.id));
      } else {
        await db.insert(videoLikes).values({
          videoId: id,
          employeeId: userId,
        });
      }

      const [likeResult] = await db
        .select({ count: count() })
        .from(videoLikes)
        .where(eq(videoLikes.videoId, id));

      res.json({
        liked: !existing,
        likeCount: likeResult?.count || 0,
      });
    })
  );

  app.delete(
    "/api/videos/:id/like",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id;
      const { id } = req.params;

      await db
        .delete(videoLikes)
        .where(
          and(eq(videoLikes.videoId, id), eq(videoLikes.employeeId, userId))
        );

      const [likeResult] = await db
        .select({ count: count() })
        .from(videoLikes)
        .where(eq(videoLikes.videoId, id));

      res.json({
        liked: false,
        likeCount: likeResult?.count || 0,
      });
    })
  );

  app.post(
    "/api/videos/:id/comments",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id;
      const { id } = req.params;

      const body = commentSchema.parse(req.body);

      const [video] = await db
        .select({ id: improvementVideos.id, employeeId: improvementVideos.employeeId, title: improvementVideos.title })
        .from(improvementVideos)
        .where(eq(improvementVideos.id, id))
        .limit(1);

      if (!video) {
        throw new AppError(404, "Video not found", "VIDEO_NOT_FOUND");
      }

      const [comment] = await db
        .insert(videoComments)
        .values({
          videoId: id,
          employeeId: userId,
          commentText: body.commentText,
        })
        .returning();

      if (video.employeeId !== userId) {
        broadcastToAll({
          type: "video_comment",
          data: {
            videoId: id,
            videoTitle: video.title,
            commenterId: userId,
            targetUserId: video.employeeId,
          },
        });
      }

      res.json(comment);
    })
  );

  app.delete(
    "/api/videos/:id",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      const userId = req.user.id;
      const { id } = req.params;

      const [video] = await db
        .select()
        .from(improvementVideos)
        .where(eq(improvementVideos.id, id));

      if (!video) {
        throw new AppError(404, "Video not found", "VIDEO_NOT_FOUND");
      }

      const isAuthor = video.employeeId === userId;
      let isManager = false;
      if (!isAuthor) {
        const userPerms = await storage.getUserPermissions(userId);
        isManager = userPerms.some(
          (p) =>
            p.name === "admin.manage_all" ||
            p.name === "admin.manage_employees"
        );
      }

      if (!isAuthor && !isManager) {
        throw new AppError(403, "Not authorized to delete this video", "FORBIDDEN");
      }

      if (video.s3Key) {
        deleteVideoFile(video.s3Key);
      }

      await db.delete(improvementVideos).where(eq(improvementVideos.id, id));

      logger.info({ videoId: id, deletedBy: userId }, "Improvement video deleted");

      res.json({ success: true });
    })
  );
}

async function resolveStoreId(storage: IStorage): Promise<string> {
  const locations = await storage.getAllWorkLocations();
  if (locations.length > 0) return locations[0].id;
  return "default";
}
