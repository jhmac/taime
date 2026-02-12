# LIBBY — Boutique Operating System

## Product Specification & Development Roadmap

**Version 3.0 — February 2026**

Built on the methodologies of:
- **Paul Akers** (2 Second Lean)
- **Rick Segel** (Retail Business Kit)
- **Mike Michalowicz** (Profit First)
- **The Boutique Hub**
- **Tommy Mello** (SOP Excellence)
- **David Allen** (GTD System)

---

## Executive Summary

### What's New in Version 3.0

This enhanced specification transforms LIBBY from a daily operations platform into a world-class operational excellence system by integrating two critical methodologies:

- **SOP Library & Process Engine** — Following Tommy Mello's principles, LIBBY surfaces step-by-step procedures exactly when they're needed, making SOPs impossible to ignore and eliminating the "we have SOPs but nobody follows them" problem.
- **GTD Workflow Engine** — Implementing David Allen's Getting Things Done methodology, LIBBY captures everything, clarifies next actions, organizes by context, and enforces weekly reviews to eliminate task overwhelm.
- **Notifications & Scheduled Reminders** — Proactive alerting system for store owners and managers to track daily task completion, receive scheduled check-ins, and get digest summaries of team activity.

### Key Problems Solved

- **SOPs exist but nobody follows them** → Context-aware SOP surfacing makes procedures unavoidable
- **Tasks fall through the cracks** → Universal capture system with AI-powered inbox processing
- **Vague to-dos sit undone** → AI clarification engine converts unclear tasks into specific next actions
- **Wrong task at wrong time** → Context-based organization (@store, @phone, @computer, @waiting)
- **No reflection on what's working** → Built-in weekly review ritual with AI-guided prompts
- **Managers don't know if tasks were done** → Automated alerts when morning tasks are incomplete, scheduled meeting reminders, and daily digest notifications

### Core Philosophy

- **2 Second Lean**: Every interaction should make something better. Fix what bugs you. Grow people first.
- **Profit First**: Sales - Profit = Expenses. Financial health is non-negotiable and always visible.
- **Remarkable Retail**: Good enough isn't good enough. Every touchpoint tells your story.
- **SOP Excellence**: Procedures should be impossible to ignore, not impossible to find.
- **GTD Workflow**: Your mind is for having ideas, not holding them. Capture everything, clarify next actions.
- **AI as Copilot**: AI handles the cognitive load so humans can focus on creativity and connection.

---

## Feature Matrix

**Status Key:** `LIVE` = Shipped | `IN DEV` = Building | `PLANNED` = Roadmap | `NEW` = From Enhanced Blueprint

---

### Module 1: Workforce Management

*The foundation. Time tracking, scheduling, and payroll.*

| Feature | Description | Status |
|---|---|---|
| Digital Clock-In/Out | Mobile-first time tracking with break logging | LIVE |
| Geofencing | Haversine distance validation ensures on-site presence | LIVE |
| Photo Verification | Optional selfie capture on clock-in for accountability | LIVE |
| Visual Schedule Calendar | Interactive week-view with drag-and-drop shift management | LIVE |
| Shift Templates | Reusable shift patterns for quick weekly planning | LIVE |
| Availability Tracking | Employees set preferred hours and time-off requests | LIVE |
| Payroll Reports | Automated pay period generation with overtime calculations | LIVE |
| AI Staffing Optimizer | Analyzes Shopify sales to suggest optimal staffing levels | LIVE |
| In-App Messaging | Real-time threads for announcements and shift swaps | PLANNED |
| Payroll Export | Direct integration with Gusto, ADP, and other providers | PLANNED |

---

### Module 2: Daily Operations Engine (SOP-Driven)

*The heartbeat. Rituals and tasks that run like clockwork, powered by embedded SOPs.*

| Feature | Description | Status |
|---|---|---|
| Task Assignment | Create, assign, and track operational tasks with priority flags | LIVE |
| Morning Huddle Mode | Guided 10-min standup with SOP prompts: yesterday's wins, today's focus, one improvement each | NEW |
| Opening Checklist SOP | Time-boxed ritual with step-by-step procedure: 3S time, visual check, POS ready confirmation | NEW |
| Closing Checklist SOP | Guided procedure: floor reset, cash reconciliation, daily debrief logging | NEW |
| Midday Pulse | Automated 12pm check: sales vs. goal with energy adjustment prompts | NEW |
| Shift Handoff Protocol SOP | Structured 5-min verbal handoff template with mandatory key info prompts | NEW |
| Daily Debrief Capture | End-of-day reflection: what worked, what didn't, one improvement idea | NEW |
| Context-Aware SOP Surfacing | AI detects current task and automatically displays relevant SOP (e.g., customer at register → POS Transaction SOP) | NEW |
| AI Task Auto-Assign | Claude distributes chores based on staff skills, current workload, and context | PLANNED |

---

### Module 2B: Issue Tracker

*The safety net. Capture problems before they become disasters.*

| Feature | Description | Status |
|---|---|---|
| Quick Issue Logging | One-tap capture: describe issue, add photo, select category (equipment, facility, process, other) | NEW |
| Priority Levels | Urgent (blocks operations), Normal (needs attention), Low (when convenient) | NEW |
| Auto-Notify Managers | Urgent issues instantly push to owner/manager devices; others batch in daily digest | NEW |
| Assignment & Ownership | Managers assign issues to team members or vendors; track who's responsible | NEW |
| Status Workflow | Open → Acknowledged → In Progress → Resolved; with timestamps | NEW |
| Resolution Notes | Document how issue was fixed for future reference and training | NEW |
| Issue History & Search | Searchable archive of all issues; filter by status, category, date, reporter | NEW |
| Recurring Issue Detection | AI flags patterns: "Barcode scanner reported 3x this month—consider replacement" | NEW |
| Issue Dashboard | Owner view: open issues count, avg resolution time, issues by category | NEW |
| SOP Auto-Link | When issue is logged, AI suggests relevant troubleshooting SOP | NEW |

---

### Module 3: The Lean Board (Continuous Improvement)

*The culture engine. Making improvement addictive and fun.*

| Feature | Description | Status |
|---|---|---|
| Improvement Logging | Voice or photo capture of 2-second improvements with description | NEW |
| Time Saved Calculator | AI estimates seconds/minutes saved per improvement, tracks running total | NEW |
| Weekly Leaderboard | Gamified ranking: "Jenna saved 47 minutes this week!" | NEW |
| Improvement Awards | Monthly badges and recognition for top contributors | NEW |
| Pattern Detection | AI spots themes: "70% of improvements are about finding things—try labeling" | NEW |
| Searchable Knowledge Base | All improvements indexed for new hire training and process documentation | NEW |
| Before/After Gallery | Visual showcase of improvements for team inspiration and onboarding | NEW |
| SOP Update Trigger | When improvement is logged, AI prompts: "Should we update the Opening Checklist SOP to include this?" | NEW |

---

### Module 5: Style DNA (Customer Intelligence)

*The relationship builder. Know your customers better than they know themselves.*

| Feature | Description | Status |
|---|---|---|
| Customer Profiles | Centralized view: purchase history, sizes, preferences, staff notes | NEW |
| Quick Note Capture | Staff logs preferences during/after interactions ("Loves bold prints, size 8") | NEW |
| Taste Cluster Engine | AI categorizes customers: bohemian, minimalist, statement, classic, etc. | NEW |
| Win-Back Triggers | Auto-flags customers who haven't visited in 45+ days | NEW |
| VIP Alerts | Notification when high-value customer enters (if recognized) | NEW |
| Birthday/Anniversary Reminders | Proactive outreach prompts for special occasions | NEW |

---

### Module 6: The Morning Whisper (AI Daily Briefing)

*The coach. Start every day informed, focused, and confident.*

| Feature | Description | Status |
|---|---|---|
| Audio Briefing | 60-second personalized audio summary delivered at owner's preferred time | NEW |
| Sales Context | Yesterday vs. goal with emotional framing ("You crushed it!" vs. "Tough day, but...") | NEW |
| Today's Opportunities | Custom orders due, VIP birthdays, expected returns, staffing notes | NEW |
| Weather Selling Tips | "Rain expected—great day to push the new raincoats" | NEW |
| Improvement Insight | One data-driven suggestion: "Conversion is 15% lower on Tuesdays—consider..." | NEW |
| Text Summary Option | For those who prefer reading: same content as push notification or email | NEW |

---

### Module 7: Analytics & Reporting Hub

*The clarity provider. See patterns, spot problems, celebrate wins.*

| Feature | Description | Status |
|---|---|---|
| Activity Logging | Audit trail of all admin actions and sensitive changes | LIVE |
| Anomaly Detection | AI flags unusual clock-in patterns or potential payroll errors | PLANNED |
| Visual Dashboards | Labor cost trends, punctuality scores, task completion rates | PLANNED |
| Weekly Summary Report | AI-generated digest: sales, staffing efficiency, improvements logged | NEW |
| Monthly Scorecard | KPIs at a glance: labor %, improvement count, customer health | NEW |
| Quarterly Business Review | Auto-generated QBR deck for owner reflection and planning | NEW |

---

### Module 8: Platform Foundation

*The infrastructure. Rock-solid, mobile-first, always available.*

| Feature | Description | Status |
|---|---|---|
| Clerk Auth + RBAC | Secure sign-in with Owner/Admin/Employee roles, 30+ permissions | LIVE |
| Member Directory | Searchable employee list with inline profile editing | LIVE |
| Payroll Setup Wizard | Onboarding flow for configuring initial payroll state | LIVE |
| Shopify Deep Sync | Real-time sales data streaming for labor % and daily targets | IN DEV |
| PWA + Push Notifications | Clock-out reminders, shift change alerts, native-like experience | PLANNED |
| Offline Mode | Local storage of time entries when connectivity is lost | PLANNED |

---

### Module 9: SOP Library & Process Engine

*The excellence enforcer. Step-by-step procedures that surface exactly when needed.*

| Feature | Description | Status |
|---|---|---|
| Searchable SOP Library | Categorized repository: Opening/Closing, Customer Service, Sales, Operations, Troubleshooting, Emergency | NEW |
| Step-by-Step Builder | Create SOPs with numbered steps, quality checkpoints, time estimates, photos/videos | NEW |
| Decision Tree Logic | "If customer asks for refund THEN check if within 30 days ELSE offer store credit" | NEW |
| Context-Aware Surfacing | AI detects current task/issue and auto-displays relevant SOP | NEW |
| Quick Access Widget | Floating button on every screen: "Need help? Tap for SOPs" | NEW |
| Role-Based Playbooks | Owner Playbook, Manager Playbook, Sales Associate Playbook, Visual Merchandiser Playbook | NEW |
| Photo/Video Walkthroughs | Embed visual guides in every SOP (e.g., "How to fold our signature style") | NEW |
| Quality Checkpoints | Built-in verification steps: "Before proceeding, confirm: Is floor reset complete?" | NEW |
| Training Mode | New hires follow SOPs with AI coaching prompts and comprehension checks | NEW |
| Version Control | Track SOP updates, see who changed what when, revert to previous versions | NEW |
| SOP Completion Tracking | Log when SOPs are followed, identify which procedures are being ignored | NEW |
| AI SOP Suggestions | "You've logged 'cash drawer short' 3 times this month. Create a Cash Handling SOP?" | NEW |
| SOP Templates | Pre-built templates for common boutique procedures (customize for your store) | NEW |
| Emergency Procedures | Quick access to: Fire, Medical Emergency, Shoplifting, Credit Card Fraud, etc. | NEW |

---

### Module 10: GTD Workflow Engine

*The mental freedom system. Capture everything, clarify next actions, organize by context.*

| Feature | Description | Status |
|---|---|---|
| Universal Inbox | One-tap capture for tasks, ideas, customer notes, issues (voice, photo, or text from anywhere) | NEW |
| AI Clarification Engine | Converts vague tasks to next actions: "Fix website" → "Email developer about broken checkout button" | NEW |
| Project vs. Action Detection | AI identifies multi-step outcomes (Projects) vs. single physical tasks (Next Actions) | NEW |
| Context-Based Organization | @store, @phone, @computer, @email, @waiting_for, @errands—tasks auto-tagged by where they happen | NEW |
| Next Actions List | Specific, physical tasks ready to execute ("Call Sarah re: custom order", "Restock denim wall") | NEW |
| Projects List | Outcomes requiring multiple steps ("Launch spring collection", "Hire new sales associate") | NEW |
| Waiting For Tracker | Delegated items with follow-up dates ("Waiting: Sarah to approve display design by Friday") | NEW |
| Someday/Maybe List | Ideas for later ("Consider opening second location", "Research pop-up shop opportunity") | NEW |
| Weekly Review Ritual | Scheduled Friday 3pm: Review all projects, clear inbox, update next actions, reflect on wins | NEW |
| AI Review Assistant | Guides weekly review: "Project 'Spring Launch' has no next actions. What's blocking it?" | NEW |
| Smart Task Suggestions | "You're at the store with 15 minutes free. Suggested: @store tasks requiring low energy" | NEW |
| Energy Level Tagging | Tasks tagged as High/Medium/Low energy ("Update Instagram" = Low, "Reorganize stockroom" = High) | NEW |
| Reference Material Storage | Non-actionable info filed for later (vendor catalogs, inspiration photos, training docs) | NEW |
| Inbox Zero Dashboard | Visual reminder: "3 items in inbox—let's process them" (gamified progress bar) | NEW |
| Two-Minute Rule Enforcement | AI asks: "Can this be done in <2 minutes? If yes, do it now." | NEW |

---

### Module 11: Notifications & Scheduled Reminders

*The accountability partner. Proactive alerts so nothing slips through the cracks.*

| Feature | Description | Status |
|---|---|---|
| Morning Task Check-In | Automated alert to owner/manager if morning opening tasks haven't been marked complete by a configured time (e.g., 10:15 AM) | NEW |
| Midday Task Digest | Push notification at noon: "3 of 8 tasks completed today. 2 overdue." | NEW |
| End-of-Day Summary | Evening digest: tasks completed, tasks missed, hours worked, issues logged | NEW |
| Scheduled Meeting Reminders | Configurable reminders like "Meet with manager about tasks at 2pm" or "Weekly 1:1 with Sarah at 3pm" | NEW |
| Custom Recurring Alerts | Owner sets recurring reminders: "Check inventory every Tuesday at 9am", "Review cash drawer at close" | NEW |
| Overdue Task Escalation | If a task stays incomplete past its deadline, auto-notify the assigner and bump priority | NEW |
| Shift Start Reminders | Employees get a reminder 30 minutes before their shift starts | NEW |
| Clock-Out Nudge | Reminder when an employee has been clocked in past their scheduled end time | NEW |
| Weekly Review Prompt | Friday afternoon reminder: "Time for your weekly GTD review — 3 items in inbox, 2 stalled projects" | NEW |
| Manager Daily Briefing Alert | Morning push to owner/managers: "Today: 4 staff scheduled, 12 tasks assigned, 1 open issue" | NEW |
| SOP Compliance Alert | Notify manager when an SOP checklist (e.g., Opening or Closing) was skipped or left incomplete | NEW |
| Smart Quiet Hours | Notifications respect configured quiet hours (e.g., no alerts after 9pm or before 7am) | NEW |
| Notification Preferences | Each user configures which alerts they receive and how (push, email, in-app, or SMS) | NEW |

---

## Development Roadmap

### Q1 2026: Foundation + Daily Rituals + SOP Core

**Theme:** *"Make every day run like clockwork with bulletproof procedures"*

- **Sprint 1–2:** Morning Huddle Mode, Opening/Closing Checklists, Daily Debrief, Issue Tracker MVP, SOP Library foundation
- **Sprint 3–4:** Midday Pulse, Shift Handoff Protocol, Shopify Deep Sync, Step-by-Step SOP Builder, Morning Task Check-In alerts
- **Sprint 5–6:** The Lean Board MVP, Context-Aware SOP Surfacing, Role-Based Playbooks (Owner, Manager, Associate), Scheduled Meeting Reminders

**Key Outcomes:** Daily rituals digitized, problems captured fast, SOPs are impossible to ignore, managers alerted when tasks aren't done

---

### Q2 2026: GTD Workflow + Customer Intelligence + Notifications

**Theme:** *"Know your numbers, know your people, capture everything"*

- **Sprint 7–8:** Universal Inbox, AI Clarification Engine, Next Actions & Projects Lists, Notification Preferences system
- **Sprint 9–10:** Context-Based Organization (@store, @phone, etc.), Waiting For Tracker, Style DNA MVP, Overdue Task Escalation
- **Sprint 11–12:** Weekly Review Ritual, In-App Messaging, PWA + Push Notifications, Offline Mode, End-of-Day Summary digests

**Key Outcomes:** Nothing falls through the cracks, personalized selling, proactive notifications keep everyone accountable

---

### Q3 2026: AI Copilot + Gamification + Advanced SOPs

**Theme:** *"Your AI partner runs the business with you"*

- **Sprint 13–14:** The Morning Whisper, AI Review Assistant, Smart Task Suggestions, SOP Training Mode
- **Sprint 15–16:** Lean Board Leaderboard, Pattern Detection, Recurring Issue Detection, Decision Tree SOPs
- **Sprint 17–18:** Taste Cluster Engine, Win-Back Triggers, VIP Alerts, Photo/Video SOP Walkthroughs

**Key Outcomes:** AI as daily coach, gamified improvement, visual SOP training

---

### Q4 2026: Polish + Scale Prep

**Theme:** *"Ready for thousands of boutiques"*

- **Sprint 19–20:** Quarterly Business Review, Advanced Dashboards, SOP Version Control, SOP Templates Library
- **Sprint 21–22:** Payroll Export (Gusto/ADP), Anomaly Detection, AI Task Auto-Assign, Emergency Procedures
- **Sprint 23–24:** Multi-location support, Onboarding wizard, White-label prep, Inbox Zero Dashboard

**Key Outcomes:** Full operational visibility, intelligent automation, enterprise readiness

---

## Technical Architecture

### Current Stack

- **Frontend:** React 18+, TypeScript, Vite, Tailwind CSS, shadcn/ui, Radix UI
- **Backend:** Node.js, Express, TypeScript, Drizzle ORM
- **Database:** PostgreSQL (Neon serverless)
- **Auth:** Clerk (OAuth/SSO with RBAC)
- **AI:** Anthropic Claude (claude-sonnet-4-20250514)
- **Real-time:** WebSocket server for live updates
- **Integrations:** Shopify GraphQL Admin API (sales sync, staffing recommendations)

### New Database Schemas (Planned)

**SOP Engine Tables:**
- `sop_library`: id, title, category, description, created_by, updated_at, version, is_active
- `sop_steps`: id, sop_id, step_number, instruction, time_estimate_seconds, photo_url, video_url, is_checkpoint
- `sop_decision_trees`: id, sop_id, step_number, condition, if_true_goto_step, if_false_goto_step
- `sop_executions`: id, sop_id, user_id, started_at, completed_at, steps_completed_json, quality_passed
- `sop_versions`: id, sop_id, version_number, changes_description, updated_by, updated_at

**GTD Workflow Tables:**
- `inbox`: id, user_id, content, capture_method (voice/photo/text), raw_data_url, created_at, processed_at
- `next_actions`: id, description, context (@store/@phone/etc), energy_level (high/med/low), user_id, project_id, due_date
- `projects`: id, title, desired_outcome, user_id, status (active/on_hold/completed), next_review_date
- `waiting_for`: id, description, delegated_to, follow_up_date, user_id, project_id, created_at
- `someday_maybe`: id, idea_description, user_id, category, created_at
- `weekly_reviews`: id, user_id, review_date, projects_reviewed_count, inbox_processed, notes, completed_at
- `reference_materials`: id, title, content, user_id, category, file_url, created_at

**Notifications & Reminders Tables:**
- `scheduled_reminders`: id, user_id, title, message, reminder_time, recurrence (once/daily/weekly/custom), is_active, created_at
- `notification_preferences`: id, user_id, channel (push/email/in_app/sms), category, is_enabled
- `notification_log`: id, user_id, type, title, body, sent_at, read_at, action_url

### AI Processing Pipelines

- **Inbox Clarification:** Claude analyzes inbox items, extracts next action, suggests context/energy level
- **SOP Surfacing:** Real-time context detection triggers relevant SOP display (task type + current screen)
- **Pattern Recognition:** Analyzes issue history, improvements, and task data to suggest SOP updates
- **Weekly Review Assistant:** Generates personalized review prompts based on unclosed loops and stalled projects
- **Notification Intelligence:** AI determines optimal notification timing and bundles low-priority alerts into digests

---

## Success Metrics

### SOP & GTD-Specific Metrics

- **SOP Completion Rate:** Target 95% within 6 months (up from 0%)
- **Inbox Processing Time:** Target <5 minutes daily within 3 months
- **Weekly Review Completion:** Target 90% of scheduled reviews completed within 6 months
- **Tasks Clarified by AI:** Target 80% of vague tasks auto-converted to next actions
- **Context Accuracy:** Target 90% of tasks correctly tagged with context within 3 months
- **SOP Creation Rate:** Target 20+ core SOPs created within first 90 days
- **Procedure Consistency:** Target 95% adherence to SOPs (measured via quality checkpoints)

### Notification & Reminder Metrics

- **Morning Task Alert Response Rate:** Target 90% of flagged incomplete tasks completed within 30 minutes of alert
- **Scheduled Reminder Adherence:** Target 95% of meetings/check-ins acknowledged
- **Notification Read Rate:** Target 80% of push notifications read within 1 hour
- **Overdue Task Reduction:** Target 60% reduction in overdue tasks within 3 months

### Business Impact Targets (12-Month)

- **Owner Hours Worked:** Reduce from 60/week to 50/week (-10 hours)
- **Training Time for New Hires:** Reduce from 3 weeks to 1 week (SOP-powered training)
- **Task Completion Rate:** Increase from ~70% to 95%
- **Operational Errors:** Reduce by 80% (cash drawer errors, missed tasks, customer service issues)
- **Employee Confidence Score:** Increase by 40% ("I know what to do in any situation")

---

## Appendix A: Sample SOPs

### SOP-001: Opening Procedure

**Category:** Daily Operations | **Time Required:** 30 minutes | **Last Updated:** Feb 2026

1. **Step 1 (5 min):** Unlock doors, disable alarm, turn on all lights. **CHECKPOINT:** Are all lights functional? If no, log issue in Issue Tracker.
2. **Step 2 (5 min):** 3S Time — Sort, Sweep, Standardize your workspace. Remove any items that don't belong, wipe down surfaces, arrange tools.
3. **Step 3 (10 min):** Visual Floor Check — Walk entire sales floor. Fix any misaligned hangers, fallen items, wrinkled displays. **CHECKPOINT:** Does floor match yesterday's closing photo?
4. **Step 4 (3 min):** Start POS system. Log in to Shopify POS. Run test transaction (void a 1-cent sale). **CHECKPOINT:** Receipt prints correctly?
5. **Step 5 (2 min):** Verify cash drawer starting balance. Count bills and coins, confirm matches expected amount. **CHECKPOINT:** Does amount match closing report?
6. **Step 6 (5 min):** Quick huddle with team (if multiple staff). Review: yesterday's wins, today's goals, any special notes (VIP visits, custom order pickups).
7. **Final Checkpoint:** All steps complete? Store ready to open? Unlock front door at scheduled time.

### SOP-007: Handling Customer Returns

**Category:** Customer Service | **Time Required:** 5–10 minutes | **Last Updated:** Feb 2026

1. **Step 1:** Greet customer warmly. Ask: "How can I help you today?"
2. **Step 2:** Examine item and receipt. **DECISION:** Does customer have receipt? IF YES → Step 3. IF NO → Step 6.
3. **Step 3:** Check purchase date. **DECISION:** Within 30 days? IF YES → Step 4. IF NO → Offer store credit only (Step 5).
4. **Step 4:** Inspect item condition. **DECISION:** Tags attached, item unworn/unwashed? IF YES → Process full refund. IF NO → Offer exchange or store credit.
5. **Step 5:** Process refund/exchange/store credit in POS. Print receipt. Place item in return bin for restocking.
6. **Step 6 (no receipt):** Look up purchase in Shopify by customer name/email. IF FOUND → Proceed as if receipt exists. IF NOT FOUND → Politely explain store credit policy.
7. **Step 7:** Thank customer. Add note to their profile in Style DNA: "Returned [item] on [date] — reason: [size/style/etc]."
8. **QUALITY CHECKPOINT:** Did you maintain friendly tone throughout? Customer leaves satisfied?

### SOP-015: Emergency Procedure — Shoplifting Incident

**Category:** Emergency | **Time Required:** 5–15 minutes | **Last Updated:** Feb 2026

1. **Step 1:** DO NOT CONFRONT THE SUSPECT. Your safety is priority #1.
2. **Step 2:** Observe and document. Note: physical description, items taken, direction of exit, vehicle if visible. Use voice memo to capture details immediately.
3. **Step 3:** **DECISION:** Is suspect still in store? IF YES → Alert other staff, maintain visual contact from safe distance. IF NO → Proceed to Step 5.
4. **Step 4:** If suspect exits, note time and direction. DO NOT FOLLOW outside the store.
5. **Step 5:** Immediately call owner/manager. Relay all observations.
6. **Step 6:** Manager decision: File police report? **DECISION:** Value >$50 or repeat offender? IF YES → Call non-emergency police line. IF NO → Document internally only.
7. **Step 7:** Log incident in Issue Tracker (category: Security, priority: Normal). Include all details from Step 2.
8. **Step 8:** Review security camera footage if available. Save clip to incident file.

> **IMPORTANT:** Never put yourself in danger. Property is replaceable, you are not. If suspect becomes aggressive, dial 911 immediately.

---

## Appendix B: Operational Rhythms (Enhanced with GTD)

LIBBY enforces these rhythms through SOP-driven checklists, GTD workflows, reminders, and AI-generated prompts.

### Daily Rhythm

| Time | Activity |
|---|---|
| 6:00 AM | Morning Whisper delivered (audio briefing) |
| 9:30 AM (30 min before open) | Opening Procedure SOP, 3S time, Morning Huddle, Visual Check |
| 10:15 AM | **Morning Task Check-In alert** — notify owner/manager if opening tasks are still incomplete |
| 12:00 PM | Midday Pulse check (app notification), process inbox to zero |
| Shift Change | 5-minute Handoff Protocol SOP |
| 2:00 PM (example) | **Scheduled meeting reminder** — "Meet with manager about tasks" |
| Closing (30 min) | Floor reset, cash reconciliation, daily debrief, capture tomorrow's next actions |
| After Close | **End-of-Day Summary** — digest of tasks completed, missed, hours worked, issues logged |

### Weekly Rhythm

| Day | Focus |
|---|---|
| Monday | Metrics review, team meeting, review all active projects |
| Tuesday | 15-min training session (SOP review or new procedure) |
| Wednesday | Process incoming inventory |
| Thursday | Customer outreach day (win-back triggers, VIP follow-ups) |
| Friday 3:00 PM | GTD Weekly Review (mandatory, AI-guided, 30 minutes) |
| Saturday | Peak selling focus |
| Sunday | Prep and plan ahead, review Someday/Maybe list |

### Weekly GTD Review Agenda (Built into LIBBY)

1. Collect loose papers and materials (5 min)
2. Process inbox to zero (10 min) — AI assists with clarification
3. Review all active projects (10 min) — AI asks: "Does each project have a next action?"
4. Review Next Actions lists by context (5 min)
5. Review Waiting For list (3 min) — AI suggests follow-ups
6. Review Someday/Maybe (2 min) — AI asks: "Ready to activate any of these?"
7. Review calendar and plan next week (5 min)

---

*End of Enhanced Specification*
