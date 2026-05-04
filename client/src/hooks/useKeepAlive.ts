import { useEffect } from "react";

const PING_INTERVAL_MS = 4 * 60 * 1000;

export function useKeepAlive() {
  useEffect(() => {
    const ping = () => {
      fetch("/api/health", { credentials: "include" }).catch(() => {});
    };

    ping();
    const id = setInterval(ping, PING_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}
