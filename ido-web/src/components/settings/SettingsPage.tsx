import { useState, useEffect } from 'react';
import { useStore } from '../../stores/useStore';
import { api } from '../../services/api';
import { navigate } from '../../utils/navigation';
import { Logo } from '../shared/Logo';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { subscribeToPush, unsubscribeFromPush, reconcilePushState } from '../../utils/push';

export function SettingsPage({ onBack }: { onBack?: () => void }) {
  const { logout, theme, setTheme, sseConnected, version, displayName, email, avatarUrl, userId, setDisplayName } = useStore();
  const [settingsTab, setSettingsTab] = useState<'app' | 'api' | 'about'>('app');
  const [keys, setKeys] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<any>({});
  const [copyText, setCopyText] = useState('');
  const [mode, setMode] = useState<string>('dev');
  const [pushEnabled, setPushEnabled] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editingKeyName, setEditingKeyName] = useState('');
  const [keyNameSaving, setKeyNameSaving] = useState(false);

  const { platform: installPlatform, promptReady, triggerInstall } = useInstallPrompt();

  useEffect(() => {
    api.whoami().then((info) => {
      setMode(info.mode);
      if (info.mode !== 'dev') {
        api.getKeys().then(setKeys).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.getPreferences().then(async (p) => {
      setPrefs(p);
      // Reflect the true per-device subscription state, not just the server
      // preference (self-heals a missing subscription when already permitted).
      const realEnabled = await reconcilePushState(!!p.push_enabled);
      setPushEnabled(realEnabled);
    }).catch(() => {});
  }, [settingsTab]);

  const createKey = async () => {
    try {
      const result = await api.createKey(newKeyName.trim() || '');
      setNewKey(result.api_key);
      setNewKeyName('');
      const updated = await api.getKeys();
      setKeys(updated);
    } catch (err: any) {
      alert(err.message);
    }
  };

  const revokeKey = async (keyId: string) => {
    await api.revokeKey(keyId);
    setKeys((prev) => prev.filter((k) => k.key_id !== keyId));
  };

  const saveKeyName = async (keyId: string) => {
    const trimmed = editingKeyName.trim();
    if (!trimmed) return;
    setKeyNameSaving(true);
    try {
      await api.updateKey(keyId, trimmed);
      setKeys((prev) => prev.map((k) => k.key_id === keyId ? { ...k, key_name: trimmed } : k));
      setEditingKeyId(null);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setKeyNameSaving(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopyText('Copied!');
    setTimeout(() => setCopyText(''), 2000);
  };

  return (
    <div className="min-h-dvh bg-base">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-base/80 backdrop-blur border-b border-border px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Logo size="md" />
          {onBack && (
            <button
              onClick={onBack}
              className="text-secondary hover:text-primary p-1 border border-border rounded-lg"
              aria-label="Close settings"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-3">
        {/* Settings tabs — segmented control */}
        {(() => {
          const tabs = (['app', 'api', 'about'] as const).filter(tab => tab !== 'api' || mode !== 'dev');
          const activeIndex = Math.max(0, tabs.indexOf(settingsTab));
          const label = (tab: string) => tab === 'app' ? 'App' : tab === 'api' ? 'API Keys' : 'About';
          return (
            <div className="segmented" role="tablist">
              <div
                className="segmented-thumb"
                style={{ width: `calc((100% - 6px) / ${tabs.length})`, transform: `translateX(${activeIndex * 100}%)` }}
              />
              {tabs.map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={settingsTab === tab}
                  data-active={settingsTab === tab}
                  onClick={() => setSettingsTab(tab)}
                  className="segmented-item press-sm"
                >
                  {label(tab)}
                </button>
              ))}
            </div>
          );
        })()}
      </div>

      <div className="max-w-2xl mx-auto px-4 py-4 pb-24 space-y-5">
        {/* ── App Settings ── */}
        {settingsTab === 'app' && (
          <>
            {/* Profile */}
            <section>
              <h2 className="text-label font-semibold uppercase tracking-wider text-secondary mb-2 px-1">Profile</h2>
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-heading font-semibold overflow-hidden flex-shrink-0">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    ) : (
                      (displayName || email || userId || '?').charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {editingName ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={nameInput}
                          onChange={(e) => setNameInput(e.target.value)}
                          className="flex-1 px-2 py-1 bg-base border border-border rounded text-body"
                          placeholder="Your name"
                          autoFocus
                          maxLength={128}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              const trimmed = nameInput.trim();
                              if (trimmed) {
                                setNameSaving(true);
                                api.updateProfile(trimmed).then((r) => {
                                  setDisplayName(r.display_name);
                                  setEditingName(false);
                                }).finally(() => setNameSaving(false));
                              }
                            }
                            if (e.key === 'Escape') setEditingName(false);
                          }}
                        />
                        <button
                          onClick={() => {
                            const trimmed = nameInput.trim();
                            if (trimmed) {
                              setNameSaving(true);
                              api.updateProfile(trimmed).then((r) => {
                                setDisplayName(r.display_name);
                                setEditingName(false);
                              }).finally(() => setNameSaving(false));
                            }
                          }}
                          disabled={nameSaving || !nameInput.trim()}
                          className="text-label text-primary hover:underline disabled:opacity-50"
                        >
                          {nameSaving ? '…' : 'Save'}
                        </button>
                        <button onClick={() => setEditingName(false)} className="text-label text-secondary hover:text-primary">Cancel</button>
                      </div>
                    ) : (
                      <>
                        {displayName && <p className="text-body font-semibold truncate">{displayName}</p>}
                        {email && <p className="text-caption text-secondary truncate">{email}</p>}
                        <button
                          onClick={() => { setNameInput(displayName || ''); setEditingName(true); }}
                          className="text-label text-primary hover:underline mt-0.5"
                        >
                          Edit name
                        </button>
                      </>
                    )}
                  </div>
                  {mode !== 'dev' && (
                    <button onClick={async () => { await api.logout(); logout(); }} className="text-caption text-accent-error border border-accent-error/40 hover:bg-accent-error/5 transition-colors rounded-md px-2 py-0.5 flex-shrink-0">
                      Sign out
                    </button>
                  )}
                </div>
              </div>
            </section>

            {/* Install App */}
            <section>
              <h2 className="text-label font-semibold uppercase tracking-wider text-secondary mb-2 px-1">Install App</h2>
              <div className="bg-surface border border-border rounded-lg p-4">
                {installPlatform === 'installed' && (
                  <p className="text-body text-accent-success flex items-center gap-2">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3"/>
                      <path d="M5 8l2 2.5L11 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Installed — Ido is on your home screen.
                  </p>
                )}
                {installPlatform === 'chrome' && (
                  <>
                    <p className="text-body mb-3">Add Ido to your device for quick access and push notifications.</p>
                    {promptReady ? (
                      <button onClick={triggerInstall} className="w-full py-2.5 bg-base border border-accent-success text-accent-success rounded-xl font-semibold text-body hover:bg-accent-success/5 transition-colors press">
                        Install
                      </button>
                    ) : (
                      <p className="text-caption text-secondary">Use the install icon (⊕) in your browser's address bar to install.</p>
                    )}
                  </>
                )}
                {installPlatform === 'safari-ios' && (
                  <>
                    <p className="text-body mb-3">Tap the Share button below and select “Add to Home Screen”.</p>
                    <div className="flex items-center gap-2">
                      <div className="bg-base border border-border rounded-lg px-3 py-2 flex items-center gap-1.5">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <path d="M12 3v13M8 7l4-4 4 4" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round"/>
                        </svg>
                        <span className="text-label text-primary font-medium">Share</span>
                      </div>
                      <span className="text-secondary text-caption">→</span>
                      <span className="text-label text-secondary">Add to Home Screen</span>
                    </div>
                  </>
                )}
                {installPlatform === 'other' && (
                  <p className="text-body text-secondary">Your browser doesn’t support automatic installation. Bookmark this page for quick access.</p>
                )}
              </div>
            </section>

            {/* Display */}
            <section>
              <h2 className="text-label font-semibold uppercase tracking-wider text-secondary mb-2 px-1">Display</h2>
              <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
                <div>
                  <span className="text-body block mb-3">Theme</span>
                  <div className="flex gap-2">
                    {([
                      { key: 'system', label: 'System', icon: 'monitor' },
                      { key: 'light', label: 'Light', icon: 'sun' },
                      { key: 'dark', label: 'Dark', icon: 'moon' },
                    ] as const).map(({ key, label, icon }) => (
                      <button
                        key={key}
                        onClick={() => setTheme(key)}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-caption rounded-lg border transition-colors ${
                          theme === key
                            ? 'bg-primary/10 border-primary text-primary font-medium'
                            : 'border-border text-secondary hover:text-primary hover:border-primary/30'
                        }`}
                      >
                        {icon === 'monitor' ? (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><rect x="1" y="1.5" width="12" height="9" rx="1" stroke="currentColor" strokeWidth="1.1"/><line x1="4" y1="13" x2="10" y2="13" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/><line x1="7" y1="10.5" x2="7" y2="13" stroke="currentColor" strokeWidth="1.1"/></svg>
                        ) : icon === 'sun' ? (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.1"/><path d="M7 1v1.5M7 11.5V13M13 7h-1.5M2.5 7H1M11.24 2.76l-1.06 1.06M3.82 10.18l-1.06 1.06M11.24 11.24l-1.06-1.06M3.82 3.82l-1.06-1.06" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5 2.5a5 5 0 005.5 8.02A5 5 0 115 2.5z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        )}
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            {/* Notifications */}
            <section>
              <h2 className="text-label font-semibold uppercase tracking-wider text-secondary mb-2 px-1">Notifications</h2>
              <div className="bg-surface border border-border rounded-lg p-4 space-y-4">
                {/* Push enabled toggle */}
                <label className="flex items-center justify-between">
                  <span className="text-body">Push Notifications</span>
                  <button
                    type="button"
                    onClick={() => {
                      const enabling = !pushEnabled;
                      // Optimistic UI; reconcile against the real result below.
                      setPushEnabled(enabling);

                      if (enabling) {
                        (async () => {
                          const ok = await subscribeToPush();
                          // Only persist the preference if the device is truly
                          // subscribed; otherwise revert the toggle.
                          setPushEnabled(ok);
                          if (ok) {
                            setPrefs((p: any) => ({ ...p, push_enabled: 1 }));
                            api.updatePreferences({ push_enabled: 1 }).catch(() => {});
                          }
                        })();
                      } else {
                        setPrefs((p: any) => ({ ...p, push_enabled: 0 }));
                        api.updatePreferences({ push_enabled: 0 }).catch(() => {});
                        unsubscribeFromPush();
                      }
                    }}
                    className={`w-11 h-6 rounded-full transition-all duration-200 relative ${pushEnabled ? 'bg-primary' : 'bg-border'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${pushEnabled ? 'translate-x-5 left-0.5' : 'translate-x-0 left-0.5'}`} />
                  </button>
                </label>

                <label className="flex items-center justify-between">
                  <span className="text-body">Forms</span>
                  <button
                    type="button"
                    onClick={() => setPrefs((p: any) => { const next = { ...p, push_forms: p.push_forms ? 0 : 1 }; api.updatePreferences(next).catch(() => {}); return next; })}
                    className={`w-11 h-6 rounded-full transition-colors relative ${prefs.push_forms !== 0 ? 'bg-primary' : 'bg-border'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${prefs.push_forms !== 0 ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-body">Approvals</span>
                  <button
                    type="button"
                    onClick={() => setPrefs((p: any) => { const next = { ...p, push_approvals: p.push_approvals ? 0 : 1 }; api.updatePreferences(next).catch(() => {}); return next; })}
                    className={`w-11 h-6 rounded-full transition-colors relative ${prefs.push_approvals !== 0 ? 'bg-primary' : 'bg-border'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${prefs.push_approvals !== 0 ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </label>
                <label className="flex items-center justify-between">
                  <span className="text-body">Notifications</span>
                  <button
                    type="button"
                    onClick={() => setPrefs((p: any) => { const next = { ...p, push_notifications: p.push_notifications ? 0 : 1 }; api.updatePreferences(next).catch(() => {}); return next; })}
                    className={`w-11 h-6 rounded-full transition-colors relative ${prefs.push_notifications !== 0 ? 'bg-primary' : 'bg-border'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${prefs.push_notifications !== 0 ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </label>
                <div>
                  <label className="block text-body mb-1">Minimum severity</label>
                  <select value={prefs.push_severity_min || 'info'} onChange={(e) => { const next = { ...prefs, push_severity_min: e.target.value }; setPrefs(next); api.updatePreferences(next).catch(() => {}); }} className="w-full px-3 py-2 bg-base border border-border rounded-md text-body">
                    <option value="info">Info</option>
                    <option value="warning">Warning</option>
                    <option value="error">Error</option>
                    <option value="critical">Critical only</option>
                  </select>
                </div>

                <div className="border-t border-border pt-3">
                  <label className="flex items-center justify-between">
                  <span className="text-body">Quiet Hours</span>
                  <button
                    type="button"
                    onClick={() => setPrefs((p: any) => { const next = { ...p, quiet_hours_enabled: p.quiet_hours_enabled ? 0 : 1 }; api.updatePreferences(next).catch(() => {}); return next; })}
                    className={`w-11 h-6 rounded-full transition-all duration-200 relative ${prefs.quiet_hours_enabled ? 'bg-primary' : 'bg-border'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${prefs.quiet_hours_enabled ? 'translate-x-5 left-0.5' : 'translate-x-0 left-0.5'}`} />
                  </button>
                </label>
                {!!prefs.quiet_hours_enabled && (
                  <>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-label text-secondary mb-1">Start</label>
                        <input type="time" value={prefs.quiet_start || '22:00'}
                          onChange={(e) => { const next = { ...prefs, quiet_start: e.target.value }; setPrefs(next); api.updatePreferences(next).catch(() => {}); }}
                          className="w-full px-3 py-2 bg-base border border-border rounded-md text-body" />
                      </div>
                      <div className="flex-1">
                        <label className="block text-label text-secondary mb-1">End</label>
                        <input type="time" value={prefs.quiet_end || '07:00'}
                          onChange={(e) => { const next = { ...prefs, quiet_end: e.target.value }; setPrefs(next); api.updatePreferences(next).catch(() => {}); }}
                          className="w-full px-3 py-2 bg-base border border-border rounded-md text-body" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-label text-secondary mb-2">Days</label>
                      <div className="flex flex-wrap gap-1.5">
                        {(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as const).map((day) => {
                          const days: string[] = (() => { try { return JSON.parse(prefs.quiet_days || '["Mon","Tue","Wed","Thu","Fri"]'); } catch { return ['Mon','Tue','Wed','Thu','Fri']; } })();
                          const active = days.includes(day);
                          return (
                            <button
                              key={day}
                              type="button"
                              onClick={() => {
                                const nextDays = active ? days.filter((d) => d !== day) : [...days, day];
                                const next = { ...prefs, quiet_days: JSON.stringify(nextDays) };
                                setPrefs(next);
                                api.updatePreferences(next).catch(() => {});
                              }}
                              className={`px-2.5 py-1 rounded-md text-label font-medium transition-colors ${active ? 'bg-primary text-white' : 'bg-base border border-border text-secondary hover:border-primary/30'}`}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
                </div>
              </div>
            </section>

          </>
        )}

        {/* ── API ── */}
        {settingsTab === 'api' && (
          <>
            {/* API Keys */}
            <section>
              <h2 className="text-label font-semibold uppercase tracking-wider text-secondary mb-3 px-1">{mode === 'corporate' ? 'Tenant API Keys' : 'Your API Keys'}</h2>
              <p className="text-caption text-secondary mb-4">
                {mode === 'corporate'
                  ? 'Tenant keys are shared across your organization. Only admins can manage them.'
                  : 'API keys let AI agents connect to Ido. Keep them secret.'}
              </p>
              {keys.length === 0 && (
                <div className="text-center py-8 text-secondary text-caption">
                  <div className="text-display mb-2 opacity-30">🔑</div>
                  <p>No API keys yet.</p>
                  <p className="mt-1">Create one to connect your first agent.</p>
                </div>
              )}
              <div className="space-y-2 mb-4">
                {keys.map((key) => (
                  <div key={key.key_id} className="bg-surface border border-border rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {editingKeyId === key.key_id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editingKeyName}
                            onChange={(e) => setEditingKeyName(e.target.value)}
                            className="flex-1 px-2 py-1 bg-base border border-border rounded text-body"
                            placeholder="Key name"
                            maxLength={128}
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveKeyName(key.key_id);
                              if (e.key === 'Escape') setEditingKeyId(null);
                            }}
                          />
                          <button
                            onClick={() => saveKeyName(key.key_id)}
                            disabled={keyNameSaving || !editingKeyName.trim()}
                            className="text-label text-primary hover:underline flex-shrink-0 disabled:opacity-50"
                          >
                            {keyNameSaving ? '…' : 'Save'}
                          </button>
                          <button onClick={() => setEditingKeyId(null)} className="text-label text-secondary hover:text-primary flex-shrink-0">Cancel</button>
                        </div>
                      ) : (
                        <>
                          <p className="text-body font-medium">
                            {key.key_name}
                            <button
                              onClick={() => { setEditingKeyId(key.key_id); setEditingKeyName(key.key_name); }}
                              className="ml-2 text-secondary hover:text-primary align-middle"
                              title="Edit key name"
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="inline-block"><path d="M8.5 1.5l2 2L3.5 10.5H1.5v-2L8.5 1.5z" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            </button>
                          </p>
                          <p className="text-caption text-secondary">{key.key_id} · Created {new Date(key.created_at).toLocaleDateString()}</p>
                        </>
                      )}
                    </div>
                    {editingKeyId !== key.key_id && (
                      <button onClick={() => revokeKey(key.key_id)} className="text-caption text-accent-error border border-accent-error/40 hover:bg-accent-error/5 transition-colors rounded-md px-2 py-0.5 flex-shrink-0">Revoke</button>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input type="text" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="Key name (optional)" className="flex-1 px-3 py-2 bg-base border border-border rounded-md text-body" />
                <button onClick={createKey} className="px-4 py-2 bg-base border border-primary text-primary rounded-md text-body font-medium hover:bg-primary/5 transition-colors">Create</button>
              </div>
              {newKey && (
                <div className="mt-4 p-4 bg-accent-warning/10 border border-accent-warning rounded-lg">
                  <p className="text-body font-medium text-accent-warning mb-2">Copy this key now. You won't see it again.</p>
                  <div className="flex gap-2">
                    <code className="flex-1 px-3 py-2 bg-base rounded text-caption break-all">{newKey}</code>
                    <button onClick={() => copyToClipboard(newKey)} className="px-3 py-2 bg-primary text-white rounded text-caption">{copyText || 'Copy'}</button>
                  </div>
                </div>
              )}
            </section>

            {/* Agent Connection Info */}
            <section>
              <h2 className="text-label font-semibold uppercase tracking-wider text-secondary mb-3 px-1">Connecting an Agent</h2>
              <div className="space-y-3">
                {/* MCP */}
                <div className="bg-surface border border-border rounded-lg p-4 text-caption">
                  <p className="text-body font-medium mb-2">MCP (Model Context Protocol)</p>
                  <code className="block px-3 py-2 bg-base rounded text-caption break-all mb-2">POST /api/v1/mcp</code>
                  <p className="text-secondary text-caption">Use an API key in the <code className="bg-base px-1 rounded">X-Ido-Api-Key</code> header. Call <code className="bg-base px-1 rounded">ido_get_skills_guide</code> first to learn available components and templates.</p>
                </div>
                {/* A2A */}
                <div className="bg-surface border border-border rounded-lg p-4 text-caption">
                  <p className="text-body font-medium mb-2">A2A (Agent-to-Agent JSON-RPC)</p>
                  <code className="block px-3 py-2 bg-base rounded text-caption break-all mb-2">POST /api/v1/a2a</code>
                  <p className="text-secondary text-caption">Use an API key in the <code className="bg-base px-1 rounded">X-Ido-Api-Key</code> header. Call <code className="bg-base px-1 rounded">skills/guide</code> first to learn available components and templates.</p>
                </div>
                {/* REST */}
                <div className="bg-surface border border-border rounded-lg p-4 text-caption">
                  <p className="text-body font-medium mb-2">REST (simple HTTP)</p>
                  <code className="block px-3 py-2 bg-base rounded text-caption break-all mb-2">POST /api/v1/surfaces</code>
                  <p className="text-secondary text-caption">Minimal setup for webhooks and basic integrations. Use the API key in the <code className="bg-base px-1 rounded">X-Ido-Api-Key</code> header.</p>
                </div>
              </div>
            </section>
          </>
        )}

        {/* ── About ── */}
        {settingsTab === 'about' && (
          <section className="flex flex-col min-h-[calc(100dvh-11rem)] py-3">
            {/* Hero: large animated logo + name */}
            <div className="flex flex-col items-center text-center space-y-1 pt-2 pb-3">
              <Logo size="lg" animate />
              <p className="text-caption text-secondary opacity-60">v{version || '…'}</p>
            </div>

            {/* Description */}
            <p className="text-body text-secondary text-center max-w-xs mx-auto leading-relaxed mb-4">
              Ido is your personal inbox for AI — a private space where agents can send you forms, approvals, and updates, and you respond right from your device.
            </p>

            {/* Status row */}
            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
              <div className="bg-surface border border-border rounded-lg p-2.5 text-center">
                <p className="text-label font-medium mb-0.5">Mode</p>
                <span className={`text-label font-semibold px-2 py-0.5 rounded-full ${
                  mode === 'dev' ? 'bg-accent-warning/10 text-accent-warning' :
                  mode === 'personal' ? 'bg-accent-info/10 text-accent-info' :
                  mode === 'saas' ? 'bg-accent-success/10 text-accent-success' :
                  'bg-primary/10 text-primary'
                }`}>{mode}</span>
              </div>
              <div className="bg-surface border border-border rounded-lg p-2.5 text-center">
                <p className="text-label font-medium mb-0.5">License</p>
                <span className={`text-label font-semibold px-2 py-0.5 rounded-full ${
                  mode === 'saas' || mode === 'corporate'
                    ? 'bg-accent-success/10 text-accent-success'
                    : 'bg-secondary/10 text-secondary'
                }`}>{mode === 'saas' || mode === 'corporate' ? 'Licensed' : 'Free'}</span>
              </div>
              <div className="bg-surface border border-border rounded-lg p-2.5 text-center">
                <p className="text-label font-medium mb-0.5">Status</p>
                <span className={`flex items-center justify-center gap-1 text-label ${sseConnected ? 'text-accent-success' : 'text-accent-warning'}`}>
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${sseConnected ? 'bg-accent-success' : 'bg-accent-warning'}`} />
                  {sseConnected ? 'Connected' : 'Offline'}
                </span>
              </div>
            </div>

            {/* Footer — above open source */}
            <div className="mx-4 mt-3 text-center space-y-1.5 flex-shrink-0">
              <a href="https://github.com/prometheanleap/ido" target="_blank" rel="noopener noreferrer" className="text-caption text-primary hover:underline inline-flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
                prometheanleap/ido
              </a>
              <p className="text-caption text-secondary">
                Built by Andrew Herbert &middot; <a href="https://prometheanleap.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">prometheanleap.com</a>
              </p>
              <p className="text-caption text-secondary">
                Licensed under <span className="text-primary">BUSL-1.1</span> &middot; free for non-production use
              </p>
              <a href="mailto:support@prometheanleap.com" className="text-caption text-primary hover:underline">support@prometheanleap.com</a>
              <p className="text-caption text-secondary opacity-60">&copy; {new Date().getFullYear()} Promethean Leap. All rights reserved.</p>
            </div>

            {/* Open source — fills remaining space */}
            <div className="mx-4 mt-3 border border-border rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
              <div className="px-3 py-2 border-b border-border flex-shrink-0">
                <p className="text-label text-secondary font-medium">Open Source</p>
              </div>
              <div className="overflow-y-auto flex-1">
                <table className="w-full text-caption">
                  <tbody>
                    {[
                      ['React', '19', 'MIT'],
                      ['Vite', '6', 'MIT'],
                      ['Tailwind CSS', '4', 'MIT'],
                      ['Hono', '4.6', 'MIT'],
                      ['Kysely', '0.27', 'MIT'],
                      ['Zod', '3.23', 'MIT'],
                      ['better-sqlite3', '11', 'MIT'],
                      ['pg', '8.13', 'MIT'],
                      ['jose', '5.9', 'MIT'],
                      ['web-push', '3.6', 'MIT'],
                      ['zustand', '5', 'MIT'],
                      ['react-markdown', '9', 'MIT'],
                      ['recharts', '2.13', 'MIT'],
                      ['vite-plugin-pwa', '0.21', 'MIT'],
                      ['openid-client', '6.8', 'MIT'],
                      ['bcryptjs', '2.4', 'MIT'],
                      ['jsonwebtoken', '9', 'MIT'],
                      ['uuid', '10', 'MIT'],
                      ['zod-to-json-schema', '3.25', 'MIT'],
                      ['dotenv', '17.4', 'BSD-2'],
                      ['TypeScript', '5.6', 'Apache-2.0'],
                    ].map(([name, ver, lic]) => (
                      <tr key={name} className="border-b border-border last:border-0">
                        <td className="px-3 py-1.5 text-body">{name}</td>
                        <td className="px-3 py-1.5 text-secondary text-right">{ver}</td>
                        <td className="px-3 py-1.5 text-secondary text-right min-w-[4.5rem]">{lic}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-0 right-0 z-10 bg-base/90 backdrop-blur border-t border-border">
        <div className="max-w-2xl mx-auto flex">
          <button
            onClick={() => navigate('')}
            className="flex-1 flex flex-col items-center py-2 text-secondary hover:text-primary transition-colors"
          >
            <span className="flex flex-col items-center rounded-2xl px-3 py-1">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                <path d="M2 8L10 13L18 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-label mt-0.5">Inbox</span>
            </span>
          </button>
          <span className="flex-1" />
          <button
            onClick={() => navigate('history')}
            className="flex-1 flex flex-col items-center py-2 text-secondary hover:text-primary transition-colors"
          >
            <span className="flex flex-col items-center rounded-2xl px-3 py-1">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.3"/>
                <line x1="10" y1="5.5" x2="10" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                <line x1="10" y1="10" x2="13" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              </svg>
              <span className="text-label mt-0.5">History</span>
            </span>
          </button>
        </div>
      </nav>
    </div>
  );
}
