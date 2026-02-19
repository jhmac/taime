const REPORT_ENDPOINT = '/api/client-errors';
const BATCH_INTERVAL = 5000;
const MAX_QUEUE_SIZE = 50;

interface ClientError {
  error: string;
  componentStack?: string;
  action?: string;
  url: string;
  timestamp: string;
  userAgent: string;
  extra?: Record<string, any>;
}

let errorQueue: ClientError[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function flushQueue() {
  if (errorQueue.length === 0) return;
  const batch = errorQueue.splice(0, MAX_QUEUE_SIZE);

  for (const entry of batch) {
    try {
      fetch(REPORT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        credentials: 'include',
      }).catch(() => {});
    } catch {}
  }
}

function scheduleBatch() {
  if (batchTimer) return;
  batchTimer = setTimeout(() => {
    batchTimer = null;
    flushQueue();
  }, BATCH_INTERVAL);
}

export function reportError(error: Error | string, context?: { action?: string; extra?: Record<string, any>; componentStack?: string }) {
  const entry: ClientError = {
    error: typeof error === 'string' ? error : error.message,
    componentStack: context?.componentStack,
    action: context?.action,
    url: window.location.pathname,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    extra: context?.extra,
  };

  if (typeof error !== 'string' && error.stack) {
    entry.extra = { ...entry.extra, stack: error.stack.slice(0, 2000) };
  }

  errorQueue.push(entry);
  if (errorQueue.length >= 10) {
    flushQueue();
  } else {
    scheduleBatch();
  }
}

export function reportFailedAction(action: string, error: Error | string, extra?: Record<string, any>) {
  reportError(error, { action, extra });
}

export function reportApiError(method: string, url: string, statusCode: number, responseBody?: any) {
  const cleanUrl = url.split('?')[0];
  const message = responseBody?.message || responseBody?.error || `HTTP ${statusCode}`;
  reportError(typeof message === 'string' ? message.slice(0, 300) : `HTTP ${statusCode}`, {
    action: `API call: ${method} ${cleanUrl}`,
    extra: { statusCode, method, url: cleanUrl },
  });
}

export function initGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    if (event.error) {
      reportError(event.error, { action: 'Unhandled error' });
    } else if (event.message) {
      reportError(event.message, { action: 'Unhandled error', extra: { filename: event.filename, lineno: event.lineno, colno: event.colno } });
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      reportError(reason, { action: 'Unhandled promise rejection' });
    } else {
      reportError(String(reason || 'Unknown promise rejection'), { action: 'Unhandled promise rejection' });
    }
  });
}
