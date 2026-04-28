// Centralized structured debug logging used by the Edit Shift panel save
// flow (CreateShiftSplitPanel + ScheduleManagement + apiRequest trace hook).
// Toggleable via `window.__TAIME_DEBUG__ = false` to silence in noisy flows;
// defaults to ON so we capture data from the field by default.
//
// Each log line is a `console.debug` so production users can filter them out
// trivially via DevTools "Default" verbosity, while support sessions can
// switch to "Verbose" and immediately get a full trace.

export type DLogPayload =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | undefined;

export function isTaimeDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return (window as { __TAIME_DEBUG__?: boolean }).__TAIME_DEBUG__ !== false;
}

function tsNow(): string {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
}

export function makeDlog(namespace: string) {
  return (action: string, payload?: DLogPayload) => {
    try {
      if (!isTaimeDebugEnabled()) return;
      const ts = tsNow();
      if (payload === undefined) {
        // eslint-disable-next-line no-console
        console.debug(`[${namespace} ${ts}] ${action}`);
      } else {
        // eslint-disable-next-line no-console
        console.debug(`[${namespace} ${ts}] ${action}`, payload);
      }
    } catch {
      // Never let logging crash the UI.
    }
  };
}
