import { create } from 'zustand';

export interface Surface {
  surface_id: string;
  tenant_id: string;
  task_id: string;
  type: 'form' | 'approval' | 'notification';
  state: string;
  archived: number;
  title: string;
  components_json?: string;
  schema_json?: string;
  data_json?: string;
  context?: string | null;
  user_id?: string | null;
  source?: string | null;
  severity?: string | null;
  expires_at?: string | null;
  viewed_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface AppState {
  surfaces: Surface[];
  selectedSurface: Surface | null;
  theme: 'system' | 'light' | 'dark';
  isDarkMode: boolean;
  isAuthenticated: boolean;
  tenantId: string | null;
  userId: string | null;
  loading: boolean;
  isRefreshing: boolean;
  error: string | null;
  sseConnected: boolean;
  version: string;
  avatarUrl: string | null;
  displayName: string | null;
  tenantDisplayName: string | null;
  email: string | null;
  setVersion: (v: string) => void;
  setAvatarUrl: (url: string | null) => void;
  setProfile: (displayName: string | null, email: string | null, tenantDisplayName: string | null) => void;
  setDisplayName: (name: string) => void;
  setSurfaces: (surfaces: Surface[]) => void;
  addOrUpdateSurface: (surface: Partial<Surface> & { surface_id: string }) => void;
  removeSurface: (surfaceId: string) => void;
  selectSurface: (surface: Surface | null) => void;
  setTheme: (theme: 'system' | 'light' | 'dark') => void;
  toggleDarkMode: () => void;
  setAuth: (tenantId: string, userId: string) => void;
  setLoading: (loading: boolean) => void;
  setRefreshing: (refreshing: boolean) => void;
  setError: (error: string | null) => void;
  setSseConnected: (connected: boolean) => void;
  logout: () => void;
}

function resolveIsDark(theme: string): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(theme: string) {
  document.documentElement.classList.toggle('dark', resolveIsDark(theme));
}

const savedTheme = (localStorage.getItem('ido-theme') as 'system' | 'light' | 'dark') || 'system';

export const useStore = create<AppState>((set) => ({
  surfaces: [],
  selectedSurface: null,
  theme: savedTheme,
  isDarkMode: resolveIsDark(savedTheme),
  isAuthenticated: false,
  tenantId: null,
  userId: null,
  loading: true,
  isRefreshing: false,
  error: null,
  sseConnected: false,
  version: '',
  avatarUrl: null,
  displayName: null,
  tenantDisplayName: null,
  email: null,

  setSurfaces: (surfaces) => set({ surfaces, loading: false }),

  addOrUpdateSurface: (surface) =>
    set((state) => {
      const existing = state.surfaces.findIndex(
        (s) => s.surface_id === surface.surface_id,
      );
      if (existing >= 0) {
        // Merge — preserves heavy blobs (components_json/schema_json/data_json)
        // when a lightweight summary update arrives via SSE.
        const updated = [...state.surfaces];
        updated[existing] = { ...updated[existing], ...surface };
        return { surfaces: updated };
      }
      return { surfaces: [surface as Surface, ...state.surfaces] };
    }),

  removeSurface: (surfaceId) =>
    set((state) => ({
      surfaces: state.surfaces.filter((s) => s.surface_id !== surfaceId),
    })),

  selectSurface: (surface) => set({ selectedSurface: surface }),

  setTheme: (theme) =>
    set(() => {
      localStorage.setItem('ido-theme', theme);
      applyTheme(theme);
      return { theme, isDarkMode: resolveIsDark(theme) };
    }),

  toggleDarkMode: () =>
    set((state) => {
      const next = state.isDarkMode ? 'light' : 'dark';
      localStorage.setItem('ido-theme', next);
      applyTheme(next);
      return { theme: next as 'system' | 'light' | 'dark', isDarkMode: !state.isDarkMode };
    }),

  setAuth: (tenantId, userId) => {
    localStorage.setItem('ido-auth', JSON.stringify({ tenantId, userId }));
    set({ isAuthenticated: true, tenantId, userId });
  },

  setLoading: (loading) => set({ loading }),

  setRefreshing: (isRefreshing) => set({ isRefreshing }),

  setError: (error) => set({ error }),

  setSseConnected: (connected) => set({ sseConnected: connected }),

  setVersion: (version) => set({ version }),
  setAvatarUrl: (avatarUrl) => set({ avatarUrl }),
  setProfile: (displayName, email, tenantDisplayName) => set({ displayName, email, tenantDisplayName }),
  setDisplayName: (displayName) => set({ displayName }),

  logout: () => {
    localStorage.removeItem('ido-auth');
    sessionStorage.removeItem('ido-key-prompt-shown');
    set({
      isAuthenticated: false,
      tenantId: null,
      userId: null,
      surfaces: [],
      version: '',
      isRefreshing: false,
      avatarUrl: null,
      displayName: null,
      tenantDisplayName: null,
      email: null,
    });
  },
}));
