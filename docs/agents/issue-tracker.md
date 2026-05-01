# Issue Tracker

## Primary tracker: Replit project tasks

Work in this repository is tracked as **Replit project tasks**, not GitHub Issues. GitHub Issues on `jhmac/taime` exist but are not the primary tracker and may be out of date. When searching for, referencing, or creating work items, use Replit project tasks.

## Referencing tasks

Reference a task by its numeric ID prefixed with `#`, e.g. `#465`. Include the reference in commit messages, PR descriptions, and agent notes whenever work relates to a specific task.

## Task state lifecycle

Tasks move through the following states in order:

| State | Meaning |
|---|---|
| `PROPOSED` | An idea or request has been logged but not yet evaluated. No work should start. |
| `PENDING` | The task has been accepted and is ready to be picked up by an agent or developer. |
| `IN_PROGRESS` | An agent or developer is actively working on the task. |
| `IMPLEMENTED` | Work is complete in the agent's environment and awaiting merge review. |
| `MERGING` | The implementation is being merged into the main application. |
| `MERGED` | The change is live in the main application. This is a terminal state. |
| `CANCELLED` | The task was explicitly declined or superseded. This is a terminal state. |

A task may also be **blocked** — stuck in `IN_PROGRESS` or `PENDING` — when it is waiting for human input or a prerequisite to be resolved. Blocked tasks should be flagged with an explanation rather than silently left in progress.

## Agent conventions

- Before proposing new work, check whether a task already exists to avoid duplicates.
- Do not self-assign a task that is in `PROPOSED`; wait for it to reach `PENDING`.
- When you complete work, move the task to `IMPLEMENTED` and leave a summary of what was done and any deviations from the original plan.
- If you cannot complete a task without human input, leave a clear blocker note and do not mark it `IMPLEMENTED`.
