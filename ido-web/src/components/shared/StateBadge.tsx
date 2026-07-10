import type React from 'react';

// ── Surface State Badge ──────────────────────────────────────
// Shared state badge used by SurfaceCard (dashboard list) and
// SurfaceView (modal header). Single source of truth for state
// labels, colors, and icons.

interface StateDef {
  label: string;
  color: string;
  icon: React.ReactNode;
}

const STATE_DEFS: Record<string, StateDef> = {
  COMPLETED: {
    label: 'Submitted',
    color: 'var(--color-accent-success)',
    icon: (
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <path d="M3 6l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  REJECTED: {
    label: 'Rejected',
    color: 'var(--color-accent-error)',
    icon: (
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'var(--color-secondary)',
    icon: (
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.2" />
        <line x1="4" y1="4" x2="8" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
  EXPIRED: {
    label: 'Expired',
    color: 'var(--color-accent-warning)',
    icon: (
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1" />
        <line x1="6" y1="3" x2="6" y2="6.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <circle cx="6" cy="8.5" r="0.4" fill="currentColor" />
      </svg>
    ),
  },
  DISMISSED: {
    label: 'Dismissed',
    color: 'var(--color-secondary)',
    icon: (
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1" />
        <path d="M4.5 6l3 0" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
      </svg>
    ),
  },
};

const ARCHIVED_DEF: StateDef = {
  label: 'Archived',
  color: 'var(--color-secondary)',
  icon: (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
      <rect x="2" y="3" width="8" height="7.5" rx="1" stroke="currentColor" strokeWidth="0.9" />
      <line x1="3.5" y1="1.5" x2="3.5" y2="4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="8.5" y1="1.5" x2="8.5" y2="4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  ),
};

interface StateBadgeProps {
  state: string;
  type?: string;
  archived?: number;
}

export function StateBadge({ state, type, archived }: StateBadgeProps) {
  // Archived takes priority
  if (archived) {
    const s = ARCHIVED_DEF;
    return (
      <span
        className="text-label inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
        style={{ color: s.color, backgroundColor: `${s.color}15` }}
      >
        {s.icon}
        {s.label}
      </span>
    );
  }

  let def = STATE_DEFS[state];
  if (!def) return null;

  // Approval-specific label for COMPLETED
  if (state === 'COMPLETED' && type === 'approval') {
    def = { ...def, label: 'Approved' };
  }

  return (
    <span
      className="text-label inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
      style={{ color: def.color, backgroundColor: `${def.color}15` }}
    >
      {def.icon}
      {def.label}
    </span>
  );
}
