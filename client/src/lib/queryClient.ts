import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { reportApiError } from "./errorReporter";

// ── Clerk JWT cache ──────────────────────────────────────────────────────────
// Clerk caches tokens internally, but calling getToken() is still an async
// Promise resolution that adds overhead when the app fires many parallel
// requests at once. We cache the raw JWT here and skip the Clerk call until
// the token is within 60 seconds of expiry.
interface CachedToken {
  token: string;
  exp: number; // Unix seconds
}
let _cachedToken: CachedToken | null = null;

/** Call this whenever a Clerk session-ended event fires. */
export function clearTokenCache(): void {
  _cachedToken = null;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    if (typeof window !== 'undefined' && (window as any).Clerk) {
      const nowSecs = Date.now() / 1000;
      // Use cached token if it still has more than 60 seconds of life left
      if (_cachedToken && _cachedToken.exp > nowSecs + 60) {
        return { Authorization: `Bearer ${_cachedToken.token}` };
      }
      const token = await (window as any).Clerk.session?.getToken();
      if (token) {
        // Decode the exp claim from the JWT payload.
        // JWTs use base64url (URL-safe alphabet, no padding), so we must
        // substitute `-`→`+` and `_`→`/` then add `=` padding before atob.
        try {
          const b64url = token.split('.')[1];
          const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
          const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
          const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
          if (typeof payload.exp === 'number') {
            _cachedToken = { token, exp: payload.exp };
          }
        } catch {
          // If decoding fails, use the token for this request without caching
        }
        return { Authorization: `Bearer ${token}` };
      }
    }
  } catch {}
  return {};
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const headers: Record<string, string> = { ...authHeaders };
  if (data) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(url, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    signal: options?.signal,
  });

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
  async ({ queryKey }) => {
    const authHeaders = await getAuthHeaders();
    const url = queryKey.join("/") as string;
    const res = await fetch(url, {
      credentials: "include",
      headers: { ...authHeaders },
    });

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
