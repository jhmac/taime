# MAinager — Pre-Launch Test Plan

**Purpose:** Systematically verify every feature works correctly before launch.
**Approach:** Each feature gets a focused test scenario with clear pass/fail criteria.
**Priority Levels:** P0 = must pass before launch, P1 = should pass, P2 = nice to have

---

## 1. Smart Time Clock & Attendance — P0

**Setup:** Two test employees, one test location with geofence configured.

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Clock in within geofence | Open app at store location, tap Clock In | Entry recorded with timestamp and location |
| Clock in outside geofence | Open app away from store, tap Clock In | Blocked with location warning |
| Clock out | Tap Clock Out while clocked in | Exit time recorded, hours calculated |
| Break tracking | Start break, wait 2 min, end break | Break duration logged separately |
| Auto clock-out | Leave employee clocked in past shift end | System auto-clocks out after configured period |
| Duplicate prevention | Try to clock in while already clocked in | Prevented with clear message |

---

## 2. AI-Powered Scheduling — P0

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Generate schedule | Set store hours + availability, trigger AI schedule | Schedule created covering all hours with minimum staffing met |
| Respect availability | Mark employee unavailable Monday, generate | Employee not scheduled on Monday |
| Shopify data usage | Connect Shopify with sales history, generate | Busier periods get more staff allocated |
| Manual adjustment | Drag a shift to a different time on the grid | Shift updated, no conflicts created |
| Empty availability | Generate with no availability submitted | Graceful fallback or clear error message |

---

## 3. SOP Library — P0

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Create SOP | Build a 5-step opening procedure as owner | SOP saved and visible in library |
| Execute SOP | Employee opens SOP, completes each step | Progress tracked, completion recorded |
| Skip step | Skip a non-required step during execution | Skip recorded, execution continues |
| Photo step | Complete a step that requires a photo | Camera opens, photo attached to step |
| SOP categories | Filter SOPs by category (Opening, Closing, etc.) | Only matching SOPs shown |
| Training mode | New hire opens training SOP | Training instructions displayed, mastery tracked |

---

## 4. SOP Intelligence & Evolution — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Analytics load | Open SOP detail as manager, expand Analytics | Completion rates, avg times, step metrics displayed |
| Insight generation | Trigger manual insight generation | Insights created with severity levels |
| Acknowledge insight | Click Acknowledge on an active insight | Status changes to acknowledged |
| Revision proposal | Trigger SOP evolution after sufficient execution data | AI generates revision proposals for review |
| Approve revision | Review and approve a revision proposal | Proposal status changes to approved |

---

## 5. Decision Tree SOPs — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Create decision tree | Build SOP with branching yes/no logic | Tree saved with branches visible |
| Execute branch path | Follow "Yes" path through decision tree | Only relevant steps shown |
| Alternative path | Follow "No" path on same decision tree | Different steps shown correctly |

---

## 6. Task Management — P0

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Create task | Manager creates task with assignee and due date | Task appears on assignee's dashboard |
| Complete task | Employee marks task as done | Status updates, removed from active list |
| Overdue flagging | Create task with yesterday's due date | Task shows as overdue with visual indicator |
| Filter tasks | Filter by status (pending, completed, overdue) | Correct tasks shown for each filter |

---

## 7. GTD Workflow Engine — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Capture to inbox | Type a raw thought into GTD inbox | Item saved in inbox |
| AI classification | Submit inbox item for AI processing | AI suggests type (task, project, defer) with reasoning |
| Move to next actions | Process inbox item as a next action | Item moves to next actions list with context |
| Weekly review | Start weekly review ritual | AI-generated review loads with sections |
| Complete review | Work through all review sections, mark complete | Review status saved as completed |

---

## 8. Smart Task Suggestions — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Suggestions load | Open associate dashboard | Smart Suggestions card shows prioritized list |
| Urgency badges | Have mix of overdue tasks and new SOPs | Different urgency colors displayed |
| Refresh suggestions | Tap refresh button | New suggestions generated (cache cleared) |
| Navigate from suggestion | Tap a suggestion linked to a task | Navigates to correct task/SOP |
| Empty state | New employee with no tasks/SOPs | Helpful empty state shown |

---

## 9. Ask MAinager (AI Copilot) — P0

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Open copilot | Tap the floating Ask MAinager button | Chat sheet opens |
| Ask procedure question | "How do I process a return?" | AI responds with relevant SOP info |
| Ask schedule question | "Who's working tomorrow?" | AI shows tomorrow's schedule |
| Ask priority question | "What should I do first?" | AI returns prioritized task list |
| Conversation history | Ask follow-up question | AI maintains context from prior messages |
| Timeout handling | If AI takes >5s | Fallback response shown, not an error |

---

## 10. Morning Whisper — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Generate whisper | Manager opens Morning Whisper | AI briefing loads with yesterday's summary |
| Mark as listened | Tap "Listened" button | Status updated, date recorded |
| History | View whisper history | Past briefings listed in reverse chronological order |
| Access control | Associate tries to access whisper | 403 — restricted to managers/owners |

---

## 11. Daily Rituals — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Morning Huddle | Manager opens huddle before shift | AI-generated agenda with wins, goals, lean principle |
| Daily Debrief | Employee submits end-of-day debrief | Responses saved and visible to manager |
| Kudos | Give a kudo to a teammate | Kudo appears on Kudos Wall |
| Midday Pulse | Check during midday window | Pulse check available |
| Daily Quote | Open dashboard | Improvement quote of the day shown |

---

## 12. Issue Tracker — P0

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Report issue | Employee submits issue with description and priority | Issue created and visible to managers |
| Update status | Manager changes issue from open to in-progress | Status updated with timestamp |
| Resolve issue | Manager marks issue as resolved | Issue moves to resolved, resolution recorded |
| Filter issues | Filter by priority and status | Correct results shown |

---

## 13. Kudos Wall — P2

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Give kudo | Select teammate, write message, submit | Kudo posted to wall |
| View wall | Open Kudos Wall | All recent kudos displayed |

---

## 14. Improvement Video Platform — P2

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Upload video | Record/upload a 60-second improvement video | Video saved and playable |
| View feed | Open improvement feed | Videos listed with titles and authors |
| Like video | Tap like on a video | Like count increments |

---

## 15. Lean Board — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| View board | Open Lean Board as manager | Current week's metrics displayed |
| Period toggle | Switch between Today, Week, Month | Metrics update for selected period |
| Trend charts | View metric trends | Mini charts show directional trends |
| Weekly summary | View AI-generated weekly summary | Summary text present and relevant |

---

## 16. In-App Messaging — P0

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Send direct message | Open DM with teammate, type and send | Message delivered instantly |
| Create group chat | Create group with 3 members | All members can see and send messages |
| Threaded replies | Reply to a specific message | Reply appears in thread |
| Real-time delivery | Send message while recipient has app open | Message appears without refresh |

---

## 17. AI Background Insights — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| View insights | Open manager dashboard | Insight cards shown with severity badges |
| Acknowledge insight | Click acknowledge on an insight | Status changes, removed from active list |
| Insight types | Verify different insight categories display | Scheduling, time clock, and task insights all appear |

---

## 18. RAG-Powered SOP Search — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Natural language search | Search "how to handle gift card" | Relevant SOP results returned |
| No results | Search for nonsense term | Empty state shown, not an error |
| Result navigation | Click a search result | Navigates to correct SOP |

---

## 19. Role-Based Dashboards — P0

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Associate view | Log in as associate | Personal dashboard with tasks, schedule, stats |
| Manager view | Log in as manager | Team overview with rituals, issues, operations |
| Owner view | Log in as owner | Business health with sales, labor, insights |
| Role switching | Change user's role | Dashboard changes to match new role |

---

## 20. Geofencing — P0

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Create geofence | Define store boundary on map | Boundary saved and visible |
| Boundary types | Create circular and polygon fences | Both types function correctly |
| Grace period | Clock in just outside boundary with grace period set | Clock-in allowed within grace distance |

---

## 21. Payroll Management — P0

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Calculate pay | Run payroll for a completed pay period | Hours and pay calculated correctly |
| Overtime | Employee with >40 hours in week | Overtime hours calculated at 1.5x |
| Holiday pay | Clock hours on configured holiday | Holiday multiplier applied automatically |
| Contractor vs W-2 | Verify both classification types | Different rules applied correctly |

---

## 22. Shopify Integration — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Connect store | Enter Shopify credentials and connect | Sales data begins syncing |
| Sales snapshot | View owner dashboard | Recent sales figures displayed |
| Schedule optimization | Generate schedule after sync | AI references sales patterns in staffing |

---

## 23. Weekly Review Ritual — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Start review | Open weekly review on Friday | AI-generated content loads |
| Update status | Mark review as in-progress, then completed | Status transitions saved |
| History | View past reviews | Previous weeks' reviews listed |

---

## 24. PWA & Offline Support — P0

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Install PWA | Add to home screen on mobile | App icon appears, opens full-screen |
| Offline access | Turn off WiFi, open app | Cached pages load, offline indicator shown |
| Data sync | Make changes offline, reconnect | Changes sync to server automatically |
| Push notifications | Trigger a notification event | Notification appears on device |

---

## 25. Employee Onboarding — P1

| Test | Steps | Expected Result |
|------|-------|-----------------|
| Add new hire | Create new employee account | Onboarding SOPs auto-assigned |
| Training progress | New hire completes training SOPs | Progress tracked in Training Hub |
| Manager visibility | Manager checks new hire's training status | Completion percentage visible |

---

## Test Execution Plan

### Phase 1: Core Operations (Week 1)
Focus on P0 features that every user touches daily:
- Time Clock (#1)
- Task Management (#6)
- Issue Tracker (#12)
- Dashboards (#19)
- Messaging (#16)
- Geofencing (#20)
- Payroll (#21)

### Phase 2: AI & Intelligence (Week 2)
Focus on AI-powered features:
- Ask MAinager (#9)
- AI Scheduling (#2)
- Smart Suggestions (#8)
- Background Insights (#17)
- Morning Whisper (#10)

### Phase 3: Operations & Culture (Week 3)
Focus on SOP and team culture features:
- SOP Library (#3)
- SOP Intelligence (#4)
- Decision Trees (#5)
- GTD Engine (#7)
- Daily Rituals (#11)
- Lean Board (#15)
- RAG Search (#18)

### Phase 4: Polish & Edge Cases (Week 4)
- PWA & Offline (#24)
- Onboarding (#25)
- Kudos Wall (#13)
- Improvement Videos (#14)
- Shopify Integration (#22)
- Weekly Review (#23)
- Cross-browser testing (Chrome, Safari, Firefox)
- Mobile device testing (iOS Safari, Android Chrome)
- Load testing with 15 concurrent users

### Go/No-Go Criteria
- All P0 tests pass
- No data loss scenarios identified
- AI features gracefully handle timeouts
- Offline mode doesn't corrupt data on sync
- All role-based access controls enforced correctly
