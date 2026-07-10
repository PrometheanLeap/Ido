import { useState } from 'react';
import { api } from '../../services/api';

interface KeyPromptModalProps {
  onClose: () => void;
  mode: string;
}

export function KeyPromptModal({ onClose, mode }: KeyPromptModalProps) {
  const [keyName, setKeyName] = useState('');
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const createKey = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await api.createKey(keyName.trim() || '');
      setApiKey(result.api_key);
    } catch (err: any) {
      setError(err.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  const copyKey = () => {
    if (apiKey) { navigator.clipboard.writeText(apiKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface mx-4 mb-4 sm:mb-0 p-6 rounded-xl border border-border shadow-lg max-w-sm w-full space-y-4">
        <h2 className="text-heading font-semibold text-center">Connect Your First Agent</h2>
        <p className="text-caption text-secondary text-center">
          {mode === 'saas' ? 'Welcome to Ido! Create an API key so your AI agents can send you surfaces.' : 'Your agents need an API key to send you surfaces. Create one now.'}
        </p>

        {!apiKey ? (
          <>
            {error && <div className="bg-red-50 dark:bg-red-900/20 border border-accent-error text-accent-error rounded-md p-2 text-caption">{error}</div>}
            <input type="text" value={keyName} onChange={(e) => setKeyName(e.target.value)}
              className="w-full px-3 py-2 bg-base border border-border rounded-md text-body" placeholder="Key name (e.g. Deploy Bot)" />
            <div className="flex gap-2">
              <button onClick={createKey} disabled={loading}
                className="flex-1 py-2 bg-primary text-white rounded-md font-medium text-body hover:opacity-90 disabled:opacity-50">
                {loading ? 'Creating…' : 'Create Key'}
              </button>
              <button onClick={onClose} className="px-4 py-2 border border-border text-secondary rounded-md text-caption hover:text-primary">Skip</button>
            </div>
          </>
        ) : (
          <>
            <div className="bg-accent-warning/10 border border-accent-warning rounded-lg p-3">
              <p className="text-label text-accent-warning mb-1 font-medium">Copy this key now — you won't see it again.</p>
              <div className="flex gap-2 mt-2">
                <code className="flex-1 px-2 py-1 bg-base rounded text-caption break-all font-mono">{apiKey}</code>
                <button onClick={copyKey} className="px-3 py-1 bg-primary text-white rounded text-caption flex-shrink-0">{copied ? 'Copied!' : 'Copy'}</button>
              </div>
            </div>
            <p className="text-caption text-secondary text-center">Use this key in the <code className="bg-base px-1 rounded">X-Ido-Api-Key</code> header when connecting agents.</p>
            <button onClick={onClose} className="w-full py-2.5 bg-primary text-white rounded-md font-medium text-body hover:opacity-90">Go to Dashboard</button>
          </>
        )}
      </div>
    </div>
  );
}
