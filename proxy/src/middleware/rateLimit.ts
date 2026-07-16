import type { Context, Next } from 'hono';

// ── In-memory sliding-window rate limiter ───────────────────
// Keyed by API key (or client IP fallback). Suitable for single-instance
// deployments; swap for Redis-backed counters when running multiple instances.

interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000; // 1 minute
const buckets = new Map<string, Window>();

// Periodic cleanup so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, w] of buckets) {
    if (w.resetAt <= now) buckets.delete(key);
  }
}, WINDOW_MS).unref?.();

function clientKey(c: Context): string {
  const apiKey = c.req.header('x-ido-api-key');
  if (apiKey) return `k:${apiKey}`;
  const fwd = c.req.header('x-forwarded-for');
  const ip = fwd ? (fwd.split(',')[0] ?? '').trim() || 'local' : 'local';
  return `ip:${ip}`;
}

/**
 * Rate-limit middleware. `limit` is the max requests per minute for this route
 * group, and `label` distinguishes separate groups so they don't share buckets.
 * Returns 429 with a Retry-After header when exceeded.
 */
export function rateLimit(limit: number, label: string) {
  return async (c: Context, next: Next) => {
    const key = `${clientKey(c)}:${label}`;
    const now = Date.now();
    let w = buckets.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, w);
    }
    w.count += 1;

    const remaining = Math.max(0, limit - w.count);
    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(w.resetAt / 1000)));

    if (w.count > limit) {
      const retryAfter = Math.ceil((w.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      return c.json(
        { error: 'Rate limit exceeded. Please slow down.', retryAfter },
        429,
      );
    }
    return next();
  };
}
