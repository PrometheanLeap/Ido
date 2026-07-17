import { useEffect, useRef, useCallback } from 'react';
import { useStore } from '../stores/useStore';
import { clearSurfaceNotification } from '../utils/push';

export function useSSE() {
  const { isAuthenticated, addOrUpdateSurface, removeSurface, setSseConnected } = useStore();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const unmountedRef = useRef(false);

  const connect = useCallback(() => {
    console.warn('[SSE] connect() called. existingEventSource=' + !!eventSourceRef.current + ' readyState=' + (eventSourceRef.current?.readyState ?? 'none') + ' time=' + new Date().toISOString());
    if (unmountedRef.current) return;
    // Clear any pending reconnect timer (e.g. from a previous onerror)
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // In dev, bypass the Vite proxy for SSE — it buffers the stream and delays
    // onopen by seconds. In production, /sse is served by the same origin.
    const sseUrl = import.meta.env.DEV ? 'http://localhost:8645/sse' : '/sse';
    const es = new EventSource(sseUrl, { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => {
      console.warn('[SSE] onopen fired. time=' + new Date().toISOString());
      reconnectAttemptRef.current = 0;
      setSseConnected(true);
    };

    es.addEventListener('surface_update', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (!data.surfaceId) return;
        // The event carries everything the card list needs — merge it directly.
        // No per-surface fetch (that caused request storms on every reconnect).
        // Heavy blobs (components/schema/data) are fetched lazily on open.
        addOrUpdateSurface({
          surface_id: data.surfaceId,
          type: data.surfaceType,
          title: data.title,
          state: data.state,
          context: data.context ?? null,
          severity: data.severity ?? null,
          expires_at: data.expiresAt ?? null,
          source: data.source ?? null,
          created_at: data.createdAt,
          updated_at: data.updatedAt ?? data.createdAt,
          archived: data.archived ?? 0,
          viewed_at: data.viewedAt ?? null,
          task_id: data.taskId,
          user_id: data.userId ?? null,
        });
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('surface_resolved', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.surfaceId) {
          removeSurface(data.surfaceId);
          // Addressed here or on another device — close the stale notification.
          clearSurfaceNotification(data.surfaceId);
        }
      } catch { /* ignore */ }
    });

    es.onerror = () => {
      if (unmountedRef.current) return;
      // Diagnostic: log why the EventSource errored
      const state = es.readyState; // 0=CONNECTING, 1=OPEN, 2=CLOSED
      console.warn('[SSE] onerror fired. readyState=' + state + ' attempt=' + reconnectAttemptRef.current + ' time=' + new Date().toISOString());
      setSseConnected(false);
      es.close();
      if (eventSourceRef.current === es) {
        eventSourceRef.current = null;
      }

      // Actually reconnect with exponential backoff: 3s, 6s, 12s, … max 30s
      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(3000 * Math.pow(2, attempt), 30000);
      reconnectAttemptRef.current = attempt + 1;

      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [addOrUpdateSurface, removeSurface, setSseConnected]);

  useEffect(() => {
    console.warn('[SSE] useEffect running. isAuthenticated=' + isAuthenticated + ' time=' + new Date().toISOString());
    unmountedRef.current = false;

    if (!isAuthenticated) return;

    connect();

    // Reconnect when the tab becomes visible again (browsers throttle hidden SSE)
    // Only reconnect if the EventSource is not already open — avoid unnecessary
    // disconnect/reconnect cycles that show as "Reconnecting" in the UI.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const es = eventSourceRef.current;
        if (!es || es.readyState === EventSource.CLOSED) {
          reconnectAttemptRef.current = 0;
          connect();
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      console.warn('[SSE] useEffect cleanup. time=' + new Date().toISOString());
      unmountedRef.current = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setSseConnected(false);
    };
  }, [isAuthenticated, connect]);
}

