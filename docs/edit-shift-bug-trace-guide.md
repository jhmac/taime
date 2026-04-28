# Edit Shift Save Bug — How to Capture a Full Trace

We've shipped several fixes to the Edit Shift panel without the bug going
away. To stop guessing, we need to see exactly what the panel does when
you save: which handler runs, what payload it sends, what the server
returns, and whether the schedule timeline refetches the new shifts.

Following these steps once will produce a single console log we can read
end-to-end.

---

## Before you start

You need a desktop browser (Chrome, Edge, or Brave) with DevTools.
Mobile browsers won't work for capture.

---

## 1. Open the app and the console

1. Open the app in **Chrome / Edge / Brave**.
2. Press **F12** (or right-click → **Inspect**) to open DevTools.
3. Click the **Console** tab.
4. In the console toolbar:
   - Click the **funnel / filter icon** and type `Taime` in the filter box.
     This hides everything except our trace lines.
   - Open the **gear icon** (settings) and turn ON **"Preserve log"**. This
     is critical — without it the log clears when the panel closes.
   - Set the level dropdown to **"Default"** plus **"Verbose"** (some
     browsers need Verbose enabled separately for `console.debug`).

You should see the console mostly empty with the `Taime` filter applied.

---

## 2. Reproduce the bug

Do the exact thing that breaks today:

1. Navigate to **Schedules**.
2. Click the day that's broken.
3. In the Edit Shift panel:
   - Click the existing shift card to edit it (or click **+ Add shift** to
     add a new one — whichever step normally fails).
   - Make your change (move the time, swap the employee, add a shift,
     etc.).
   - Click **Save**.
4. Wait for the toast to appear (`Shift updated` or `Schedule Approved`).
5. **Without closing DevTools**, close the panel.
6. Re-open the same day's panel — confirm the shifts you just saved are
   missing or wrong (this is the bug).

---

## 3. Save the console log

1. Right-click anywhere in the console output.
2. Choose **"Save as…"** and save the file (any name; `.log` is fine).
3. Send us that file.

If "Save as…" isn't available, instead:

1. Click in the console output area, press **Ctrl+A** (Cmd+A on Mac) to
   select all, then **Ctrl+C** to copy.
2. Paste into a plain-text file or directly into the chat.

---

## What we're looking for

Each line is prefixed with `[Taime/...]` and a timestamp. With the filter
on you should see, in order, something like:

```
[Taime/Schedule HH:MM:SS.mmm] form/onSubmit { handler: "handleSubmit", ... }
[Taime/Schedule HH:MM:SS.mmm] handleSubmit { branch: "editingSchedule", ... }
[Taime/Schedule HH:MM:SS.mmm] handleEditingScheduleSave { ... }
[Taime/Schedule HH:MM:SS.mmm] handleEditingScheduleSave/onUpdateSchedule(...) { ... }
[Taime/API HH:MM:SS.mmm]      request   { method: "PATCH", url: "/api/schedules/...", body: {...} }
[Taime/API HH:MM:SS.mmm]      response/ok { status: 200, body: {...} }
[Taime/Schedule HH:MM:SS.mmm] updateScheduleMutation/success { ... }
[Taime/Schedule HH:MM:SS.mmm] updateScheduleMutation/cacheAfterSetQueryData { ... }
[Taime/Schedule HH:MM:SS.mmm] invalidateScheduleSurfaces { keys: [...] }
[Taime/Schedule HH:MM:SS.mmm] updateScheduleMutation/cacheAfterInvalidate { ... }
```

If a line is missing, that itself tells us which step failed silently.
Don't try to interpret it yourself — just send us the full output.

---

## Troubleshooting

- **"I don't see any `Taime` lines."** Re-check the level filter (Verbose
  must be on) and that the filter text is exactly `Taime` (no quotes).
- **"The console clears as soon as I save."** Preserve log is off — flip
  it on under the gear icon.
- **"DevTools is too small to read."** Pop it out into its own window
  (three-dot menu → Dock side → unfloat).

That's it. One reproduction with this trace gives us everything we need
to land the right fix on the next pass.
