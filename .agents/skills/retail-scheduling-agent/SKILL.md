---
name: retail-scheduling-agent
description: Deep domain knowledge and structured reasoning for retail team scheduling. Activate when asked to generate, review, optimize, or explain a retail employee schedule, fill a coverage gap, or evaluate scheduling fairness and labor costs.
---

# Retail Scheduling Agent Skill

## When to Use This Skill

Activate this skill whenever you are asked to:
- Generate a full-day or full-week retail schedule
- Review a draft schedule for conflicts, gaps, or rule violations
- Suggest which employee should fill an open shift
- Explain a scheduling decision to an employee or manager
- Evaluate labor cost, coverage adequacy, or schedule fairness
- Audit scheduling rules for compliance (rest gaps, break entitlements, role sequencing)

---

## Employee Composite Scoring Formula

Before assigning any shift, compute a composite priority score for each eligible employee. Higher scores win ties. See `references/scoring-rubric.md` for the exact weighted formula and computation details.

**Weights used by this application:**
- Availability overlap: 40%
- Performance score (90-day attendance/reliability points): 40%
- Hours remaining toward weekly target: 20%

**Priority order (hard constraints override scores):**
1. Mandatory constraints (REQUIRED status, HARD_OFF exclusions, availability conflicts, store closure)
2. Target-hours obligation (full-time employees must reach their weekly target before part-timers get shifts)
3. Composite score tiebreaker

---

## Availability Status Definitions

| Status | Meaning | Scheduling Action |
|--------|---------|-------------------|
| `REQUIRED` | Employee's recurring work pattern demands this day | Must schedule — this is a hard constraint |
| `HARD_OFF` | Employee's recurring day off | Must not schedule — hard exclusion |
| `unavailable` | Employee submitted a specific date-off request | Must not schedule for that date |
| `preferred_off` | Employee prefers off but can work | Schedule only as last resort to meet minimum staffing |
| `available` | Employee can work | Schedule normally using composite score |

---

## Retail Scheduling Principles

### 1. Coverage Curves Against Revenue

Revenue projections drive staffing levels, not headcount preferences.

- Map projected daily revenue to the configured staffing tiers (e.g., $0–$2,000 → 2 staff; $2,001–$5,000 → 3 staff).
- Always enforce the store minimum staffing floor, even on low-revenue days.
- When actual revenue history is unavailable, use the same day-of-week from 52 weeks prior (364 days) to preserve seasonal context.
- If no historical data exists, default to minimum staffing and flag the gap in warnings.

### 2. Shift Block Sequencing (Opener / Mid / Closer)

Retail shifts must be sequenced correctly within each operating day:

- **Openers** must arrive before or at store open time. At least one Opener or Key Holder is required on every opening shift.
- **Closers** must remain through or past store close time. At least one Closer or Key Holder is required on every closing shift.
- **Mid shifts** bridge the staffing curve between peak and off-peak hours. Schedule mids when revenue projections show an intraday surge.
- **No clopening**: Never assign the same employee to a closing shift on day N and an opening shift on day N+1. A clopening is defined as fewer than 10 hours between shift end and next shift start.

### 3. Mandatory Rest Gaps

- Minimum 10 hours must separate the end of one shift and the start of the next shift for the same employee.
- Minimum 1 full day off per week per employee (no 7-consecutive-day schedules).
- Preferred: 2 consecutive days off per week for employees not on a required pattern.

### 4. Break Entitlements by Shift Length

Apply these break rules to every generated shift:

| Shift Duration | Paid Break | Unpaid Meal Break |
|---------------|-----------|------------------|
| < 4 hours | None required | None required |
| 4–5.99 hours | 1 × 10-min rest | None required |
| 6–7.99 hours | 1 × 10-min rest | 1 × 30-min meal |
| 8+ hours | 2 × 10-min rest | 1 × 30-min meal |

Annotate break entitlements in the schedule reasoning field so managers can communicate them clearly to employees.

### 5. Min/Max Hours Guardrails

- **Full-time employees** (those with a `targetWeeklyHours` set): must receive enough shifts each week to meet their target before any part-timer receives extra shifts.
- **Maximum hours**: Do not schedule any employee beyond 40 hours/week without an explicit override. Flag any schedule that approaches or exceeds this threshold in warnings.
- **Minimum hours**: If an employee's scheduled hours fall more than 20% below their weekly target, flag it in warnings.

### 6. Labor Cost % Target Guardrails

- Retail labor cost should typically be 15–25% of projected revenue. Flag schedules that exceed 30% as over-budget and those below 10% as potentially under-staffed.
- When shift overlap is configured (e.g., 60-minute transition overlap between shift blocks), compute the additional labor cost of overlapping hours and warn if it exceeds the configured budget limit.
- Express labor cost concerns in dollar amounts, not just percentages, so managers can act immediately.

### 7. Fairness Rotation Heuristics

- Over a rolling 4-week period, distribute undesirable shifts (early opens, late closes, weekend shifts) as evenly as possible across eligible employees.
- If an employee has worked 3 consecutive weekend days, deprioritize them for the next weekend unless they are REQUIRED.
- Do not assign the same employee every holiday shift — note any recurring imbalance in warnings.
- Use the performance score as a tiebreaker, not as a fairness override. High performers should not receive all prime shifts at the expense of fairness.

### 8. Role Sequencing Rules

When coverage rules are active, enforce these as hard constraints (below availability but above score):

| Rule Type | Constraint |
|-----------|-----------|
| `opening_requires_classification` | Opening shift must include ≥ N employees with the specified role (e.g., Key Holder) |
| `closing_requires_classification` | Closing shift must include ≥ N employees with the specified role (e.g., Closer) |
| `min_classification_per_shift` | Every shift must include ≥ N employees with the specified role |
| `new_hire_paired_with_trainer` | Any New Hire on a shift must share that shift with at least one Trainer |
| `no_clopening` | Same employee must not close one day and open the next |

Available employee role classifications: `Opener`, `Closer`, `Key Holder`, `Trainer`, `New Hire`.

---

## Handling Edge Cases

### Unavailable Employees / Last-Minute Time Off

1. Remove the employee from the candidate pool for that date immediately.
2. Recalculate coverage needs — do not simply leave a gap.
3. Promote the next highest-scoring available employee, respecting all role constraints.
4. If coverage cannot be met without a `preferred_off` employee, schedule them and note it as a last-resort assignment in warnings.
5. If coverage still cannot be met, flag the gap explicitly: include the date, shift block, and shortfall count in warnings.

### Under-Coverage (Too Few Available Employees)

1. First, check whether any available employee can work a double (back-to-back shift blocks) without violating rest-gap rules.
2. If so, assign the highest-scoring eligible employee for the additional block, flagging it as an extended shift.
3. If still short, enumerate the gap precisely in warnings rather than silently omitting the shift.

### Over-Coverage (Too Many Employees Scheduled)

1. Trim by removing the lowest-scoring employee from the shift where coverage exceeds the staffing tier threshold.
2. Preserve REQUIRED employees — never remove them even if they create over-coverage.
3. Note any over-coverage in warnings so the manager can choose to keep extra staff if revenue warrants it.

---

## Think-Out-Loud Reasoning Chain

Before producing any schedule output, reason through these steps internally:

1. **Identify constraints**: List every REQUIRED, HARD_OFF, and unavailable restriction for the period.
2. **Map revenue to staffing**: For each day, determine the staffing tier and required headcount per shift block.
3. **Check role coverage**: Verify that enough Openers, Closers, Key Holders, and Trainers exist among available employees.
4. **Score candidates**: For each shift slot, rank available employees using the composite score (availability overlap 40%, performance 40%, hours remaining 20%).
5. **Assign shifts**: Fill slots top-down by score, respecting target-hours priority for full-timers first.
6. **Validate rest gaps**: Confirm no employee has fewer than 10 hours between consecutive shifts.
7. **Check break entitlements**: Annotate breaks for shifts ≥ 4 hours.
8. **Assess fairness**: Verify weekend/undesirable shift distribution is within acceptable balance.
9. **Calculate labor cost**: Estimate labor cost % of projected revenue. Flag if outside 15–25% band.
10. **Surface warnings**: Enumerate any constraint violations, coverage gaps, or budget concerns.
11. **Produce output**: Generate the structured schedule with a reasoning note per assignment.

---

## Output Format

Always produce a schedule in this structure (JSON for programmatic use):

```json
{
  "schedule": [
    {
      "date": "YYYY-MM-DD",
      "employeeId": "uuid",
      "employeeName": "Full Name",
      "shiftBlock": "Morning | Afternoon | Evening",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "reasoning": "Brief justification referencing score, role, or constraint"
    }
  ],
  "summary": "One-paragraph narrative of the week's scheduling approach",
  "warnings": ["List of any constraint violations, gaps, or budget concerns"]
}
```

For human-readable explanations, adapt the reasoning field into plain language appropriate for the audience (manager vs. employee).

---

## Maintenance Notes

**Runtime source of truth**: The server-side Claude prompt in `server/routes/aiScheduling.ts` (SCHEDULING PRINCIPLES preamble) is what actually controls live schedule generation. This skill file and the reference documents describe the same rules in an agent-readable format. Whenever scheduling logic, weights, or coverage rules change in the code, update this skill and both reference files to stay in sync.

**What is enforced by code vs. by the agent**:
- *Guaranteed by server code*: HARD_OFF and unavailable employee exclusions, store closure day filtering, authenticated access checks, response JSON validation.
- *Applied by Claude during generation*: the 40/40/20 composite scoring formula, rest gap checks, role sequencing, break entitlements, fairness distribution, labor cost % guidance.

---

## References

- `references/scoring-rubric.md` — Weighted composite scoring formula with guidance on code-enforced vs. agent-interpreted behavior
- `references/prompt-templates.md` — Ready-to-use prompt structures for four scheduling scenarios
