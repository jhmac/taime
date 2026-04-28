import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { reportApiError } from "./errorReporter";
import { makeDlog } from "./dlog";

// Dev-only request/response trace, gated by window.__TAIME_DEBUG__.
// Used by callers passing `{ trace: true }` to apiRequest so a single
// console session captures the full save flow (state → payload → HTTP →
// response) without needing the Network tab. See
// docs/edit-shift-bug-trace-guide.md.
const apiDlog = makeDlog("Taime/API");

// Default client-side timeout for every network request (ms).
// Keeps the app responsive on slow mobile connections.
export const REQUEST_TIMEOUT_MS = 15_000;

declare global {
  interface Window {
    Clerk?: {
      session?: {
        getToken: () => Promise<string | null>;
      };
    };
  }
}

interface CachedToken {
  token: string;
  exp: number; // Unix seconds
}
let _cachedToken: CachedToken | null = null;

export function clearTokenCache(): void {
  _cachedToken = null;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    if (typeof window !== 'undefined' && window.Clerk) {
      const nowSecs = Date.now() / 1000;
      if (_cachedToken && _cachedToken.exp > nowSecs + 60) {
        return { Authorization: `Bearer ${_cachedToken.token}` };
      }
      const token = await window.Clerk.session?.getToken();
      if (token) {
        // JWTs use base64url — normalize to base64 before decoding exp
        try {
          const b64url = token.split('.')[1];
          const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
          const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
          const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
          if (typeof payload.exp === 'number') {
            _cachedToken = { token, exp: payload.exp };
          }
        } catch {
          // decoding failed — use token without caching
        }
        return { Authorization: `Bearer ${token}` };
      }
    }
  } catch {}
  return {};
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown,
  options?: { signal?: AbortSignal; timeoutMs?: number; trace?: boolean },
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const headers: Record<string, string> = { ...authHeaders };
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  // If the caller didn't supply an AbortSignal, create a timeout-based one
  // so requests never hang indefinitely on slow connections.
  const callerSignal = options?.signal;
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);

  // Combine caller signal + timeout signal
  const signal = callerSignal
    ? AbortSignal.any
      ? AbortSignal.any([callerSignal, timeoutController.signal])
      : timeoutController.signal
    : timeoutController.signal;

  // Trace request — only when caller opts in via `{ trace: true }` AND the
  // global debug flag is on (handled inside apiDlog). Keeps high-traffic
  // calls (queries, polling) silent while still letting the Edit Shift save
  // path stream a complete request log to the console.
  const trace = options?.trace === true;
  const traceStartedAt = trace ? performance.now() : 0;
  if (trace) {
    apiDlog("request", { method, url, body: data ?? null });
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    if (trace) {
      apiDlog("response/error", {
        method, url, status: res.status,
        durationMs: Math.round(performance.now() - traceStartedAt),
        body: parsed,
      });
    }
    reportApiError(method, url, res.status, parsed);
    throw new Error(`${res.status}: ${text}`);
  }

  if (trace) {
    // Clone so callers can still consume the body via `.json()` / `.text()`.
    try {
      const cloneText = await res.clone().text();
      let parsedClone: unknown = cloneText;
      try { parsedClone = JSON.parse(cloneText); } catch { /* keep raw text */ }
      apiDlog("response/ok", {
        method, url, status: res.status,
        durationMs: Math.round(performance.now() - traceStartedAt),
        body: parsedClone,
      });
    } catch {
      // Cloning/reading failed — log status only so the trace still shows
      // the request completed.
      apiDlog("response/ok", {
        method, url, status: res.status,
        durationMs: Math.round(performance.now() - traceStartedAt),
        body: "<unavailable>",
      });
    }
  }

  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal: querySignal }) => {
    const authHeaders = await getAuthHeaders();
    const url = queryKey.join("/") as string;

    // Apply a client-side timeout so queries never hang indefinitely.
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(new DOMException('Request timed out', 'TimeoutError')),
      REQUEST_TIMEOUT_MS,
    );
    const signal = querySignal && AbortSignal.any
      ? AbortSignal.any([querySignal, timeoutController.signal])
      : timeoutController.signal;

    let res: Response;
    try {
      res = await fetch(url, {
        credentials: "include",
        headers: { ...authHeaders },
        signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    if (!res.ok) {
      const text = (await res.text()) || res.statusText;
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      reportApiError('GET', url.split('?')[0], res.status, parsed);
      throw new Error(`${res.status}: ${text}`);
    }
    return await res.json();
  };

export function invalidatePrefix(prefix: string) {
  queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey[0];
      return typeof key === 'string' && key.startsWith(prefix);
    },
  });
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
