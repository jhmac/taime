# Taime — Agent Context

This file is the entry point for AI agents working in this repository. Read it at the start of every session.

## Agent skills

### Issue tracker
Work is tracked as Replit project tasks, not GitHub Issues. Tasks move through a defined state lifecycle. Always reference tasks by their numeric ID (e.g. `#465`). Before proposing or starting work, check whether a task already exists for it.

See [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) for the full state machine and task conventions.

### Triage labels
Five canonical triage roles map to Replit task states. Use this vocabulary when categorising work or explaining why a task is blocked, deferred, or declined.

See [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md) for the label-to-state mapping.

### Domain docs

Before exploring the codebase or proposing changes, read [`CONTEXT.md`](./CONTEXT.md) at the repo root and any relevant ADRs under [`docs/adr/`](./docs/adr/). Read them silently — if a file is missing, do not flag its absence. In all outputs (issue titles, refactor proposals, hypotheses, test names, UI strings), use the glossary's vocabulary verbatim and do not drift to synonyms it explicitly lists under _Avoid_. If your proposed change contradicts an existing ADR, surface the conflict explicitly (e.g. "Contradicts ADR-0008 — but worth reopening because…") rather than silently overriding it.

This is a single-context repository. Every domain concept — from `Store` to `Shift` to `Entitlement` — has a canonical name defined in `CONTEXT.md`. Before naming anything new, read that file. Before working in a domain area, read the relevant Architecture Decision Record under `docs/adr/`.

See [`docs/agents/domain.md`](docs/agents/domain.md) for the reading checklist, ADR index, and conflict rules.
