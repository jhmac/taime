// Reads the Capacitor global bridge without a static import of @capacitor/core.
//
// Why: statically importing @capacitor/core in any module that sits in the
// non-lazy bundle path (main.tsx, App.tsx, hooks called from App.tsx) changes
// Vite's vendor-chunk graph and creates a circular dependency between
// vendor-react and vendor-clerk, producing a TDZ ReferenceError that freezes
// the app on load.
//
// The Capacitor runtime injects window.Capacitor before any app JS executes
// when running inside a native WebView, so these helpers are safe and accurate
// in all environments.

interface CapacitorGlobal {
  isNativePlatform(): boolean;
  getPlatform(): string;
}

declare global {
  interface Window {
    Capacitor?: CapacitorGlobal;
  }
}

export function isNativePlatform(): boolean {
  return window.Capacitor?.isNativePlatform() ?? false;
}

export function getPlatform(): string {
  return window.Capacitor?.getPlatform() ?? 'web';
}
