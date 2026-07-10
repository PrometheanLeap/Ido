import { useMemo } from 'react';
import type { Surface } from '../stores/useStore';

// ── Surface Filtering & Sorting ─────────────────────────────
// Encapsulates the inbox/history partitioning, type filtering,
// search, and priority sorting that was inline in Dashboard.tsx.

const TERMINAL_STATES = ['COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'DISMISSED'];

export function useSurfaceFilters(
  surfaces: Surface[],
  page: 'inbox' | 'history',
  selectedType: string | null,
  showArchived: boolean,
  searchQuery: string,
) {
  // Inbox: non-archived, non-dismissed. Dismissed notifications go to history.
  const inboxSurfaces = useMemo(
    () =>
      surfaces.filter((s) => {
        if (s.archived) return false;
        if (s.type === 'notification') return s.state !== 'DISMISSED';
        return !TERMINAL_STATES.includes(s.state);
      }),
    [surfaces],
  );

  // History: terminal forms/approvals + dismissed notifications.
  // Archive toggle shows all archived.
  const historySurfaces = useMemo(
    () =>
      surfaces
        .filter((s) => {
          if (showArchived) return s.archived === 1;
          if (s.archived) return s.type === 'notification';
          if (s.type === 'notification') return s.state === 'DISMISSED';
          return ['COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(s.state);
        })
        .sort(
          (a, b) =>
            new Date(b.updated_at ?? b.created_at).getTime() -
            new Date(a.updated_at ?? a.created_at).getTime(),
        ),
    [surfaces, showArchived],
  );

  const archivedCount = useMemo(
    () => surfaces.filter((s) => s.archived === 1).length,
    [surfaces],
  );

  // Type filter (inbox only)
  const filteredInbox = useMemo(
    () => (selectedType ? inboxSurfaces.filter((s) => s.type === selectedType) : inboxSurfaces),
    [inboxSurfaces, selectedType],
  );

  // Sort: expiring soon at top, then newest first (created_at descending).
  // Surfaces with an expiry within 1 hour are pinned to the top, ordered by
  // soonest expiry. Everything else is sorted by created_at descending.
  const sortedInbox = useMemo(() => {
    const arr = [...filteredInbox];
    arr.sort((a, b) => {
      const now = Date.now();

      const aExp = a.expires_at ? new Date(a.expires_at).getTime() - now : Infinity;
      const bExp = b.expires_at ? new Date(b.expires_at).getTime() - now : Infinity;
      const aUrgent = aExp > 0 && aExp < 3600000;
      const bUrgent = bExp > 0 && bExp < 3600000;

      // Expiring soon → top, ordered by soonest first
      if (aUrgent && !bUrgent) return -1;
      if (!aUrgent && bUrgent) return 1;
      if (aUrgent && bUrgent) return aExp - bExp;

      // Everything else: newest first (created_at descending)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return arr;
  }, [filteredInbox]);

  // Apply search query
  const displaySurfaces = useMemo(() => {
    const base = page === 'inbox' ? sortedInbox : historySurfaces;
    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase();
    return base.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.source && s.source.toLowerCase().includes(q)) ||
        (s.context && s.context.toLowerCase().includes(q)),
    );
  }, [sortedInbox, historySurfaces, page, searchQuery]);

  return {
    inboxSurfaces,
    historySurfaces,
    archivedCount,
    displaySurfaces,
  };
}
