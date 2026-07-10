import webpush from 'web-push';
import { config } from '../config.js';
import { Kysely } from 'kysely';
import type { DB } from '../db/adapter.js';
import fs from 'fs';
import path from 'path';

// ── Quiet hours evaluation ──────────────────────────────────

const WEEKDAY_ABBREVS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Determine whether "now" (in the user's configured timezone) falls within
 * their quiet-hours window.
 *
 * - `quiet_start` / `quiet_end` are `HH:mm` strings (24-hour).
 * - `quiet_timezone` is an IANA timezone (e.g. `Europe/London`). Falls back to
 *   the server's local timezone if null/invalid.
 * - `quiet_days` is a JSON array of weekday abbreviations
 *   (e.g. `["Mon","Tue","Wed","Thu","Fri"]`). Null/empty = all days.
 * - Handles windows that cross midnight (e.g. start=22:00, end=07:00).
 */
function isWithinQuietHours(prefs: {
  quiet_start: string | null;
  quiet_end: string | null;
  quiet_timezone: string | null;
  quiet_days: string | null;
}): boolean {
  const { quiet_start, quiet_end, quiet_timezone, quiet_days } = prefs;
  if (!quiet_start || !quiet_end) return false;

  // Current time in the user's timezone (or server local if unspecified)
  const tz = quiet_timezone || undefined;
  let nowParts: Intl.DateTimeFormatPart[];
  try {
    nowParts = Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(new Date());
  } catch {
    // Invalid timezone — fall back to server local time
    nowParts = Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(new Date());
  }

  const getPart = (type: string) => nowParts.find((p) => p.type === type)?.value ?? '';
  const nowHour = parseInt(getPart('hour'), 10) || 0;
  const nowMin = parseInt(getPart('minute'), 10) || 0;
  const nowWeekday = getPart('weekday'); // e.g. "Mon"
  const nowMinutes = nowHour * 60 + nowMin;

  // Day-of-week filter — if quiet_days is set, only suppress on those days
  if (quiet_days) {
    try {
      const days: string[] = JSON.parse(quiet_days);
      if (Array.isArray(days) && days.length > 0 && !days.includes(nowWeekday)) {
        return false;
      }
    } catch {
      // Malformed quiet_days — treat as "all days"
    }
  }

  const [startH, startM] = (quiet_start.split(':').map((n) => parseInt(n, 10) || 0));
  const [endH, endM] = (quiet_end.split(':').map((n) => parseInt(n, 10) || 0));
  const startMinutes = (startH ?? 0) * 60 + (startM ?? 0);
  const endMinutes = (endH ?? 0) * 60 + (endM ?? 0);

  // Window crosses midnight (e.g. 22:00 → 07:00)
  if (startMinutes > endMinutes) {
    return nowMinutes >= startMinutes || nowMinutes < endMinutes;
  }
  // Same-day window (e.g. 09:00 → 17:00)
  return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

// ── Initialize VAPID ────────────────────────────────────────

export function initWebPush(): void {
  let publicKey = config.vapidPublicKey;
  let privateKey = config.vapidPrivateKey;

  // Auto-generate VAPID keys if not configured
  if (!publicKey || !privateKey) {
    const keyPath = path.resolve(import.meta.dirname, '../../data/.vapid');
    try {
      if (fs.existsSync(keyPath)) {
        const saved = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        publicKey = saved.publicKey;
        privateKey = saved.privateKey;
      }
    } catch { /* file missing or corrupt — regenerate */ }

    if (!publicKey || !privateKey) {
      const keys = webpush.generateVAPIDKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      try {
        fs.mkdirSync(path.dirname(keyPath), { recursive: true });
        fs.writeFileSync(keyPath, JSON.stringify({ publicKey, privateKey }));
        console.log('VAPID keys generated and saved to data/.vapid');
      } catch (err) {
        console.warn('Could not save VAPID keys to file:', err);
      }
    }

    // Mutate config so the rest of the app sees them
    (config as any).vapidPublicKey = publicKey;
    (config as any).vapidPrivateKey = privateKey;
  }

  if (publicKey && privateKey) {
    webpush.setVapidDetails(config.vapidSubject, publicKey, privateKey);
    console.log('Web Push initialized');
  } else {
    console.warn('VAPID keys not available. Web Push disabled.');
  }
}

// ── Send push notification ──────────────────────────────────

export async function sendPushNotification(
  db: Kysely<DB>,
  tenantId: string,
  userId: string | undefined,
  payload: {
    title: string;
    body: string;
    surfaceId?: string;
    url?: string;
    tags?: string[];
    source?: string;
  },
): Promise<void> {
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    console.warn('Push: VAPID keys not available, skipping');
    return;
  }

  const subscriptions = await db
    .selectFrom('push_subscriptions')
    .where('tenant_id', '=', tenantId)
    .selectAll()
    .execute();

  console.log(`Push: ${subscriptions.length} subscriptions for tenant ${tenantId}`);

  // Filter by userId if specified
  const targets = userId
    ? subscriptions.filter((s) => s.user_id === userId)
    : subscriptions;

  // Check notification preferences for each target user
  const validTargets = [];
  for (const sub of targets) {
    const prefs = await db.selectFrom('notification_preferences')
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', sub.user_id ?? '')
      .selectAll().executeTakeFirst();

    // Respect quiet hours — honour the user's configured start/end, timezone,
    // and day-of-week preferences (stored as HH:mm, IANA tz, and JSON array).
    if (prefs?.quiet_hours_enabled) {
      if (isWithinQuietHours(prefs)) {
        continue;
      }
    }

    validTargets.push(sub);
  }

  console.log(`Push: ${subscriptions.length} total, ${targets.length} matching userId, ${validTargets.length} after pref checks`);

  let succeeded = 0;
  let failed = 0;

  const pushPayload = JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: payload.surfaceId || 'ido-surface',
    data: {
      surfaceId: payload.surfaceId,
      url: payload.url ?? '/',
    },
    actions: [
      { action: 'open', title: 'Open' },
    ],
  });

  for (const sub of validTargets) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh_key,
            auth: sub.auth_key,
          },
        },
        pushPayload,
      );
      succeeded++;
    } catch (err: unknown) {
      failed++;
      const error = err as { statusCode?: number; message?: string; body?: string };
      if (error.statusCode === 410 || error.statusCode === 404) {
        await db
          .deleteFrom('push_subscriptions')
          .where('id', '=', sub.id)
          .execute();
        console.log(`Push: removed dead sub ${sub.id} (${error.statusCode})`);
      } else {
        console.warn(`Push: failed sub ${sub.id}: ${error.statusCode ?? 'network'} ${error.message ?? ''} ${error.body ?? ''}`);
      }
    }
  }

  if (succeeded > 0 || failed > 0) {
    console.log(`Push: sent=${succeeded} failed=${failed}`);
  }
}
