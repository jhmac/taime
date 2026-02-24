import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import logger from "../lib/logger";

const UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "videos");
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["video/mp4", "video/quicktime"]);

let useLocalStorage = true;

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

export function initVideoStorage() {
  const hasAws =
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_S3_BUCKET;

  if (hasAws) {
    useLocalStorage = false;
    logger.info("Video storage: using AWS S3");
  } else {
    useLocalStorage = true;
    ensureUploadDir();
    logger.warn(
      "AWS not configured — using local video storage (not for production)"
    );
  }
}

export function isLocalStorage(): boolean {
  return useLocalStorage;
}

export function validateContentType(contentType: string): boolean {
  return ALLOWED_TYPES.has(contentType);
}

export function validateFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE;
}

export function getUploadInfo(
  storeId: string,
  fileName: string,
  _contentType: string
): { uploadUrl: string; s3Key: string } {
  if (useLocalStorage) {
    const id = randomUUID();
    const ext = path.extname(fileName) || ".mp4";
    const safeFile = `${id}${ext}`;
    const s3Key = `stores/${storeId}/videos/${id}/${safeFile}`;

    return {
      uploadUrl: "/api/videos/upload",
      s3Key,
    };
  }

  const id = randomUUID();
  const s3Key = `stores/${storeId}/videos/${id}/${fileName}`;
  return {
    uploadUrl: `https://${process.env.AWS_S3_BUCKET}.s3.amazonaws.com/${s3Key}`,
    s3Key,
  };
}

export function saveLocalFile(
  fileBuffer: Buffer,
  s3Key: string
): { filePath: string; url: string } {
  ensureUploadDir();
  const safeName = s3Key.replace(/\//g, "_");
  const filePath = path.join(UPLOAD_DIR, safeName);
  fs.writeFileSync(filePath, fileBuffer);

  return {
    filePath: safeName,
    url: `/uploads/videos/${safeName}`,
  };
}

export function getVideoUrl(s3Key: string): string {
  if (useLocalStorage) {
    const safeName = s3Key.replace(/\//g, "_");
    return `/uploads/videos/${safeName}`;
  }

  if (process.env.AWS_CLOUDFRONT_DOMAIN) {
    return `https://${process.env.AWS_CLOUDFRONT_DOMAIN}/${s3Key}`;
  }
  return `https://${process.env.AWS_S3_BUCKET}.s3.amazonaws.com/${s3Key}`;
}

export function deleteVideoFile(s3Key: string): void {
  if (useLocalStorage) {
    const safeName = s3Key.replace(/\//g, "_");
    const filePath = path.join(UPLOAD_DIR, safeName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return;
  }

  logger.warn({ s3Key }, "S3 deletion not implemented — file remains in bucket");
}
