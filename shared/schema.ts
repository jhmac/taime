// This file is intentionally kept as a thin barrel so that:
//   1. drizzle.config.ts (which points to ./shared/schema.ts) continues to work.
//   2. All existing `import ... from "@shared/schema"` imports resolve here.
//
// All actual table/type definitions live in shared/schema/* domain files.
export * from "./schema/index";
