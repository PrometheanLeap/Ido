// ── Time formatting helpers ─────────────────────────────────
// Shared between SurfaceCard, SurfaceView, and Dashboard.

/** Format a relative time string like "just now", "5m ago", "3h ago". */
export function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Format a remaining-time label for an expiry countdown. */
export function expiresIn(expiresAt: string): { text: string; urgent: boolean } {
  const now = Date.now();
  const then = new Date(expiresAt).getTime();
  const secs = Math.floor((then - now) / 1000);
  if (secs <= 0) return { text: 'Expired', urgent: true };
  if (secs < 60) return { text: `${secs}s`, urgent: true };
  const mins = Math.floor(secs / 60);
  if (mins < 60) return { text: `${mins}m`, urgent: mins < 15 };
  const hours = Math.floor(mins / 60);
  if (hours < 24) return { text: `${hours}h`, urgent: hours < 1 };
  const days = Math.floor(hours / 24);
  return { text: `${days}d`, urgent: false };
}

/** Format a millisecond duration into a short label (e.g. "5m", "3h", "2d"). */
export function formatDuration(ms: number): string | null {
  if (ms <= 0) return null;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
