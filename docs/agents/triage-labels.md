# Triage Labels

Five canonical triage roles map to Replit task states. Use this vocabulary consistently when categorising, describing, or discussing work items.

| Triage label | Replit task state | Meaning |
|---|---|---|
| `needs-triage` | `PROPOSED` | The item has been logged but not yet reviewed or accepted. An agent or maintainer needs to evaluate it before any work begins. |
| `needs-info` | blocked / needs clarification | The task is waiting for information or a decision from a human before an agent can proceed. Do not mark the task `IMPLEMENTED`; leave a blocker note explaining what is needed. |
| `ready-for-agent` | `PENDING` | The task has been reviewed, accepted, and is waiting to be picked up. An agent may begin work immediately. |
| `ready-for-human` | blocked / awaiting human action | The next step requires a human action (e.g. a code review, a production deploy decision, or a credential that must be added). The task cannot advance until that action is taken. |
| `wontfix` | `CANCELLED` | The task has been explicitly declined or superseded. No further work should be done on it. |

## Notes

- A task can carry the spirit of a label without a literal label field — the table above is a conceptual mapping, not a hard enum in the task system.
- When raising a blocker, state clearly whether the label is `needs-info` (waiting on information) or `ready-for-human` (waiting on a human action) — they require different responses.
- `MERGED` tasks do not have a triage label; they are done.
