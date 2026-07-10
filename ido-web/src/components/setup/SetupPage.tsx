import { useState } from 'react';
import { useStore } from '../../stores/useStore';
import { api } from '../../services/api';
import { navigate } from '../../utils/navigation';
import { Logo } from '../shared/Logo';

export function SetupPage() {
  const [step, setStep] = useState<'account' | 'apikey' | 'done'>('account');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyName, setKeyName] = useState('');
  const [copied, setCopied] = useState(false);
  const [userInfo, setUserInfo] = useState<{ tenantId: string; username: string } | null>(null);
  const setAuth = useStore((s) => s.setAuth);

  const goToDashboard = () => {
    if (userInfo) setAuth(userInfo.tenantId, userInfo.username);
    navigate('');
  };

  const passwordsMatch = confirmPassword.length === 0 ? null : password === confirmPassword;
  const passwordMeetsLength = password.length === 0 || password.length >= 8;

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      const result = await api.setup(username, password);
      setUserInfo({ tenantId: result.user.tenant_id, username: result.user.username });
      setStep('apikey');
    } catch (err: any) {
      setError(err.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateKey = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await api.createKey(keyName.trim() || '');
      setApiKey(result.api_key);
      setStep('done');
    } catch (err: any) {
      setError(err.message || 'Failed to create key');
    } finally {
      setLoading(false);
    }
  };

  const copyKey = () => {
    if (apiKey) {
      navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-dvh flex items-center justify-center bg-base p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Logo size="lg" />
          <p className="text-secondary text-caption mt-2">
            {step === 'account' ? 'Create your account' : step === 'apikey' ? 'Create an API key' : 'Ready to go'}
          </p>
        </div>

        {step === 'account' && (
          <form onSubmit={handleSetup} className="bg-surface border border-border rounded-lg p-6 space-y-4">
            <h2 className="text-heading font-semibold">Setup</h2>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-accent-error text-accent-error rounded-md p-3 text-caption">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="username" className="block text-label font-medium text-secondary mb-1">Username</label>
              <input id="username" type="text" value={username} onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 bg-base border border-border rounded-md text-body"
                placeholder="Choose a username" required minLength={3} />
            </div>

            <div>
              <label htmlFor="password" className="block text-label font-medium text-secondary mb-1">Password</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-base border border-border rounded-md text-body"
                placeholder="At least 8 characters" required minLength={8} />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-label font-medium text-secondary mb-1">Confirm password</label>
              <div className="relative">
                <input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  className={`w-full px-3 py-2 bg-base border rounded-md text-body pr-8 ${passwordsMatch === false ? 'border-accent-error' : passwordsMatch === true ? 'border-accent-success' : 'border-border'}`}
                  placeholder="Re-enter your password" required minLength={8} />
                {passwordsMatch !== null && (
                  <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-sm ${passwordsMatch ? 'text-accent-success' : 'text-accent-error'}`}>
                    {passwordsMatch ? '✓' : '✕'}
                  </span>
                )}
              </div>
            </div>

            <button type="submit" disabled={loading}
              className="w-full py-2 bg-primary text-white rounded-md font-medium text-body hover:opacity-90 disabled:opacity-50">
              {loading ? 'Creating…' : 'Create Account'}
            </button>
          </form>
        )}

        {step === 'apikey' && (
          <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
            <h2 className="text-heading font-semibold">API Key</h2>
            <p className="text-caption text-secondary">Your agents need an API key to send you surfaces. Create one now — you can add more later in Settings.</p>

            {error && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-accent-error text-accent-error rounded-md p-3 text-caption">{error}</div>
            )}

            <div>
              <label htmlFor="keyName" className="block text-label font-medium text-secondary mb-1">Key name</label>
              <input id="keyName" type="text" value={keyName} onChange={(e) => setKeyName(e.target.value)}
                className="w-full px-3 py-2 bg-base border border-border rounded-md text-body"
                placeholder="e.g. Deploy Bot" />
            </div>

            <div className="flex gap-2">
              <button onClick={handleCreateKey} disabled={loading}
                className="flex-1 py-2 bg-primary text-white rounded-md font-medium text-body hover:opacity-90 disabled:opacity-50">
                {loading ? 'Creating…' : 'Create Key'}
              </button>
              <button onClick={() => { navigate(''); }}
                className="px-4 py-2 border border-border text-secondary rounded-md text-caption hover:text-primary">
                Skip for now
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-accent-success/10 text-accent-success flex items-center justify-center">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <h2 className="text-heading font-semibold">Account created</h2>
            </div>

            <div className="bg-base border border-border rounded-md p-3">
              <p className="text-label text-secondary mb-1">Your API key</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-caption text-text break-all font-mono bg-transparent p-0">{apiKey}</code>
                <button onClick={copyKey} className="flex-shrink-0 p-1 text-secondary hover:text-primary rounded transition-colors" title="Copy">
                  {copied ? (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2" stroke="currentColor" strokeWidth="1.3"/></svg>
                  )}
                </button>
              </div>
            </div>

            <p className="text-caption text-secondary">Store this key securely. You won't see it again. Use it to connect your AI agents via A2A, MCP, or REST.</p>

            <button onClick={goToDashboard}
              className="w-full py-2.5 bg-primary text-white rounded-md font-medium text-body hover:opacity-90 transition-opacity">
              Go to Dashboard
            </button>
          </div>
        )}

        {step === 'account' && (
          <p className="text-center mt-4 text-caption text-secondary">
            <button onClick={() => navigate('')} className="text-primary hover:underline bg-transparent border-none cursor-pointer p-0">Already have an account? Sign in</button>
          </p>
        )}
      </div>
    </div>
  );
}
