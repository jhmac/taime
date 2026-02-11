const CACHE_NAME = 'clocksync-ai-v2.0.0';
const STATIC_CACHE_URLS = [
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_CACHE_URLS))
      .then(() => self.skipWaiting())
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
      .then(() => {
        return self.clients.matchAll({ type: 'window' }).then((clients) => {
          clients.forEach((client) => client.navigate(client.url));
        });
      })
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== location.origin) return;

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

  if (url.pathname.endsWith('.js') || url.pathname.endsWith('.ts') ||
      url.pathname.endsWith('.tsx') || url.pathname.endsWith('.jsx') ||
      url.pathname.endsWith('.css') || url.pathname === '/' ||
      url.pathname.startsWith('/src/') || url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/node_modules/')) {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match(request).then((r) => r || fetch(request)))
    );
    return;
  }

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
          .catch(() => {
            if (request.headers.get('accept')?.includes('text/html')) {
              return caches.match('/');
            }
          });
      })
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: data.icon || '/icon-192x192.png',
      badge: data.badge || '/badge-72x72.png',
      data: data.data || {},
      actions: data.actions || [],
      tag: data.data?.type || 'general',
      renotify: true,
      requireInteraction: data.data?.type === 'overtime_warning' || data.data?.type === 'location_reminder',
      silent: false,
      vibrate: [200, 100, 200]
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
  } catch (error) {
    event.waitUntil(
      self.registration.showNotification('ClockSync AI', {
        body: 'You have a new notification',
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png'
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action;
  let url = '/';
  if (action === 'clock_in' || action === 'clock_out') url = '/?action=clock';
  else if (action === 'view_task') url = '/?action=tasks';
  else if (action === 'view_schedule') url = '/?action=schedule';
  else if (action === 'review_payroll') url = '/?action=payroll';
  else if (data.type === 'task_assignment') url = '/?action=tasks';
  else if (data.type === 'schedule_update') url = '/?action=schedule';
  else if (data.type === 'payroll_ready') url = '/?action=payroll';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(url.split('?')[0]) && 'focus' in client) {
            client.postMessage({ type: 'notification-action', action: action || 'open', data });
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(url);
      })
  );
});

self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(Promise.resolve());
  }
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data && event.data.type === 'GET_VERSION') event.ports[0].postMessage({ version: CACHE_NAME });
});
