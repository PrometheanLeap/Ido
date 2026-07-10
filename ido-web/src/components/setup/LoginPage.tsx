import { useEffect, useState } from 'react';
import { useStore } from '../../stores/useStore';
import { api } from '../../services/api';
import { navigate } from '../../utils/navigation';
import { Logo } from '../shared/Logo';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('');
  const [oidcProviders, setOidcProviders] = useState<string[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const setAuth = useStore((s) => s.setAuth);

  useEffect(() => {
    api.whoami().then((info) => {
      setMode(info.mode);
      if (info.mode === 'saas' || info.mode === 'corporate') {
        fetch('/api/v1/oidc/providers').then(r => r.json()).then(d => {
          setOidcProviders(d.providers || []);
          setStatus('ready');
        }).catch(() => setStatus('ready'));
      } else {
        setStatus('ready');
      }
    }).catch(() => setStatus('ready'));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.login(username, password);
      setAuth(result.user.tenant_id, result.user.username);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const isOidcMode = mode === 'saas' || mode === 'corporate';
  const needsOidcSetup = status === 'ready' && isOidcMode && oidcProviders.length === 0;

  return (
    <div className="min-h-dvh flex items-center justify-center bg-base p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Logo size="lg" />
          <p className="text-secondary text-caption mt-2">AI Human Gateway</p>
        </div>

        {status === 'loading' && (
          <div className="bg-surface border border-border rounded-lg p-6 space-y-3">
            <div className="skeleton h-10 w-3/4 mx-auto rounded-md" />
            <div className="skeleton h-12 w-full rounded-md" />
          </div>
        )}

        {needsOidcSetup && (
          <div className="bg-surface border border-border rounded-lg p-6 space-y-3 text-center">
            <div className="w-12 h-12 mx-auto mb-2 rounded-full bg-accent-error/10 flex items-center justify-center">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" className="text-accent-error">
                <circle cx="11" cy="11" r="9" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M11 7v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="11" cy="15" r="0.75" fill="currentColor"/>
              </svg>
            </div>
            <h2 className="text-heading font-semibold">Setup Required</h2>
            <p className="text-caption text-secondary">Ido is running in <strong>{mode}</strong> mode but no OIDC providers are configured.</p>
            <p className="text-caption text-secondary">Set <code className="text-xs bg-base px-1 py-0.5 rounded">OIDC_GOOGLE_CLIENT_ID</code> / <code className="text-xs bg-base px-1 py-0.5 rounded">OIDC_MICROSOFT_CLIENT_ID</code> and redeploy.</p>
          </div>
        )}

        {status === 'ready' && oidcProviders.length > 0 && (
          <div className="bg-surface border border-border rounded-lg p-6 space-y-3 mb-4">
            <h2 className="text-heading font-semibold text-center">Sign In</h2>
            {oidcProviders.map((p) => (
              <a key={p} href={`/api/v1/oidc/login?provider=${p}`}
                className="w-full flex items-center justify-center gap-3 py-3 border border-border rounded-xl text-body font-medium hover:bg-base transition-colors no-underline text-text press">
                {p === 'google' ? (
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.24-.16-1.82H9v3.44h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.6z"/>
                    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.83.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.97v2.33A8.99 8.99 0 009 18z"/>
                    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.97a8.99 8.99 0 000 8.1l3-2.33z"/>
                    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.34l2.58-2.58C13.46.89 11.43 0 9 0A8.99 8.99 0 00.97 4.95l3 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <rect x="1" y="1" width="7" height="7" fill="#F25022"/>
                    <rect x="10" y="1" width="7" height="7" fill="#7FBA00"/>
                    <rect x="1" y="10" width="7" height="7" fill="#00A4EF"/>
                    <rect x="10" y="10" width="7" height="7" fill="#FFB900"/>
                  </svg>
                )}
                {p === 'google' ? 'Sign in with Google' : 'Sign in with Microsoft'}
              </a>
            ))}
          </div>
        )}

        {status === 'ready' && mode === 'personal' && (
          <form onSubmit={handleLogin} className="bg-surface border border-border rounded-lg p-6 space-y-4">
            <h2 className="text-heading font-semibold">Sign In</h2>
            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-accent-error text-accent-error rounded-md p-3 text-caption">{error}</div>
            )}
            <div>
              <label htmlFor="username" className="block text-label font-medium text-secondary mb-1">Username</label>
              <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-base border border-border rounded-xl text-body focus:ring-2 focus:ring-primary/25 focus:border-primary focus:outline-none" placeholder="Enter username" required />
            </div>
            <div>
              <label htmlFor="password" className="block text-label font-medium text-secondary mb-1">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-base border border-border rounded-xl text-body focus:ring-2 focus:ring-primary/25 focus:border-primary focus:outline-none" placeholder="Enter password" required />
            </div>
            <button type="submit" disabled={loading}
              className="w-full py-3 btn-gradient text-white rounded-xl font-semibold text-body disabled:opacity-40 press">
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        {status === 'ready' && mode === 'personal' && (
          <p className="text-center mt-4 text-caption text-secondary">
            <button onClick={() => navigate('setup')} className="text-primary hover:underline bg-transparent border-none cursor-pointer p-0">Create an account</button>
          </p>
        )}
      </div>
    </div>
  );
}
