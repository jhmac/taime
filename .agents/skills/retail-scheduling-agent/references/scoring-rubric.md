# Employee Scheduling Scoring Rubric

This document defines the composite scoring formula used by the application and enforced by the retail-scheduling-agent skill.

**Maintenance contract**: The 40/40/20 weights are injected directly into the Claude prompt inside `server/routes/aiScheduling.ts` (see the SCHEDULING PRINCIPLES preamble). Claude applies them during schedule generation. The detailed normalization steps below describe the *recommended* interpretation used by the agent; the server code does not independently compute a numeric score before sending context to Claude — it passes raw values (availability status, performance score, target hours) and Claude applies the weights. If the weights change in the prompt, update this file and `SKILL.md` accordingly.

> **Key distinction**: "Guaranteed by code" means the server explicitly enforces a constraint (e.g., excluding HARD_OFF employees before the prompt is built). "Recommended scoring interpretation" means the agent is instructed to apply a formula, but the calculation happens inside Claude's reasoning, not in TypeScript.

---

## Composite Score Formula

```
compositeScore = (availabilityOverlap × 0.40) + (performanceScore × 0.40) + (hoursRemaining × 0.20)
```

All three factors are normalized to a 0–100 scale before weighting so they contribute proportionally.

> **Weights — guaranteed by code**: The 40/40/20 split is embedded in the server prompt (`server/routes/aiScheduling.ts`, SCHEDULING PRINCIPLES section) and in the SKILL.md description, making it the authoritative instruction Claude receives.

---

## Factor 1: Availability Overlap (40%)

**Definition**: How well does the employee's available window cover the requested shift block?

**Computation** *(recommended agent interpretation — applied by Claude, not computed in TypeScript)*:
1. Determine the employee's available time window for the target date (from `userAvailability.startTime` / `endTime`, or full-day if unspecified).
2. Compute the intersection (in minutes) between the available window and the shift block window.
3. Divide by the total shift block duration (in minutes).
4. Multiply by 100 to normalize to 0–100.

**Special cases** *(HARD_OFF and unavailable exclusions are guaranteed by server code; preferred_off penalty is recommended agent interpretation)*:
- Status `available` with no time restriction → overlap = 100 (full match).
- Status `preferred_off` → overlap = 20 (usable only as last resort, heavily penalized).
- Status `unavailable` or `HARD_OFF` → employee is excluded from the candidate pool entirely (not scored).
- Status `REQUIRED` → overlap = 100 and the employee is pinned to this date regardless of score.

**Example**:
- Shift block: 09:00–14:00 (300 minutes)
- Employee available: 10:00–17:00 → overlap = 240 min / 300 min = 0.80 → normalized score = 80

---

## Factor 2: Performance Score (40%)

**Definition**: Points accumulated by the employee over the trailing 90 days from `clockEvents.pointValue`.

**Computation**:
1. Sum all `clockEvents.pointValue` rows for the employee where `createdAt >= NOW() - 90 days`.
2. This raw score reflects attendance reliability, on-time clock-ins, and task completion.
3. For normalization across the pool: `normalizedPerformance = (employeeRawScore / maxRawScoreInPool) × 100`. If all employees have 0 points, treat all as 50 (neutral).

**What earns points (examples)**:
- On-time clock-in → positive points
- Early clock-out or missed shift → negative or zero points
- Task completion, workplace reliability → positive points

**Why 40%**: Attendance and reliability are equally important as availability in retail scheduling. A highly available employee who frequently no-shows is a worse choice than a slightly less available but dependable one.

---

## Factor 3: Hours Remaining Toward Weekly Target (20%)

**Definition**: How far below their weekly target hours is the employee before this shift is assigned?

**Computation**:
1. Sum all hours already scheduled for this employee in the current scheduling week.
2. `hoursRemaining = max(0, targetWeeklyHours - scheduledHours)`
3. Normalize: `normalizedHours = min(hoursRemaining / targetWeeklyHours, 1.0) × 100`. Cap at 100.
4. If `targetWeeklyHours` is null (part-time / no target), use `hoursRemaining = 0` → normalized = 0.

**Priority override**: Before scoring, full-time employees (those with `targetWeeklyHours` set) are always considered before part-timers. The hours-remaining factor provides a within-group tiebreaker between full-time employees who are at different points toward their targets.

---

## Priority Ladder (Highest to Lowest)

When two or more employees have identical composite scores, apply these tiebreakers in order:

1. `REQUIRED` status (always wins — hard pin)
2. Full-time flag (`targetWeeklyHours` set and not yet met)
3. Higher composite score
4. Higher raw performance score (secondary tiebreaker)
5. Alphabetical by last name (final deterministic tiebreaker to avoid randomness)

---

## Exclusion Rules (Pre-Scoring Filters)

An employee is removed from the candidate pool before scoring if any of the following apply:

| Condition | Reason |
|-----------|--------|
| Status = `HARD_OFF` | Recurring day off — non-negotiable |
| Status = `unavailable` | Specific date-off request — non-negotiable |
| Store is closed that day | No shifts may be assigned on closed days |
| Employee already exceeds 40 hrs this week | Over max without explicit override |
| Rest gap violation | Previous shift ended < 10 hours before this shift starts |
| Role constraint violation | Required role classification not held by this employee (when a role-specific slot is being filled) |

---

## Score Example Walkthrough

Filling a Morning shift (09:00–14:00) on a Tuesday with 3 employees available:

| Employee | Avail Overlap | Perf Score (raw) | Hrs Remaining | Composite |
|----------|--------------|-----------------|--------------|-----------|
| Alice | 100 (full day) → 100 | 85 pts → 85 (normalized, max=100) | 20 hrs left / 40 target → 50 | (100×0.4) + (85×0.4) + (50×0.2) = 40+34+10 = **84** |
| Bob | 10:00–14:00 → 80 | 60 pts → 60 | 30 hrs left / 40 → 75 | (80×0.4) + (60×0.4) + (75×0.2) = 32+24+15 = **71** |
| Carol | preferred_off → 20 | 95 pts → 95 | 10 hrs left / 40 → 25 | (20×0.4) + (95×0.4) + (25×0.2) = 8+38+5 = **51** |

**Assignment**: Alice (score 84) fills the shift. Carol is only used if Alice and Bob are both unavailable.
