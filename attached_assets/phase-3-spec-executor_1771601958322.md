# Sneebly Transform — Phase 3 of 5: Spec Executor & Dispatcher Updates

**What this does:** Teaches the Spec Executor subagent about the `create` action so it can generate full file contents (not just edits). Updates the response parser to recognize the new action types.

**Prerequisite:** Phase 2 (file creation) must be complete.

**Verify before starting:** Open `src/subagents/spec-executor.js` and `src/subagents/dispatcher.js` and read them fully.

---

## PROMPT

I need you to update two files so the Spec Executor knows how to create new files and the Dispatcher can parse the new response formats. Read both files fully before making any changes.

### Part A: Update the Spec Executor

**File: `src/subagents/spec-executor.js`**

Find where the spec executor builds its prompt for Claude. There should be a section that tells Claude what output formats are available. It currently describes formats like:
- `SPEC_COMPLETE` (signal that work is done)
- `{ status: 'change', filePath, oldCode, newCode }` (single file edit)
- `{ status: 'multi-change', changes: [...] }` (multi-file edit)
- `{ status: 'stuck', reason }` (can't proceed)

Add the following new output formats to that prompt section. Place them AFTER the existing formats:

```
FILE CREATION (for build mode — when the spec action is "create"):

When the spec has "action": "create", you are creating a BRAND NEW file that does not exist yet. Return:

{
  "status": "create",
  "filePath": "exact/path/to/new/file.ts",
  "content": "THE COMPLETE FILE CONTENT — every line, every import, every function. No placeholders."
}

For creating multiple new files at once:

{
  "status": "multi-create",
  "files": [
    { "filePath": "path/to/file1.ts", "content": "complete content of file 1" },
    { "filePath": "path/to/file2.ts", "content": "complete content of file 2" }
  ]
}

CRITICAL RULES FOR FILE CREATION:
1. Generate COMPLETE, RUNNABLE file content. Every single line.
2. No "// ... rest of code here" — write ALL the code.
3. No "// TODO: implement this" — implement it NOW.
4. No placeholder functions that return dummy data — write real logic.
5. Match the EXACT import style of existing files in the project.
   If existing files use: import { x } from '@/lib/y' — you use that too.
   If existing files use: const x = require('./y') — you use that too.
6. Match the EXACT code style: semicolons or no semicolons, single or double quotes,
   tabs or spaces, trailing commas or not. Look at the related files for reference.
7. Include ALL necessary imports at the top of the file.
8. Include proper error handling (try/catch on all async operations).
9. Include TypeScript types if the project uses TypeScript.
10. If creating a route file, follow the EXACT pattern of existing route files
    in the project (same middleware, same response format, same error handling).
11. If creating a service file, follow the EXACT pattern of existing services.
12. If creating a schema/model file, use the SAME ORM and patterns as existing schemas.
```

Also find where the spec executor reads the spec's `action` field to determine context. If there's logic that says something like "read the target file" for context, add a condition:

```
If the spec action is "create":
- Do NOT try to read the target file (it doesn't exist yet)
- DO read the relatedFiles listed in the spec for style/pattern reference
- DO read the buildNotes from the spec for additional context
- Focus on generating complete file content that integrates with existing code
```

If the spec executor currently REQUIRES a target file to exist (e.g., it reads the file to find relevant sections), add a guard that skips file reading when `spec.action === 'create'`. Something like:

```javascript
// Before file reading logic, add:
if (spec.action === 'create') {
  // Skip reading target file — it doesn't exist yet
  // Use relatedFiles for context instead
  fileContext = 'NEW FILE — does not exist yet. Create from scratch.';
} else {
  // ... existing file reading logic ...
}
```

### Part B: Update the Response Parser

**File: `src/subagents/dispatcher.js`**

Find the `parseSubagentResponse` function. This is the multi-strategy parser that handles Claude's varied output formats. It needs to recognize the new status types.

1. Find where it checks for known `status` values. Add `'create'` and `'multi-create'` to the recognized values. If there's a validation step that rejects unknown statuses, make sure these pass.

2. Find where it validates actionable responses through `OutputValidator`. For `create` actions:
   - The `filePath` still needs to pass output validation (no identity files, no .env, etc.)
   - The `content` field doesn't need old/new code validation — it's a full file
   - Make sure the validator doesn't reject creates just because there's no `oldCode`

3. If there's a response validation step that checks for required fields, add the create schemas:
   - `create` requires: `status`, `filePath`, `content`
   - `multi-create` requires: `status`, `files` (array of `{ filePath, content }`)

### Part C: Update the Spec Format

Check if there's a spec schema or validation anywhere (maybe in the orchestrator or the ralph loop) that validates spec JSON files before execution. If so, add `action: 'create'` as a valid action type alongside whatever existing values are accepted.

The spec format for build mode looks like:

```json
{
  "id": "build-1708000000-step1",
  "source": "elon-build",
  "action": "create",
  "filePath": "server/routes/users.ts",
  "description": "Create the users CRUD API following existing route patterns",
  "successCriteria": [
    "File exists at server/routes/users.ts",
    "GET /api/users returns 200 with JSON array"
  ],
  "relatedFiles": ["server/routes/index.ts", "shared/schema.ts"],
  "testCommand": "curl -s http://localhost:5000/api/users",
  "constraint": "Users API doesn't exist",
  "phase": "Phase 1",
  "milestone": "Build CRUD API endpoints for users",
  "buildNotes": "Follow the pattern in server/routes/index.ts. Use Drizzle for queries."
}
```

Make sure the existing spec reading/writing code doesn't reject this format.

### Verification

After making these changes:

1. Create a test spec file manually in `.sneebly/approved-queue/`:

```json
{
  "id": "test-create-001",
  "source": "manual-test",
  "action": "create",
  "filePath": "test-sneebly-build.js",
  "description": "Test file to verify create action works",
  "successCriteria": ["File exists at test-sneebly-build.js"],
  "relatedFiles": [],
  "testCommand": null
}
```

2. This spec should be picked up and processed without errors (the spec executor will generate the content, the ralph loop will create the file)
3. Verify the file is created and then moved to `.sneebly/completed/`
4. Delete the test file: `rm test-sneebly-build.js`
5. Run `npm test` if tests exist

Tell me when this phase is complete. Show me the updated prompt section in the spec executor and the parser changes in the dispatcher.
