import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { useToast } from './use-toast';

export type ConnectionStatus = "connected" | "connecting" | "disconnected";

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

const INITIAL_RETRY_DELAY = 1_000;
const MAX_RETRY_DELAY = 30_000;
const BACKOFF_MULTIPLIER = 2;
const MAX_JITTER_MS = 500;

function getJitter(): number {
  return Math.floor(Math.random() * MAX_JITTER_MS);
}

export function useWebSocket() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelayRef = useRef(INITIAL_RETRY_DELAY);
  const intentionalCloseRef = useRef(false);
  const serverRestartingRef = useRef(false);
  const mountedRef = useRef(true);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current !== null) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (intentionalCloseRef.current || !mountedRef.current) return;

    clearReconnectTimeout();
    const delay = retryDelayRef.current + getJitter();

    if (!serverRestartingRef.current) {
      console.info(`[ws] reconnecting in ${delay}ms (base: ${retryDelayRef.current}ms)`);
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      if (mountedRef.current) {
        retryDelayRef.current = Math.min(retryDelayRef.current * BACKOFF_MULTIPLIER, MAX_RETRY_DELAY);
        connectWs();
      }
    }, delay);
  }, []);

  const connectWs = useCallback(() => {
    if (!user?.id || !mountedRef.current) return;

    if (wsRef.current) {
      const readyState = wsRef.current.readyState;
      if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
        return;
      }
    }

    setStatus("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws?userId=${user.id}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) { ws.close(); return; }
        console.info("[ws] connected");
        setStatus("connected");
        retryDelayRef.current = INITIAL_RETRY_DELAY;

        if (serverRestartingRef.current) {
          serverRestartingRef.current = false;
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const message = JSON.parse(event.data as string) as WebSocketMessage;

          if (message.type === "server_restarting") {
            serverRestartingRef.current = true;
            toast({
              title: "Reconnecting...",
              description: "Server is restarting. You'll be reconnected automatically.",
              duration: 4000,
            });
            return;
          }

          setLastMessage(message);
        } catch {
          console.error("[ws] failed to parse message");
        }
      };

      ws.onclose = (event: CloseEvent) => {
        if (!mountedRef.current) return;
        console.info(`[ws] disconnected (code: ${event.code})`);
        wsRef.current = null;
        setStatus("disconnected");

        if (!intentionalCloseRef.current) {
          scheduleReconnect();
        }
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        setStatus("disconnected");
      };
    } catch {
      console.error("[ws] failed to create connection");
      setStatus("disconnected");
      scheduleReconnect();
    }
  }, [user?.id, scheduleReconnect, toast]);

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;
    clearReconnectTimeout();
    if (wsRef.current) {
      wsRef.current.close(1000, 'Client disconnect');
      wsRef.current = null;
    }
    setStatus("disconnected");
  }, [clearReconnectTimeout]);

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn("[ws] cannot send, not connected");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    intentionalCloseRef.current = false;

    if (user?.id) {
      connectWs();
    }

    return () => {
      mountedRef.current = false;
      disconnect();
    };
  }, [user?.id]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && user?.id && !intentionalCloseRef.current) {
        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          console.info("[ws] app returned to foreground, reconnecting");
          retryDelayRef.current = INITIAL_RETRY_DELAY;
          connectWs();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [user?.id, connectWs]);

  return {
    isConnected: status === "connected",
    status,
    lastMessage,
    sendMessage,
    connect: connectWs,
    disconnect,
  };
}
