// Ido Dev Service Worker — minimal push-only worker for localhost
// No workbox imports — vite-plugin-pwa serves this raw in dev mode

self.addEventListener('push', (event) => {
  const pushEvent = event as PushEvent;
  if (!pushEvent.data) return;

  try {
    const payload = pushEvent.data.json();
    pushEvent.waitUntil(
      self.registration.showNotification(payload.title || 'Ido', {
        body: payload.body || '',
        tag: payload.tag || 'ido-surface',
        data: payload.data || {},
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        actions: payload.actions || [],
      })
    );
  } catch {
    pushEvent.waitUntil(
      self.registration.showNotification('Ido', {
        body: pushEvent.data.text(),
        icon: '/icon-192.png',
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  const clickEvent = event as NotificationClickEvent;
  clickEvent.notification.close();
  clickEvent.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return (client as WindowClient).focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
