# Domain Context for Agents

## Single-context repository

Taime is a **single-context repository**: there is one canonical vocabulary for domain concepts, defined in [`CONTEXT.md`](../../CONTEXT.md) at the repo root. Do not invent synonyms, shorten names, or reuse everyday words differently from how they are defined there.

## Rule: read `CONTEXT.md` before naming anything

Before naming a new feature, table, column, route, UI string, or domain concept, read `CONTEXT.md`. If a term already exists in the glossary, use it exactly. If a concept is not in the glossary, choose a name that does not collide with any existing term and consider whether it belongs in the glossary.

The "Avoid" entries in the glossary are as binding as the canonical names — do not use them in new code, copy, or documentation.

## Rule: consult the relevant ADR before working in a domain area

Six Architecture Decision Records capture the key design choices. Read the relevant one(s) before making changes in its area. If your work conflicts with a decision in an ADR, **surface the conflict** — do not silently override it. Raise it as a blocker or note in the task so a human can decide whether the ADR needs to be updated.

### ADR index

| ADR | Title | Consult when… |
|---|---|---|
| [ADR-0007](../adr/0007-store-is-the-unit-of-place.md) | Store is the unit of physical place; Company is a 1:1 envelope | working with Store, Location, Company, ShopifyConnection, or multi-tenancy |
| [ADR-0008](../adr/0008-permissions-and-roles.md) | Permissions are code-defined; Roles are runtime-defined; override beats role; permissions are User-global | working with Permissions, Roles, PermissionOverrides, or access control |
| [ADR-0009](../adr/0009-shift-and-availability-resolution.md) | Shift is the canonical word; availability resolution is layered | working with Shifts, Schedules, Availability, TimeOffRequests, or the auto-scheduler |
| [ADR-0010](../adr/0010-notify-service-and-channels.md) | Single `notify()` service with closed type registry, four channels, generic inbox | working with Notifications, NotificationTypes, NotificationChannels, InboxItems, or ScheduledReports |
| [ADR-0011](../adr/0011-stripe-billing-model.md) | Per-Store flat-fee subscription with code-defined Plans and Entitlements | working with Subscriptions, Plans, Entitlements, billing, or feature gating |
| [ADR-0012](../adr/0012-trial-and-shopify-onboarding.md) | 14-day no-card trial with Shopify-prefill onboarding | working with the trial period, onboarding flow, Shopify import, or StoreMembership creation |

## Rule: flag ADR conflicts, do not silently override

If the work you are doing would violate or expand beyond a recorded decision, stop and flag it. Write a clear note in the task (e.g. "This change would contradict ADR-0008 which says permissions are User-global — needs human decision before proceeding"). Do not implement the conflicting design and then mention it in passing at the end.
