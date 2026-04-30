import type { Express } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { asyncHandler, AppError } from "../lib/routeWrapper";
import { resolveStoreIdForUser } from "../services/storeResolver";
import type { IStorage } from "../storage";
import { processKnowledgeDocument } from "../services/knowledgeExtractor";
import { resolveAnyPermission } from "../services/permissionResolver";
import logger from "../lib/logger";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "knowledge");
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "image/jpeg",
  "image/png",
];
const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".jpg", ".jpeg", ".png"];

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (SUPPORTED_MIME_TYPES.includes(file.mimetype) || SUPPORTED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Unsupported file type. Please upload PDF, DOCX, TXT, JPG, or PNG files."));
    }
  },
});

type ImageMediaType = "image/jpeg" | "image/png";

interface ExtractedFile {
  rawText: string;
  imageBase64?: string;
  imageMimeType?: ImageMediaType;
}

async function extractFromFile(filePath: string, mimeType: string, originalName: string): Promise<ExtractedFile> {
  const ext = path.extname(originalName).toLowerCase();

  if (mimeType === "text/plain" || ext === ".txt") {
    return { rawText: fs.readFileSync(filePath, "utf-8") };
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ path: filePath });
    return { rawText: result.value };
  }

  if (mimeType === "application/pdf" || ext === ".pdf") {
    // pdf-parse v1 exports a single callable function
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require("pdf-parse") as (buffer: Buffer) => Promise<{ text: string }>;
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return { rawText: data.text };
  }

  if ([".jpg", ".jpeg", ".png"].includes(ext) || mimeType.startsWith("image/")) {
    const buffer = fs.readFileSync(filePath);
    const imageMimeType: ImageMediaType = ext === ".png" ? "image/png" : "image/jpeg";
    return { rawText: "", imageBase64: buffer.toString("base64"), imageMimeType };
  }

  throw new AppError(400, "Cannot extract text from this file type", "UNSUPPORTED_FILE");
}

async function requireManagerOrOwner(storage: IStorage, userId: string): Promise<void> {
  const hasAccess = await resolveAnyPermission(userId, ["admin.manage_all", "admin.role_management", "hr.edit_team"], storage);
  if (!hasAccess) {
    throw new AppError(403, "Manager or Owner access required", "FORBIDDEN");
  }
}

const updateTagsSchema = z.object({
  autoTags: z.array(z.string()).max(20),
});

export function registerKnowledgeRoutes(
  app: Express,
  storage: IStorage,
  isAuthenticated: any
) {
  app.post(
    "/api/knowledge/upload",
    isAuthenticated,
    upload.single("file"),
    asyncHandler(async (req: any, res) => {
      await requireManagerOrOwner(storage, req.user.id);

      if (!req.file) {
        throw new AppError(400, "No file uploaded", "NO_FILE");
      }

      const storeId = await resolveStoreIdForUser(req.user.id);
      const file = req.file;
      let extracted: ExtractedFile;
      try {
        extracted = await extractFromFile(file.path, file.mimetype, file.originalname);
      } catch (extractErr: unknown) {
        fs.unlink(file.path, () => {});
        if (extractErr instanceof AppError) throw extractErr;
        throw new AppError(422, "Failed to extract content from file", "EXTRACTION_FAILED");
      } finally {
        fs.unlink(file.path, () => {});
      }

      const doc = await storage.createKnowledgeDocument({
        storeId,
        uploadedByUserId: req.user.id,
        originalFileName: file.originalname,
        fileType: path.extname(file.originalname).toLowerCase().replace(".", "") || file.mimetype,
        rawContent: extracted.rawText || "[image]",
        processingStatus: "pending",
      });

      processKnowledgeDocument(doc.id, extracted.rawText, file.originalname, {
        imageBase64: extracted.imageBase64,
        imageMimeType: extracted.imageMimeType,
      }).catch((err: Error) => {
        logger.error({ docId: doc.id, error: err.message }, "knowledge: async pipeline failed");
      });

      res.status(201).json({ success: true, data: doc });
    })
  );

  app.get(
    "/api/knowledge/documents",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManagerOrOwner(storage, req.user.id);
      const storeId = await resolveStoreIdForUser(req.user.id);
      const docs = await storage.getKnowledgeDocuments(storeId);
      res.json({ success: true, data: docs });
    })
  );

  app.patch(
    "/api/knowledge/documents/:id/tags",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManagerOrOwner(storage, req.user.id);

      const { id } = req.params;
      const body = updateTagsSchema.parse(req.body);

      const existing = await storage.getKnowledgeDocument(id);
      if (!existing) throw new AppError(404, "Document not found", "NOT_FOUND");

      const storeId = await resolveStoreIdForUser(req.user.id);
      if (existing.storeId !== storeId) {
        throw new AppError(404, "Document not found", "NOT_FOUND");
      }

      const updated = await storage.updateKnowledgeDocument(id, { autoTags: body.autoTags });
      res.json({ success: true, data: updated });
    })
  );

  app.delete(
    "/api/knowledge/documents/:id",
    isAuthenticated,
    asyncHandler(async (req: any, res) => {
      await requireManagerOrOwner(storage, req.user.id);

      const { id } = req.params;
      const existing = await storage.getKnowledgeDocument(id);
      if (!existing) throw new AppError(404, "Document not found", "NOT_FOUND");

      const storeId = await resolveStoreIdForUser(req.user.id);
      if (existing.storeId !== storeId) {
        throw new AppError(404, "Document not found", "NOT_FOUND");
      }

      await storage.deleteKnowledgeDocument(id);
      res.json({ success: true });
    })
  );
}
