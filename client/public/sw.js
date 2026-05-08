// BUILD_ID is injected at serve time by the Express middleware.
// It is stable for the lifetime of a running server process (set to
// Date.now() at server startup, not at runtime here). This means every
// deploy produces a new BUILD_ID, busting old caches on the next install,
// while a running server always serves the same consistent BUILD_ID.
const BUILD_ID = '__BUILD_ID__';
const CACHE_NAME = 'taime-' + BUILD_ID;
const STATIC_CACHE_URLS = [
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png'
];

const DB_NAME = 'taime-offline';
const STORE_NAME = 'pendingTimeEntries';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeOfflineEntry(url, body, method) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add({
    url,
    body,
    timestamp: Date.now(),
    method: method || 'POST'
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = reject;
  });
}

async function syncPendingEntries() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const entries = await new Promise((resolve) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
  });

  for (const entry of entries) {
    try {
      const resp = await fetch(entry.url, {
        method: entry.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry.body),
        credentials: 'include'
      });
      if (resp.ok) {
        const deleteTx = db.transaction(STORE_NAME, 'readwrite');
        deleteTx.objectStore(STORE_NAME).delete(entry.id);
      }
    } catch (e) {
      break;
    }
  }
}

const OFFLINE_POST_PATHS = [
  '/api/time-entries'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // Only cache truly static, immutable assets.
  // HTML is intentionally NOT cached here — we always fetch fresh HTML from
  // the network so chunk hashes in the HTML always match what the server has.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        STATIC_CACHE_URLS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  const isOfflineTimeEntry = url.origin === location.origin && (
    (request.method === 'POST' && OFFLINE_POST_PATHS.some(path => url.pathname === path)) ||
    (request.method === 'PATCH' && url.pathname.startsWith('/api/time-entries/'))
  );
  if (isOfflineTimeEntry) {
    event.respondWith(
      request.clone().text().then((bodyText) => {
        let body;
        try { body = JSON.parse(bodyText); } catch (e) { body = bodyText; }
        return fetch(request).catch(async () => {
          await storeOfflineEntry(url.pathname, body, request.method);
          if (self.registration.sync) {
            try { await self.registration.sync.register('sync-time-entries'); } catch (e) {}
          }
          return new Response(
            JSON.stringify({ offline: true, message: 'Saved offline. Will sync when online.' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        });
      })
    );
    return;
  }

  if (request.method !== 'GET') return;

  if (url.origin !== location.origin) return;

  // ── STRATEGY 1: API calls — network-first, offline fallback ──────────────
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then((response) => {
              if (response) return response;
              return new Response(
                JSON.stringify({ error: 'Network unavailable', message: 'This feature is not available offline' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              );
            });
        })
    );
    return;
  }

  // ── STRATEGY 2: HTML navigation — ALWAYS network, NEVER serve stale HTML ─
  // This is the Canva approach: HTML always reflects the current deployment.
  // Cached HTML = stale chunk references = blank page after a deploy.
  // We intentionally do NOT fall back to caches.match('/') here because we
  // never cache HTML — doing so would serve stale chunk hashes.
  if (request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Taime - Offline</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Nunito,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;background:#FFFBF5;gap:16px;padding:24px;text-align:center}img{width:64px;height:64px;border-radius:14px}p{color:#78716c;font-size:15px}strong{color:#F47D31;display:block;font-size:18px;margin-bottom:4px}</style></head><body><img src="/favicon.png" alt="Taime"><div><strong>You\'re offline</strong><p>Check your connection and refresh to continue.</p></div></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
      )
    );
    return;
  }

  // ── STRATEGY 3: Hashed assets (JS/CSS bundles) — cache-first ─────────────
  // Content-hashed URLs are immutable. Cache aggressively; no stale risk.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        });
      })
    );
    return;
  }

  // ── STRATEGY 4: Dev-mode paths — always network (Vite HMR etc.) ──────────
  if (url.pathname.startsWith('/src/') || url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/node_modules/')) {
    event.respondWith(fetch(request));
    return;
  }

  // ── STRATEGY 5: Static assets (icons, fonts, manifest) — cache-first ─────
  event.respondWith(
    caches.match(request)
      .then((response) => {
        if (response) return response;
        return fetch(request)
          .then((response) => {
            if (!response || response.status !== 200 || response.type !== 'basic') return response;
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, responseToCache));
            return response;
          })
          .catch(() => {});
      })
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: data.icon || '/assets/icons/icon-192.png',
      badge: data.badge || '/assets/icons/icon-72.png',
      data: data.data || {},
      actions: data.actions || [],
      tag: data.data?.type || 'general',
      renotify: true,
      requireInteraction: data.data?.type === 'clock_in_reminder' || data.data?.type === 'overtime_warning' || data.data?.type === 'location_reminder',
      silent: false,
      vibrate: [200, 100, 200]
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
  } catch (error) {
    event.waitUntil(
      self.registration.showNotification('Taime', {
        body: 'You have a new notification',
        icon: '/assets/icons/icon-192.png',
        badge: '/assets/icons/icon-72.png'
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action;
  let path = '/';
  if (data.type === 'clock_in_reminder' || action === 'clock_in') path = '/?action=clock';
  else if (action === 'clock_out') path = '/?action=clock';
  else if (action === 'view_task') path = '/?action=tasks';
  else if (action === 'view_schedule') path = data.url || '/schedules';
  else if (action === 'review_payroll') path = '/?action=payroll';
  else if (data.type === 'task_assignment') path = '/?action=tasks';
  else if (data.type === 'schedule_update') path = data.url || '/schedules';
  else if (data.type === 'payroll_ready') path = '/?action=payroll';
  else if (data.type === 'anomaly_alert') path = data.url || '/dashboard';
  else if (action === 'view_details' && data.type === 'anomaly_alert') path = '/dashboard';
  else if (data.type === 'achievement_unlocked') path = data.url || '/my-score';
  else if (data.type === 'tier_change') path = data.url || '/my-score';
  else if (data.type === 'top_rank') path = data.url || '/my-score';
  else if (data.type === 'weekly_score_summary') path = data.url || '/my-score';

  // Always build an absolute URL so clients.openWindow opens inside the installed
  // PWA rather than launching the system browser (relative URLs can trigger Safari
  // on iOS / the default browser on Android instead of the standalone app window).
  const absoluteUrl = path.startsWith('http')
    ? path
    : new URL(path, self.location.origin).href;

  // The path without query string, used for client matching.
  const basePath = path.split('?')[0];

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (new URL(client.url).pathname === basePath && 'focus' in client) {
            // Navigate to the full URL (preserving query-string action params) and
            // then post the message so in-app handlers can react immediately.
            return ('navigate' in client ? client.navigate(absoluteUrl) : Promise.resolve())
              .then(() => client.focus())
              .then(() => client.postMessage({ type: 'notification-action', action: action || 'open', data }));
          }
        }
        // No matching client — focus any existing PWA window and navigate it to
        // the target path so we stay in the standalone shell instead of opening
        // a new browser tab.
        if (clientList.length > 0 && 'focus' in clientList[0]) {
          const target = clientList[0];
          return ('navigate' in target ? target.navigate(absoluteUrl) : Promise.resolve())
            .then(() => target.focus());
        }
        if (clients.openWindow) return clients.openWindow(absoluteUrl);
      })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-time-entries' || event.tag === 'background-sync') {
    event.waitUntil(syncPendingEntries());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') event.ports[0].postMessage({ version: CACHE_NAME });
  if (event.data && event.data.type === 'SYNC_PENDING') {
    event.waitUntil(syncPendingEntries());
  }
});
