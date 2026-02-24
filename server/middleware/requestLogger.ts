import { type Request, type Response, type NextFunction } from "express";
import crypto from "crypto";
import logger from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

const REDACTED_FIELDS = new Set(["password", "token", "secret", "authorization", "accessToken", "access_token"]);

function redactBody(body: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      redacted[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactBody(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const requestId = crypto.randomUUID();
  req.requestId = requestId;

  const start = Date.now();
  const method = req.method;
  const path = req.path;

  const meta: Record<string, unknown> = { requestId, method, path };

  if (["POST", "PUT", "PATCH"].includes(method) && req.body && typeof req.body === "object") {
    meta.body = redactBody(req.body as Record<string, unknown>);
  }

  const SLOW_THRESHOLD_MS = 200;
  const AI_SLOW_THRESHOLD_MS = 5000;

  res.on("finish", () => {
    const responseTime = Date.now() - start;
    const statusCode = res.statusCode;

    const logData = {
      requestId,
      method,
      path,
      statusCode,
      responseTime,
    };

    const isAIEndpoint = path.startsWith("/api/ai-scheduling/generate") || path.startsWith("/api/ai/");
    const threshold = isAIEndpoint ? AI_SLOW_THRESHOLD_MS : SLOW_THRESHOLD_MS;

    if (statusCode >= 500) {
      logger.error(logData, `${method} ${path} ${statusCode} in ${responseTime}ms`);
    } else if (statusCode >= 400) {
      logger.warn(logData, `${method} ${path} ${statusCode} in ${responseTime}ms`);
    } else if (responseTime > threshold) {
      logger.warn({ ...logData, slow: true, threshold }, `SLOW ENDPOINT: ${method} ${path} ${statusCode} in ${responseTime}ms (threshold: ${threshold}ms)`);
    } else {
      logger.info(logData, `${method} ${path} ${statusCode} in ${responseTime}ms`);
    }
  });

  next();
}
