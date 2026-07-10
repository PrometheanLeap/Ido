import { config } from '../config.js';
import type { SurfaceType, Severity } from '../types.js';

// ── SSE Event Types ─────────────────────────────────────────

export interface SurfaceUpdateEvent {
  type: 'surface_update';
  surfaceId: string;
  surfaceType: SurfaceType;
  title: string;
  state: string;
  context?: string;
  severity?: Severity;
  expiresAt?: string;
  source?: string;
  createdAt: string;
  updatedAt?: string;
  archived?: number;
  viewedAt?: string;
  taskId?: string;
  userId?: string;
}

export interface SurfaceResolvedEvent {
  type: 'surface_resolved';
  surfaceId: string;
  state: string;
}

// ── Typed Event Factory ─────────────────────────────────────

export function buildSurfaceUpdateEvent(surface: {
  surface_id: string;
  type: string;
  title: string;
  state: string;
  context?: string | null;
  severity?: string | null;
  expires_at?: string | null;
  source?: string | null;
  created_at: string;
  updated_at?: string | null;
  archived?: number | null;
  viewed_at?: string | null;
  task_id?: string | null;
  user_id?: string | null;
}): SurfaceUpdateEvent {
  return {
    type: 'surface_update',
    surfaceId: surface.surface_id,
    surfaceType: surface.type as SurfaceType,
    title: surface.title,
    state: surface.state,
    context: surface.context ?? undefined,
    severity: surface.severity as Severity | undefined,
    expiresAt: surface.expires_at ?? undefined,
    source: surface.source ?? undefined,
    createdAt: surface.created_at,
    updatedAt: surface.updated_at ?? undefined,
    archived: surface.archived ?? 0,
    viewedAt: surface.viewed_at ?? undefined,
    taskId: surface.task_id ?? undefined,
    userId: surface.user_id ?? undefined,
  };
}
