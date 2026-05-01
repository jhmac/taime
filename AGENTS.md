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
This is a single-context repository. Every domain concept — from `Store` to `Shift` to `Entitlement` — has a canonical name defined in `CONTEXT.md`. Before naming anything new, read that file. Before working in a domain area, read the relevant Architecture Decision Record under `docs/adr/`.

See [`docs/agents/domain.md`](docs/agents/domain.md) for the reading checklist, ADR index, and conflict rules.
