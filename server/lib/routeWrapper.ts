import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import logger from "./logger";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public userMessage: string,
    public code: string,
    public details?: unknown
  ) {
    super(userMessage);
    this.name = "AppError";
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function formatErrorResponse(
  statusCode: number,
  message: string,
  code: string
) {
  return {
    success: false,
    error: { message, code },
  };
}

export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const statusCode = err.statusCode || err.status || 500;
  const isOperational = err instanceof AppError;

  logger.error({
    err: {
      message: err.message,
      stack: err.stack,
      code: err.code,
    },
    route: req.path,
    method: req.method,
    statusCode,
  }, `[${req.method}] ${req.path} failed`);

  if (res.headersSent) {
    return;
  }

  if (isOperational) {
    return res.status(statusCode).json(
      formatErrorResponse(statusCode, err.userMessage, err.code)
    );
  }

  if (err instanceof ZodError) {
    return res.status(400).json(
      formatErrorResponse(400, "Invalid request data", "VALIDATION_ERROR")
    );
  }

  const userMessage =
    statusCode === 400 ? "Invalid request data" :
    statusCode === 401 ? "Authentication required" :
    statusCode === 403 ? "You don't have permission to do that" :
    statusCode === 404 ? "Resource not found" :
    "An unexpected error occurred. Please try again.";

  const errorCode =
    statusCode === 400 ? "VALIDATION_ERROR" :
    statusCode === 401 ? "UNAUTHORIZED" :
    statusCode === 403 ? "FORBIDDEN" :
    statusCode === 404 ? "NOT_FOUND" :
    "INTERNAL_ERROR";

  return res.status(statusCode).json(
    formatErrorResponse(statusCode, userMessage, errorCode)
  );
}
