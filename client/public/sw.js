const CACHE_NAME = 'clocksync-ai-v1.0.0';
const STATIC_CACHE_URLS = [
  '/',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[ServiceWorker] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[ServiceWorker] Caching static assets');
        return cache.addAll(STATIC_CACHE_URLS);
      })
      .then(() => {
        console.log('[ServiceWorker] Skip waiting');
        return self.skipWaiting();
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[ServiceWorker] Activate');
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[ServiceWorker] Removing old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[ServiceWorker] Claiming clients');
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip cross-origin requests
  if (url.origin !== location.origin) {
    return;
  }

  // Handle API requests with network-first strategy
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses for offline fallback
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseClone);
              });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache when network fails
          return caches.match(request)
            .then((response) => {
              if (response) {
                return response;
              }
              // Return offline fallback for API requests
              return new Response(
                JSON.stringify({ 
                  error: 'Network unavailable',
                  message: 'This feature is not available offline'
                }),
                {
                  status: 503,
                  headers: { 'Content-Type': 'application/json' }
                }
              );
            });
        })
    );
    return;
  }

  // Handle static assets with cache-first strategy
  event.respondWith(
    caches.match(request)
      .then((response) => {
        if (response) {
          return response;
        }
        
        return fetch(request)
          .then((response) => {
            // Don't cache non-successful responses
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Cache the response
            const responseToCache = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // Fallback for HTML requests when offline
            if (request.headers.get('accept').includes('text/html')) {
              return caches.match('/');
            }
          });
      })
  );
});

// Push notification event handler
self.addEventListener('push', (event) => {
  console.log('[ServiceWorker] Push received:', event);

  if (!event.data) {
    console.log('[ServiceWorker] Push event but no data');
    return;
  }

  try {
    const data = event.data.json();
    console.log('[ServiceWorker] Push data:', data);

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

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  } catch (error) {
    console.error('[ServiceWorker] Error processing push:', error);
    
    // Fallback notification
    event.waitUntil(
      self.registration.showNotification('ClockSync AI', {
        body: 'You have a new notification',
        icon: '/icon-192x192.png',
        badge: '/badge-72x72.png'
      })
    );
  }
});

// Notification click event handler
self.addEventListener('notificationclick', (event) => {
  console.log('[ServiceWorker] Notification click received:', event);

  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action;

  // Handle different notification types and actions
  let url = '/';
  
  if (action === 'clock_in' || action === 'clock_out') {
    url = '/?action=clock';
  } else if (action === 'view_task') {
    url = '/?action=tasks';
  } else if (action === 'view_schedule') {
    url = '/?action=schedule';
  } else if (action === 'review_payroll') {
    url = '/?action=payroll';
  } else if (data.type === 'task_assignment') {
    url = '/?action=tasks';
  } else if (data.type === 'schedule_update') {
    url = '/?action=schedule';
  } else if (data.type === 'payroll_ready') {
    url = '/?action=payroll';
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Check if app is already open
        for (const client of clientList) {
          if (client.url.includes(url.split('?')[0]) && 'focus' in client) {
            // Send message to existing window
            client.postMessage({
              type: 'notification-action',
              action: action || 'open',
              data: data
            });
            return client.focus();
          }
        }
        
        // Open new window if not already open
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// Background sync for when connection is restored
self.addEventListener('sync', (event) => {
  console.log('[ServiceWorker] Background sync:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(
      // Sync any pending data when connection is restored
      syncPendingData()
    );
  }
});

// Sync pending data when back online
async function syncPendingData() {
  try {
    // Get pending time entries from IndexedDB or cache
    // This would sync any offline time clock data
    console.log('[ServiceWorker] Syncing pending data...');
    
    // Implementation would depend on offline storage strategy
    // For now, just log that sync is available
    
    return Promise.resolve();
  } catch (error) {
    console.error('[ServiceWorker] Error syncing data:', error);
    return Promise.reject(error);
  }
}

// Handle messages from the main app
self.addEventListener('message', (event) => {
  console.log('[ServiceWorker] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// Periodic background sync (if supported)
if ('periodicSync' in self.registration) {
  self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'update-data') {
      event.waitUntil(
        // Periodically sync data in background
        syncPendingData()
      );
    }
  });
}
