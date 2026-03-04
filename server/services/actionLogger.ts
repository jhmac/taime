import fs from 'fs';
import path from 'path';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

const DATA_DIR = path.join(process.cwd(), '.logs');
const ACTION_LOG_FILE = path.join(DATA_DIR, 'action-log.jsonl');
const ERROR_LOG_FILE = path.join(DATA_DIR, 'error-log.jsonl');
const MAX_LOG_SIZE = 5 * 1024 * 1024;

const ACTION_INTENT_MAP: Record<string, string> = {
  'POST /api/time-entries/clock-in': 'Clock in to shift',
  'POST /api/time-entries/clock-out': 'Clock out of shift',
  'GET /api/time-entries/active': 'Check active time entry',
  'GET /api/time-entries': 'View time entries',
  'POST /api/schedules': 'Create schedule',
  'GET /api/schedules': 'View schedules',
  'PUT /api/schedules': 'Update schedule',
  'DELETE /api/schedules': 'Delete schedule',
  'POST /api/tasks': 'Create task',
  'GET /api/tasks': 'View tasks',
  'PUT /api/tasks': 'Update task',
  'POST /api/users': 'Add team member',
  'GET /api/users': 'View team members',
  'POST /api/auth/sync': 'Sync user session',
  'GET /api/auth/user': 'Load user profile',
  'GET /api/auth/permissions': 'Load permissions',
  'POST /api/availability': 'Submit availability',
  'GET /api/availability': 'View availability',
  'POST /api/time-off-requests': 'Submit time-off request',
  'GET /api/time-off-requests': 'View time-off requests',
  'POST /api/messages': 'Send message',
  'GET /api/messages': 'View messages',
  'GET /api/payroll': 'View payroll',
  'POST /api/payroll': 'Process payroll',
  'GET /api/analytics': 'View analytics',
  'GET /api/company-settings': 'Load company settings',
  'PUT /api/company-settings': 'Update company settings',
  'GET /api/work-locations': 'View work locations',
  'POST /api/work-locations': 'Create work location',
  'GET /api/shopify/shops': 'View Shopify shops',
  'POST /api/chores': 'Create chore',
  'GET /api/chores': 'View chores',
  'GET /api/roles': 'View roles',
  'POST /api/roles': 'Create role',
  'POST /api/clock-events': 'Record clock event',
  'GET /api/clock-events': 'View clock events',
  'GET /api/sop': 'View SOPs',
  'POST /api/sop': 'Create SOP',
};

function getActionIntent(method: string, path: string): string {
  const exactKey = `${method} ${path}`;
  if (ACTION_INTENT_MAP[exactKey]) return ACTION_INTENT_MAP[exactKey];

  const basePath = path.replace(/\/[a-f0-9-]{36}/g, '/:id').replace(/\/\d+/g, '/:id');
  const baseKey = `${method} ${basePath}`;
  if (ACTION_INTENT_MAP[baseKey]) return ACTION_INTENT_MAP[baseKey];

  for (const [key, intent] of Object.entries(ACTION_INTENT_MAP)) {
    const [m, p] = key.split(' ');
    if (m === method && path.startsWith(p)) return intent;
  }

  return `${method} ${path}`;
}

function rotateLogIfNeeded(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_LOG_SIZE) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');
        const kept = lines.slice(Math.floor(lines.length / 2));
        fs.writeFileSync(filePath, kept.join('\n') + '\n');
      }
    }
  } catch {}
}

function appendLog(filePath: string, entry: any) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    rotateLogIfNeeded(filePath);
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n');
  } catch (err: any) {
    console.error('[ActionLogger] Failed to write log:', err.message);
  }
}

const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'apikey', 'api_key', 'authorization',
  'cookie', 'session', 'credential', 'access_token', 'refresh_token',
  'bearer', 'jwt', 'ssn', 'credit_card', 'card_number',
]);

function deepRedact(obj: any, depth = 0): any {
  if (depth > 5) return '[NESTED]';
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return obj.length > 500 ? obj.slice(0, 500) + '...' : obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.slice(0, 10).map(item => deepRedact(item, depth + 1));
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.has(key.toLowerCase()) || SENSITIVE_KEYS.has(lowerKey) ||
        lowerKey.includes('password') || lowerKey.includes('token') ||
        lowerKey.includes('secret') || lowerKey.includes('apikey') ||
        lowerKey.includes('authorization') || lowerKey.includes('credential')) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = deepRedact(value, depth + 1);
    }
  }
  return result;
}

interface ActionLogEntry {
  timestamp: string;
  type: 'action' | 'error' | 'client-error';
  userId?: string;
  userEmail?: string;
  userRole?: string;
  method: string;
  path: string;
  intent: string;
  statusCode: number;
  duration: number;
  success: boolean;
  requestBody?: any;
  responsePreview?: string;
  errorMessage?: string;
  errorStack?: string;
  userAgent?: string;
  ip?: string;
}

export function createActionLoggerMiddleware(): RequestHandler {
  return function actionLogger(req: Request, res: Response, next: NextFunction) {
    if (!req.path.startsWith('/api')) return next();
    if (req.path === '/health') return next();

    const start = Date.now();
    const user = (req as any).user;

    const originalJson = res.json.bind(res);
    let responseBody: any = undefined;

    res.json = function (body: any) {
      responseBody = body;
      return originalJson(body);
    };

    res.on('finish', () => {
      const duration = Date.now() - start;
      const statusCode = res.statusCode;
      const success = statusCode >= 200 && statusCode < 400;
      const intent = getActionIntent(req.method, req.path);

      const entry: ActionLogEntry = {
        timestamp: new Date().toISOString(),
        type: success ? 'action' : 'error',
        userId: user?.id,
        userEmail: user?.email,
        userRole: user?.role,
        method: req.method,
        path: req.path,
        intent,
        statusCode,
        duration,
        success,
        userAgent: req.headers['user-agent']?.slice(0, 120),
        ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket?.remoteAddress,
      };

      if (!success) {
        if (req.body && Object.keys(req.body).length > 0) {
          entry.requestBody = deepRedact({ ...req.body });
        }

        if (responseBody) {
          entry.errorMessage = responseBody?.message || responseBody?.error || `HTTP ${statusCode}`;
          if (typeof entry.errorMessage === 'string') {
            entry.errorMessage = entry.errorMessage.slice(0, 200);
          }
        }
      }

      appendLog(ACTION_LOG_FILE, entry);

      if (statusCode >= 500) {
        const errorEntry = {
          timestamp: entry.timestamp,
          message: `[${statusCode}] ${intent} failed: ${entry.errorMessage || 'Unknown server error'}`,
          stack: '',
          path: req.path,
          method: req.method,
          signature: `${statusCode}:${req.method}:${req.path.replace(/[a-f0-9-]{36}/g, ':id').replace(/\d+/g, ':id')}`,
          context: {
            userId: user?.id,
            intent,
            duration,
            requestBody: entry.requestBody,
          },
        };
        appendLog(ERROR_LOG_FILE, errorEntry);
      }

      if (statusCode === 401 || statusCode === 403) {
        const authEntry = {
          timestamp: entry.timestamp,
          message: `[${statusCode}] Auth failure on "${intent}" (${req.method} ${req.path}) — user ${user?.email || user?.id || 'anonymous'}`,
          stack: '',
          path: req.path,
          method: req.method,
          signature: `auth-fail:${statusCode}:${req.path.replace(/[a-f0-9-]{36}/g, ':id')}`,
          context: { userId: user?.id, intent },
        };
        appendLog(ERROR_LOG_FILE, authEntry);
      }
    });

    next();
  };
}

function sanitizeUrl(url: string | undefined): string {
  if (!url || typeof url !== 'string') return 'unknown';
  try {
    const parsed = new URL(url, 'http://localhost');
    return parsed.pathname.slice(0, 200);
  } catch {
    return url.split('?')[0].slice(0, 200);
  }
}

export function handleClientErrorReport(req: Request, res: Response) {
  try {
    const body = req.body;
    if (!body || !body.error) {
      return res.status(400).json({ message: 'Missing error field' });
    }

    const user = (req as any).user;
    const errorMsg = (typeof body.error === 'string' ? body.error : body.error?.message || 'Unknown error').slice(0, 500);
    const action = (typeof body.action === 'string' ? body.action : 'Unknown user action').slice(0, 200);
    const url = sanitizeUrl(body.url);

    const actionEntry: ActionLogEntry = {
      timestamp: new Date().toISOString(),
      type: 'client-error',
      userId: user?.id,
      method: 'CLIENT',
      path: url,
      intent: action,
      statusCode: 0,
      duration: 0,
      success: false,
      errorMessage: errorMsg,
      userAgent: (typeof body.userAgent === 'string' ? body.userAgent : '').slice(0, 120),
    };

    appendLog(ACTION_LOG_FILE, actionEntry);

    const errorLogEntry = {
      timestamp: actionEntry.timestamp,
      message: `[CLIENT] ${action}: ${errorMsg}`,
      stack: (typeof body.componentStack === 'string' ? body.componentStack : '').slice(0, 2000),
      path: url,
      method: 'CLIENT',
      signature: `client:${errorMsg.slice(0, 80).replace(/[^a-zA-Z0-9]/g, '_')}`,
      context: { userId: user?.id, action, url },
    };
    appendLog(ERROR_LOG_FILE, errorLogEntry);

    res.json({ logged: true });
  } catch (err: any) {
    console.error('[ActionLogger] Client error report failed:', err.message);
    res.status(500).json({ message: 'Failed to log error' });
  }
}

export function getRecentActionLogs(limit = 100): any[] {
  try {
    if (!fs.existsSync(ACTION_LOG_FILE)) return [];
    const content = fs.readFileSync(ACTION_LOG_FILE, 'utf-8').trim();
    if (!content) return [];
    const lines = content.split('\n').filter(Boolean);
    const entries = [];
    for (const line of lines.slice(-limit)) {
      try { entries.push(JSON.parse(line)); } catch {}
    }
    return entries;
  } catch {
    return [];
  }
}

export function getFailedActions(limit = 50): any[] {
  return getRecentActionLogs(500).filter(e => !e.success).slice(-limit);
}

export function getActionSummary(): {
  totalActions: number;
  failedActions: number;
  failureRate: string;
  topFailures: { intent: string; count: number; lastError: string }[];
  recentFailures: any[];
} {
  const all = getRecentActionLogs(1000);
  const failed = all.filter(e => !e.success);

  const failureMap = new Map<string, { count: number; lastError: string }>();
  for (const f of failed) {
    const key = f.intent || `${f.method} ${f.path}`;
    const existing = failureMap.get(key) || { count: 0, lastError: '' };
    existing.count++;
    existing.lastError = f.errorMessage || '';
    failureMap.set(key, existing);
  }

  const topFailures = Array.from(failureMap.entries())
    .map(([intent, data]) => ({ intent, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalActions: all.length,
    failedActions: failed.length,
    failureRate: all.length > 0 ? ((failed.length / all.length) * 100).toFixed(1) : '0.0',
    topFailures,
    recentFailures: failed.slice(-5),
  };
}
