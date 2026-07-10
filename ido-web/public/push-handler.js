// Ido push notification handlers — imported into the generated SW via importScripts
// Must be plain JS (no ES imports) because the SW is a classic script in dev mode

self.addEventListener('push', function(event) {
  if (!event.data) return;
  try {
    var payload = event.data.json();
    event.waitUntil(
      self.registration.showNotification(payload.title || 'Ido', {
        body: payload.body || '',
        tag: payload.tag || 'ido-surface',
        data: payload.data || {},
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        actions: payload.actions || [],
      })
    );
  } catch (e) {
    event.waitUntil(
      self.registration.showNotification('Ido', {
        body: event.data.text(),
        icon: '/icon-192.png',
        badge: '/icon-192.png',
      })
    );
  }
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      for (var i = 0; i < clients.length; i++) {
        if ('focus' in clients[i]) {
          return clients[i].focus();
        }
      }
      return self.clients.openWindow('/');
    })
  );
});
