// Task #391 B6 — Pure helpers for multi-select inside CreateShiftSplitPanel.
//
// We never instantiate the panel here — these tests are deliberately tiny so
// the click-→-mode and selection-set transitions can be reasoned about in
// isolation. UI integration is covered separately at the panel level.

import { describe, it, expect } from "vitest";
import {
  modeFromEvent,
  nextMultiSelection,
  type MultiSelectMode,
} from "../client/src/lib/createShiftHelpers";

describe("modeFromEvent — click modifier → selection mode", () => {
  it("plain click → 'single'", () => {
    expect(modeFromEvent({ shiftKey: false, metaKey: false, ctrlKey: false })).toBe<MultiSelectMode>("single");
  });
  it("Cmd-click (mac) → 'toggle'", () => {
    expect(modeFromEvent({ shiftKey: false, metaKey: true, ctrlKey: false })).toBe<MultiSelectMode>("toggle");
  });
  it("Ctrl-click (win) → 'toggle'", () => {
    expect(modeFromEvent({ shiftKey: false, metaKey: false, ctrlKey: true })).toBe<MultiSelectMode>("toggle");
  });
  it("Shift-click → 'range'", () => {
    expect(modeFromEvent({ shiftKey: true, metaKey: false, ctrlKey: false })).toBe<MultiSelectMode>("range");
  });
  it("Shift dominates over Cmd when both are held (range wins)", () => {
    expect(modeFromEvent({ shiftKey: true, metaKey: true, ctrlKey: false })).toBe<MultiSelectMode>("range");
  });
});

describe("nextMultiSelection — toggle mode", () => {
  const order = ["a", "b", "c", "d"];

  it("adds id when missing", () => {
    const out = nextMultiSelection(new Set(), order, null, "b", "toggle");
    expect(Array.from(out).sort()).toEqual(["b"]);
  });

  it("removes id when already present", () => {
    const out = nextMultiSelection(new Set(["a", "b"]), order, "a", "b", "toggle");
    expect(Array.from(out).sort()).toEqual(["a"]);
  });

  it("preserves the rest of the selection", () => {
    const out = nextMultiSelection(new Set(["a", "c"]), order, "c", "b", "toggle");
    expect(Array.from(out).sort()).toEqual(["a", "b", "c"]);
  });

  it("does not require an anchor to toggle", () => {
    const out = nextMultiSelection(new Set(["a"]), order, null, "d", "toggle");
    expect(Array.from(out).sort()).toEqual(["a", "d"]);
  });
});

describe("nextMultiSelection — single mode", () => {
  it("clears any existing multi-selection (caller handles single-focus)", () => {
    const out = nextMultiSelection(new Set(["a", "b", "c"]), ["a", "b", "c"], "a", "b", "single");
    expect(out.size).toBe(0);
  });

  it("clears even when nothing was selected", () => {
    const out = nextMultiSelection(new Set(), ["a"], null, "a", "single");
    expect(out.size).toBe(0);
  });
});

describe("nextMultiSelection — range mode (shift-click)", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("selects inclusive forward range from anchor → target", () => {
    const out = nextMultiSelection(new Set(["a"]), order, "a", "d", "range");
    expect(Array.from(out).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("selects inclusive backward range when target is before anchor", () => {
    const out = nextMultiSelection(new Set(["d"]), order, "d", "b", "range");
    expect(Array.from(out).sort()).toEqual(["b", "c", "d"]);
  });

  it("merges range additively with previously-selected items outside the slice", () => {
    const out = nextMultiSelection(new Set(["a", "e"]), order, "b", "d", "range");
    // existing a + e preserved, b..d added
    expect(Array.from(out).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("with no anchor, falls back to single-add (avoids no-op on first click)", () => {
    const out = nextMultiSelection(new Set(["a"]), order, null, "c", "range");
    expect(Array.from(out).sort()).toEqual(["a", "c"]);
  });

  it("when anchor is no longer in the list (deleted), falls back to single-add of target", () => {
    // 'x' was the anchor but is no longer in orderedIds — defensive fallback.
    const out = nextMultiSelection(new Set(["a"]), order, "x", "c", "range");
    expect(Array.from(out).sort()).toEqual(["a", "c"]);
  });

  it("when target is not in the list, falls back to single-add of target (also defensive)", () => {
    // Target 'z' not in orderedIds — we still record it so the caller can
    // handle the next render once orderedIds includes it.
    const out = nextMultiSelection(new Set(["a"]), order, "a", "z", "range");
    expect(Array.from(out).sort()).toEqual(["a", "z"]);
  });

  it("range of size 1 (anchor === target) is just the single id", () => {
    const out = nextMultiSelection(new Set(), order, "c", "c", "range");
    expect(Array.from(out).sort()).toEqual(["c"]);
  });
});
