import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { reportApiError } from "./errorReporter";

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
  options?: { signal?: AbortSignal; timeoutMs?: number },
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
    reportApiError(method, url, res.status, parsed);
    throw new Error(`${res.status}: ${text}`);
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
