import { useCallback } from 'react';
import { api } from '../services/api';
import { useStore } from '../stores/useStore';

// ── Surface Actions Hook ─────────────────────────────────────
// Centralises the "call API → refetch surfaces" pattern that was
// duplicated across Dashboard.tsx and SurfaceView.tsx.

export function useSurfaceActions() {
  const setSurfaces = useStore((s) => s.setSurfaces);
  const setRefreshing = useStore((s) => s.setRefreshing);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const updated = await api.getSurfaces();
      setSurfaces(updated);
    } finally {
      setRefreshing(false);
    }
  }, [setSurfaces, setRefreshing]);

  const approve = useCallback(
    async (id: string) => {
      await api.submitSurface(id, {}, 'approved');
      await refresh();
    },
    [refresh],
  );

  const reject = useCallback(
    async (id: string) => {
      await api.submitSurface(id, {}, 'rejected');
      await refresh();
    },
    [refresh],
  );

  const dismiss = useCallback(
    async (id: string) => {
      await api.dismissSurface(id);
      await refresh();
    },
    [refresh],
  );

  const decline = useCallback(
    async (id: string) => {
      await api.declineSurface(id);
      await refresh();
    },
    [refresh],
  );

  const archive = useCallback(
    async (id: string) => {
      await api.archiveSurface(id);
      await refresh();
    },
    [refresh],
  );

  const bulkArchive = useCallback(
    async (ids: string[]) => {
      await api.bulkArchive(ids);
      await refresh();
    },
    [refresh],
  );

  return { refresh, approve, reject, dismiss, decline, archive, bulkArchive };
}
