import { api } from '../services/api';

// Convert a base64url VAPID key into the Uint8Array the Push API expects.
export function urlB64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

function pushSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

// Read this device's existing push subscription, if any.
export async function getLocalSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

// Request permission (if needed), create a browser subscription, and register it
// with the server. Returns true only when this device is genuinely subscribed.
export async function subscribeToPush(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;

    const reg = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SW timeout')), 4000)),
    ]);

    // Reuse an existing subscription if present, otherwise create one.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const vapidKey = (await api.getVapidKey()).publicKey;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(vapidKey),
      });
    }
    await api.subscribePush(sub);
    return true;
  } catch {
    return false;
  }
}

// Tear down this device's subscription, both locally and on the server.
export async function unsubscribeFromPush(): Promise<void> {
  try {
    const sub = await getLocalSubscription();
    if (sub) {
      await sub.unsubscribe();
      await api.unsubscribePush(sub.endpoint);
    }
  } catch {
    /* ignore */
  }
}

// Reconcile the server-side push_enabled preference against this device's real
// subscription/permission state. Returns the true "enabled on this device" flag
// for the toggle to display. Self-heals a missing subscription when permission
// was already granted (no prompt), so an installed PWA does not show ON while
// silently having no subscription.
export async function reconcilePushState(serverEnabled: boolean): Promise<boolean> {
  if (!pushSupported()) return false;

  const sub = await getLocalSubscription();

  if (!serverEnabled) {
    // Server says off — reflect whatever the device actually has.
    return !!sub;
  }

  if (sub) {
    // Ensure the server has this device's current endpoint (endpoints rotate).
    try {
      await api.subscribePush(sub);
    } catch {
      /* ignore */
    }
    return Notification.permission === 'granted';
  }

  // No local subscription but the server thinks push is on.
  if (Notification.permission === 'granted') {
    // Permission already granted — silently recreate the subscription.
    return subscribeToPush();
  }

  // Permission not granted: cannot truly be on. Show off so a tap re-triggers
  // the permission prompt via a user gesture.
  return false;
}

// Silent self-heal used on app load: only acts when permission is already
// granted, so it never triggers a permission prompt without a user gesture.
export async function selfHealPushSubscription(): Promise<void> {
  if (!pushSupported()) return;
  if (Notification.permission !== 'granted') return;
  try {
    const prefs = await api.getPreferences();
    if (!prefs?.push_enabled) return;
    const sub = await getLocalSubscription();
    if (sub) {
      try {
        await api.subscribePush(sub);
      } catch {
        /* ignore */
      }
    } else {
      await subscribeToPush();
    }
  } catch {
    /* ignore */
  }
}

// Close a single OS notification tied to a surface (addressed on this device).
export async function clearSurfaceNotification(surfaceId: string): Promise<void> {
  try {
    if ('serviceWorker' in navigator && 'getNotifications' in ServiceWorkerRegistration.prototype) {
      const reg = await navigator.serviceWorker.ready;
      const notifs = await reg.getNotifications({ tag: surfaceId });
      notifs.forEach((n) => n.close());
    }
  } catch {
    /* not supported */
  }
}

// Close every active Ido notification (app opened / brought to foreground).
export async function clearAllNotifications(): Promise<void> {
  try {
    if ('serviceWorker' in navigator && 'getNotifications' in ServiceWorkerRegistration.prototype) {
      const reg = await navigator.serviceWorker.ready;
      const notifs = await reg.getNotifications();
      notifs.forEach((n) => n.close());
    }
  } catch {
    /* not supported */
  }
}
