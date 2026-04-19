import { useEffect, useRef } from "react";

/**
 * Automatically calls `refetch` whenever the browser's `online` event fires,
 * indicating the network has come back after being offline.
 *
 * Pass `enabled = false` when the component is not in an error state to avoid
 * triggering unnecessary refetches.
 */
export function useOnlineRetry(refetch: () => void, enabled = true): void {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  useEffect(() => {
    if (!enabled) return;
    const handler = () => refetchRef.current();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [enabled]);
}
