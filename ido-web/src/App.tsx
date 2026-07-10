import { useEffect, useState } from 'react';
import { useStore } from './stores/useStore';
import { api } from './services/api';
import { useSSE } from './hooks/useSSE';
import { Dashboard } from './components/dashboard/Dashboard';
import { LoginPage } from './components/setup/LoginPage';
import { SetupPage } from './components/setup/SetupPage';
import { SettingsPage } from './components/settings/SettingsPage';
import { navigate } from './utils/navigation';
import { clearAllNotifications, selfHealPushSubscription } from './utils/push';

function useHash() {
  const [hash, setHash] = useState(window.location.hash.replace('#', '') || '');
  useEffect(() => {
    const handler = () => setHash(window.location.hash.replace('#', '') || '');
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  return hash;
}

export default function App() {
  const {
    isDarkMode,
    isAuthenticated,
    theme,
    setTheme,
    setSurfaces,
    setLoading,
    setError,
    setAuth,
    setVersion,
    setAvatarUrl,
    setProfile,
    logout: storeLogout,
  } = useStore();

  const hash = useHash();
  const [checkingSetup, setCheckingSetup] = useState(true);

  // Auto-detect setup or dev mode auto-login
  useEffect(() => {
    api.whoami().then((info) => {
      if (info.tenantId && !isAuthenticated) {
        setAuth(info.tenantId, info.userId || info.tenantId);
        setVersion(info.version || '');
        setAvatarUrl(info.avatarUrl);
        setProfile(info.displayName, info.email, info.tenantDisplayName);
        setCheckingSetup(false);
        // Clear all push notifications on app entry
        clearAllNotifications();
        return;
      }
      if (info.mode === 'dev' && !isAuthenticated) {
        api.login('dev', 'dev').then((result) => {
          setAuth(result.user.tenant_id, result.user.username);
          setVersion(info.version || '');
        }).catch(() => setCheckingSetup(false));
      } else if (info.needsSetup && hash !== 'setup') {
        navigate('setup');
        setCheckingSetup(false);
      } else {
        setCheckingSetup(false);
      }
    }).catch(() => setCheckingSetup(false));
  }, []);

  // Apply dark class whenever isDarkMode changes
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, [isDarkMode]);

  // Listen for system theme changes when in 'system' mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (theme === 'system') setTheme('system'); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, setTheme]);

  // Check for existing auth on mount
  useEffect(() => {
    const stored = localStorage.getItem('ido-auth');
    if (stored) {
      try {
        const { tenantId, userId } = JSON.parse(stored);
        setAuth(tenantId, userId);
      } catch {}
    }
  }, []);

  // SSE connection
  useSSE();

  // Once authenticated: silently repair a missing push subscription and clear
  // stale notifications whenever the app is opened or brought to the foreground.
  useEffect(() => {
    if (!isAuthenticated) return;
    selfHealPushSubscription();
    clearAllNotifications();
    const onVisible = () => {
      if (document.visibilityState === 'visible') clearAllNotifications();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', clearAllNotifications);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', clearAllNotifications);
    };
  }, [isAuthenticated]);

  // Load surfaces on auth
  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    // Check if user needs to create an API key (SaaS mode)
    api
      .getSurfaces()
      .then((surfaces) => {
        setSurfaces(surfaces);
      })
      .catch((err) => {
        if (err.message?.includes('401') || err.message?.includes('Unauthorized') || err.message?.includes('Authentication required')) {
          storeLogout();
          return;
        }
        setError(err.message);
        setLoading(false);
      });
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    if (checkingSetup) return null;
    if (hash === 'setup') return <SetupPage />;
    return <LoginPage />;
  }

  if (hash === 'settings') return <SettingsPage onBack={() => navigate('')} />;

  return <Dashboard />;
}
