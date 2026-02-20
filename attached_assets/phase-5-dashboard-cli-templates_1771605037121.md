# Sneebly Transform — Phase 5 of 5: Dashboard, CLI, Templates & Init

**What this does:** Wires everything together — adds build mode visibility to the dashboard, adds a --mode flag to the CLI, updates the identity file templates, and updates the init command to scaffold build-state.json.

**Prerequisites:** Phases 1-4 must be complete.

**Verify before starting:** The core build mode logic should be working. This phase is about making it visible and usable.

---

## PROMPT

This is the final phase. We're connecting the build mode (added in Phases 2-4) to the user-facing parts: dashboard, CLI, templates, and initialization.

### Part A: Dashboard — Build Mode Section

**File: `src/middleware/admin-dashboard.js` (or wherever the dashboard routes are defined)**

Read this file. Find where the API routes are registered (like `/sneebly/api/status`, `/sneebly/api/elon/run`, etc.).

Add two new API routes:

```javascript
// Build state endpoint
router.get('/sneebly/api/build-state', requireAuth, (req, res) => {
  try {
    const { loadBuildState, getElonMode } = require('../elon');
    const buildState = loadBuildState(config.dataDir);
    const mode = getElonMode(config);
    res.json({ mode, buildState: buildState || { currentPhase: 1, hasUnbuiltMilestones: false } });
  } catch (error) {
    res.json({ mode: 'unknown', buildState: null, error: error.message });
  }
});

// Mode override endpoint
router.post('/sneebly/api/elon/mode', requireAuth, (req, res) => {
  try {
    const { saveElonLog } = require('../elon');
    const { mode } = req.body;
    if (!['build', 'fix', 'auto'].includes(mode)) {
      return res.status(400).json({ success: false, error: 'Mode must be: build, fix, or auto' });
    }
    saveElonLog(config.dataDir, { modeOverride: mode === 'auto' ? null : mode });
    // Log this as an owner action using whatever logging the dashboard already uses
    res.json({ success: true, mode });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

**IMPORTANT:** Check how `requireAuth` works in this file and use the same pattern. Check how `config.dataDir` is accessed and use the same pattern. Don't guess — read the existing routes and copy their style.

**File: `src/dashboard/index.html` (or wherever the dashboard HTML lives)**

Find the ELON section in the dashboard HTML. Add a Build Mode panel near it. Look at how existing sections are styled (they probably use a class like `section`, `card`, or `panel`) and match it:

```html
<!-- Build Mode Status Panel -->
<div class="section" id="build-mode-section">
  <h2>🔨 Build Mode</h2>
  <div style="display: flex; gap: 12px; align-items: center; margin-bottom: 12px;">
    <span>Current Mode:</span>
    <span id="elon-mode-badge" style="padding: 4px 12px; border-radius: 4px; font-weight: bold; color: white; background: #666;">...</span>
  </div>
  <div style="margin-bottom: 8px;">
    <span>Phase:</span> <strong id="build-phase-display">—</strong>
  </div>
  <div style="margin-bottom: 8px;">
    <span>Current Milestone:</span> <span id="build-milestone-display">—</span>
  </div>
  <div style="margin-bottom: 8px;">
    <span>Constraint:</span> <span id="build-constraint-display">—</span>
  </div>
  <div style="margin-top: 12px; display: flex; gap: 8px;">
    <button onclick="setElonMode('build')">Force Build</button>
    <button onclick="setElonMode('fix')">Force Fix</button>
    <button onclick="setElonMode('auto')" style="font-weight: bold;">Auto Mode</button>
  </div>
</div>
```

Add the JavaScript (find where the existing dashboard JS loads data and add to it):

```javascript
async function loadBuildState() {
  try {
    const res = await fetch('/sneebly/api/build-state?key=' + getKey());
    const data = await res.json();

    const badge = document.getElementById('elon-mode-badge');
    if (badge) {
      badge.textContent = (data.mode || 'auto').toUpperCase();
      badge.style.background = data.mode === 'build' ? '#2563eb' : data.mode === 'fix' ? '#dc2626' : '#16a34a';
    }

    const phase = document.getElementById('build-phase-display');
    if (phase) phase.textContent = data.buildState?.currentPhase ? 'Phase ' + data.buildState.currentPhase : '—';

    const milestone = document.getElementById('build-milestone-display');
    if (milestone) milestone.textContent = data.buildState?.currentMilestone || '—';

    const constraint = document.getElementById('build-constraint-display');
    if (constraint) constraint.textContent = data.buildState?.currentConstraint || '—';
  } catch (e) {
    console.error('Failed to load build state:', e);
  }
}

async function setElonMode(mode) {
  try {
    await fetch('/sneebly/api/elon/mode?key=' + getKey(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode })
    });
    await loadBuildState();
  } catch (e) {
    console.error('Failed to set mode:', e);
  }
}

// Call loadBuildState() in the existing page load / refresh cycle
// Find where other load functions are called and add loadBuildState() there
```

Check how the dashboard gets the auth key (it might use a URL param, a variable called `KEY`, or a function called `getKey()`). Use the same approach.

### Part B: CLI — Add --mode Flag

**File: `bin/elon.js` (or wherever the `npx sneebly-elon` command is defined)**

Read this file. Find where it parses arguments and sets up the ELON config.

Add mode flag parsing:

```javascript
// Add near the top where other args are parsed:
const modeArg = process.argv.find(a => a.startsWith('--mode='));
const forcedMode = modeArg ? modeArg.split('=')[1] : null;

if (forcedMode && ['build', 'fix', 'auto'].includes(forcedMode)) {
  const { saveElonLog } = require('../src/elon');
  const dataDir = path.join(projectRoot, '.sneebly');
  saveElonLog(dataDir, { modeOverride: forcedMode === 'auto' ? null : forcedMode });
  console.log(`ELON mode set to: ${forcedMode}`);
}
```

This lets users run:
- `npx sneebly-elon` — auto mode
- `npx sneebly-elon --mode=build` — force build
- `npx sneebly-elon --mode=fix` — force fix

Also update the console output to show the current mode when ELON starts:

```javascript
// Find where it logs "ELON cycle starting" or similar, add:
const { getElonMode } = require('../src/elon');
console.log(`ELON mode: ${getElonMode(config)}`);
```

### Part C: Update Identity Templates

**File: `templates/SOUL-template.md`**

If you haven't already updated this in Phase 1, add these two sections after the existing "Core Truths" section:

```markdown
## Build Mode Truths

- When building, your job is to get working code in place. Not perfect code. Working code.
- You follow the roadmap. Build Phase 1 before Phase 2. Don't skip ahead.
- You create files from scratch when needed. You're not just an editor — you're a builder.
- After building, you EXPECT bugs. That's what fix mode is for.
- You read the spec carefully. Build what it says, not what you think it should say.
- When the spec is ambiguous, build the simplest version and log what needs clarification.

## Fix Mode Truths

- When fixing, your job is surgical precision. Find the bug, fix the bug, verify the fix.
- You refactor messy build-mode code into clean, maintainable patterns.
- You add error handling that build mode skipped.
- You add input validation that build mode skipped.
- When the error rate hits zero and tests pass, it's time to build again.
```

**File: `templates/AGENTS-template.md`**

Add after the "Safe to Auto-Modify" section:

```markdown
## Safe to Create New Files In
<!-- Build mode can scaffold new files in these directories -->
- server/routes/
- server/services/
- server/utils/
- client/src/pages/
- client/src/components/
- client/src/hooks/
- client/src/lib/
- shared/

## Build Mode Rules
1. When creating new files, follow the existing project structure exactly.
2. New routes must be registered in the main routes file.
3. New schema tables must use the same ORM patterns as existing tables.
4. New pages must use the existing routing setup.
5. Import paths must match the project's alias configuration.
6. Always check what already exists before creating.
7. Generated code must be COMPLETE — no placeholders or TODOs.
```

**File: `templates/GOALS-template.md`**

Add these sections after the Architecture Context. These are the build mode control fields and the spec section:

```markdown
## Current Mode

<!-- Sneebly checks this to know if it's building or fixing -->
<!-- Values: build | fix | auto (auto is recommended) -->
**mode: auto**

## Current Phase

<!-- Which roadmap phase is active? -->
**phase: 1**

---

## App Specification

<!-- Full spec of what Sneebly should build. -->
<!-- Be specific: data models with all fields, endpoints with methods, pages with routes. -->

### Data Models

<!-- List every table with every field, type, and constraint -->

### API Endpoints

<!-- List every endpoint with method, path, auth, and behavior -->

### Pages / UI

<!-- List every page with route, purpose, and components -->

### Key Behaviors

<!-- Describe business logic, workflows, calculations, and rules -->
```

Also update the Roadmap section to use checkboxes:

```markdown
## Roadmap

### Phase 1: Foundation
- [ ] First milestone
- [ ] Second milestone

### Phase 2: Core Features
- [ ] First milestone
- [ ] Second milestone
```

### Part D: Update Init Command

**File: `bin/sneebly.js` (the init command handler)**

Read this file. Find where the `init` command creates the `.sneebly/` directory structure.

Add `build-state.json` to the initialization:

```javascript
// Find where it creates other .sneebly/ files (like elon-log.json, elon-settings.json)
// Add:
const buildStatePath = path.join(dataDir, 'build-state.json');
if (!fs.existsSync(buildStatePath)) {
  fs.writeFileSync(buildStatePath, JSON.stringify({
    currentPhase: 1,
    hasUnbuiltMilestones: true,
    completed: [],
    failed: [],
    lastUpdated: null
  }, null, 2));
}
```

Also make sure the `elon-builder.md` template is listed in whatever template-copy logic the init command uses. If it copies subagent templates from `templates/subagents/` to the project, the new `elon-builder.md` should be included.

### Part E: Update package.json Version

**File: `package.json`**

Update the version to `0.4.0` to mark the build mode release:

```json
"version": "0.4.0"
```

### Verification — Full System Test

After completing all parts, do this end-to-end test:

1. **Run the app** — verify it starts without errors
2. **Open the dashboard** — verify the "Build Mode" section appears with mode badge
3. **Click "Force Build"** — verify the mode badge changes to "BUILD" (blue)
4. **Click "Auto Mode"** — verify it switches back
5. **Run `npx sneebly-elon --mode=build`** — verify it prints "ELON mode: build"
6. **Run `npx sneebly init` in a test directory** — verify:
   - All template files are created with "Sneebly" branding (not AppPilot)
   - GOALS-template.md has the App Specification and Roadmap sections
   - AGENTS-template.md has the "Safe to Create New Files In" section
   - SOUL-template.md has Build Mode Truths and Fix Mode Truths
   - `.sneebly/build-state.json` exists with initial state
   - `templates/subagents/elon-builder.md` exists
7. **Run `npm test`** — verify no regressions
8. **Final grep check:**
   ```bash
   grep -ri "apppilot\|AppPilot\|app.pilot\|app_pilot" --include="*.js" --include="*.md" --include="*.json" --include="*.html" . | grep -v node_modules | grep -v .git
   ```
   This should return ZERO results.

Tell me when this phase is complete and show me the dashboard screenshot and grep results.

---

## 🎉 Transformation Complete

After all 5 phases, Sneebly can:

1. **Build** features from a spec in GOALS.md (create new files, scaffold code)
2. **Fix** bugs found by crawling (the original behavior)
3. **Oscillate** automatically between build and fix modes
4. **Track progress** through phased milestones
5. **Show status** in the dashboard with mode controls
6. **Be forced** into build or fix mode via dashboard or CLI

The build/fix cycle:
```
Build Phase 1 features → Fix & refactor → Build Phase 2 features → Fix & refactor → ...
```
