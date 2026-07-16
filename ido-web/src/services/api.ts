import type { Surface } from '../stores/useStore';
import type {
  WhoamiResponse,
  LoginResponse,
  ApiKey,
  CreateKeyResponse,
  UpdateKeyResponse,
  SubmitSurfaceResponse,
  Preferences,
  HealthResponse,
  VapidKeyResponse,
} from './types';

const BASE = '/api/v1';

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  console.trace('[Ido API]', options.method || 'GET', path);
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<LoginResponse>('/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  setup: (username: string, password: string) =>
    request<LoginResponse>('/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  logout: () => request('/logout', { method: 'POST' }),

  updateProfile: (displayName: string) =>
    request<{ display_name: string }>('/profile', {
      method: 'PATCH',
      body: JSON.stringify({ display_name: displayName }),
    }),

  whoami: () => request<WhoamiResponse>('/whoami'),

  // Surfaces
  getSurfaces: (state?: string) =>
    request<Surface[]>(`/surfaces${state ? `?state=${state}` : ''}`),

  getSurface: (id: string) => request<Surface>(`/surfaces/${id}`),

  submitSurface: (id: string, userInput: Record<string, unknown>, decision?: string) =>
    request<SubmitSurfaceResponse>(`/surfaces/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ user_input: userInput, decision }),
    }),

  archiveSurface: (id: string) =>
    request<{ surfaceId: string; archived: boolean }>(`/surfaces/${id}/archive`, { method: 'POST' }),

  dismissSurface: (id: string) =>
    request<SubmitSurfaceResponse>(`/surfaces/${id}/dismiss`, { method: 'POST' }),

  declineSurface: (id: string) =>
    request<SubmitSurfaceResponse>(`/surfaces/${id}/decline`, { method: 'POST' }),

  bulkArchive: (ids: string[]) =>
    request<{ archived: number }>('/surfaces/bulk-archive', {
      method: 'POST',
      body: JSON.stringify({ surface_ids: ids }),
    }),

  // Keys
  getKeys: () => request<ApiKey[]>('/keys'),

  createKey: (keyName: string) =>
    request<CreateKeyResponse>('/keys', {
      method: 'POST',
      body: JSON.stringify({ key_name: keyName }),
    }),

  revokeKey: (keyId: string) =>
    request<{ revoked: boolean }>(`/keys/${keyId}/revoke`, { method: 'POST' }),

  updateKey: (keyId: string, keyName: string) =>
    request<UpdateKeyResponse>(`/keys/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ key_name: keyName }),
    }),

  // Preferences
  getPreferences: () => request<Preferences>('/preferences'),

  updatePreferences: (prefs: Record<string, unknown>) =>
    request<{ saved: boolean }>('/preferences', {
      method: 'PUT',
      body: JSON.stringify(prefs),
    }),

  // Push
  subscribePush: (subscription: PushSubscription) =>
    request<{ subscribed: boolean }>('/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription),
    }),

  unsubscribePush: (endpoint: string) =>
    request<{ unsubscribed: boolean }>('/push/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint }),
    }),

  getVapidKey: () => request<VapidKeyResponse>('/push/vapid-public-key'),

  // Health
  health: () => request<HealthResponse>('/health'),
};
