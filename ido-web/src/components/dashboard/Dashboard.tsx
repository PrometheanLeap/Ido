import { useEffect, useState } from 'react';
import { useStore } from '../../stores/useStore';
import { SurfaceCard } from './SurfaceCard';
import { SurfaceView } from '../surface/SurfaceView';
import { KeyPromptModal } from './KeyPromptModal';
import { InstallBanner } from './InstallBanner';
import { DashboardHeader } from './DashboardHeader';
import { DashboardTabs } from './DashboardTabs';
import { EmptyState } from './EmptyState';
import { BottomNav } from './BottomNav';
import { SearchBar } from './SearchBar';
import { DismissAllModal } from './DismissAllModal';
import { api } from '../../services/api';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';
import { useSurfaceActions } from '../../hooks/useSurfaceActions';
import { useSurfaceFilters } from '../../hooks/useSurfaceFilters';

type Page = 'inbox' | 'history';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getFirstName(displayName: string | null, userId: string | null): string {
  if (displayName) return displayName.split(' ')[0];
  if (userId) {
    const clean = userId.split('@')[0].replace(/[._-]/g, ' ');
    return clean.charAt(0).toUpperCase() + clean.slice(1).split(' ')[0];
  }
  return '';
}

export function Dashboard() {
  const {
    surfaces,
    loading,
    isRefreshing,
    error,
    sseConnected,
    userId,
    avatarUrl,
    displayName,
    setSurfaces,
    addOrUpdateSurface,
    setError,
    setLoading,
    logout: storeLogout,
  } = useStore();

  const [page, setPage] = useState<Page>('inbox');
  const [selectedSurface, setSelectedSurface] = useState<any>(null);
  const [rejectTargetId, setRejectTargetId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [dismissConfirm, setDismissConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showKeyPrompt, setShowKeyPrompt] = useState(false);
  const [dashboardMode, setDashboardMode] = useState('');

  // Show key prompt if user has no keys (personal or saas mode only)
  useEffect(() => {
    api.whoami().then((info) => {
      setDashboardMode(info.mode);
      if (!info.hasKeys && (info.mode === 'personal' || info.mode === 'saas')) {
        if (!sessionStorage.getItem('ido-key-prompt-shown')) {
          setShowKeyPrompt(true);
        }
      }
    }).catch(() => {});
  }, []);

  // Refetch surfaces when tab regains focus (SSE may have disconnected)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        api.getSurfaces().then(setSurfaces).catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [setSurfaces]);

  const { showModal: showInstall, platform: installPlatform, triggerInstall, dismissForever } = useInstallPrompt();
  const { approve, reject, dismiss, decline, archive, bulkArchive } = useSurfaceActions();

  const { inboxSurfaces, historySurfaces, archivedCount, displaySurfaces } = useSurfaceFilters(
    surfaces, page, selectedType, showArchived, searchQuery,
  );

  // Open a surface — lazily fetch the full record if we only have the summary
  const openSurface = async (surface: any) => {
    console.trace('[Ido] openSurface called for', surface.surface_id, surface.title);
    if (surface.components_json != null) {
      setSelectedSurface(surface);
      return;
    }
    setSelectedSurface(surface);
    try {
      const full = await api.getSurface(surface.surface_id);
      addOrUpdateSurface(full);
      setSelectedSurface(full);
    } catch { /* keep summary view */ }
  };

  const handleOpenReject = (surface: any) => {
    setRejectTargetId(surface.surface_id);
    openSurface(surface);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDismissAll = async () => {
    const notifIds = inboxSurfaces
      .filter((s) => s.type === 'notification')
      .map((s) => s.surface_id);
    if (notifIds.length > 0) await bulkArchive(notifIds);
  };

  const retryLoad = () => {
    setError(null);
    setLoading(true);
    api.getSurfaces().then(setSurfaces).catch((err) => setError(err.message)).finally(() => setLoading(false));
  };

  // ── Loading state ──────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-dvh p-4">
        <div className="max-w-2xl mx-auto space-y-3 pt-8">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="bg-surface border border-border rounded-lg p-4 flex items-center gap-3"
              style={{ opacity: 1 - i * 0.15 }}
            >
              <div className="skeleton w-9 h-9 rounded-full flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-3 rounded w-2/3" />
                <div className="skeleton h-2.5 rounded w-1/3" />
              </div>
              <div className="skeleton h-2.5 rounded w-10" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-base p-4">
        <div className="text-center">
          <p className="text-accent-error mb-2">Something went wrong</p>
          <p className="text-secondary text-caption mb-4">{error}</p>
          <button
            onClick={retryLoad}
            className="px-4 py-2 border border-border rounded-lg text-caption text-primary hover:bg-primary/5 transition-colors press"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────
  const tabs = (['form', 'approval', 'notification'] as const).map((type) => ({
    type,
    count: inboxSurfaces.filter((s) => s.type === type).length,
    isActive: selectedType === type,
  }));

  return (
    <div className="min-h-dvh bg-base pb-20">
      {/* Refreshing indicator */}
      {isRefreshing && (
        <div className="fixed top-0 left-0 right-0 z-20 h-0.5 bg-primary/20">
          <div className="h-full bg-primary animate-pulse" style={{ width: '40%' }} />
        </div>
      )}

      <DashboardHeader sseConnected={sseConnected} avatarUrl={avatarUrl} userId={userId} />

      {/* Sub-header: tabs for inbox, archive toggle for history */}
      <div className="max-w-2xl mx-auto px-4 pt-2 sticky top-[49px] z-[5] bg-base/95 backdrop-blur">
        {page === 'inbox' ? (
          <>
            <div className="flex items-center justify-between mb-2">
              <p className="text-heading font-semibold text-text">
                {getGreeting()} <span className="text-text">{getFirstName(displayName, userId)}</span>
              </p>
              {selectedType === 'notification' && (
                <button
                  onClick={() => setDismissConfirm(true)}
                  className="text-label text-secondary hover:text-primary hover:border-primary/40 font-medium px-2 py-0.5 border border-border rounded-full transition-colors"
                >
                  Dismiss All
                </button>
              )}
            </div>
            <DashboardTabs tabs={tabs} onToggle={(type) => setSelectedType((prev) => prev === type ? null : type)} />
          </>
        ) : (
          <div className="flex items-center justify-between border-b border-border pb-2">
            <div>
              <p className="text-heading font-semibold text-text">
                {getGreeting()} <span className="text-text">{getFirstName(displayName, userId)}</span>
              </p>
              <h2 className="text-caption text-secondary">{showArchived ? 'Archive' : 'History'}</h2>
            </div>
            <button
              onClick={() => setShowArchived(!showArchived)}
              className={`flex items-center gap-1 text-caption border border-border rounded-lg px-2 py-1 transition-colors ${showArchived ? 'text-primary font-medium bg-accent-info/10' : 'text-secondary hover:text-primary'}`}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="1.5" y="2.5" width="13" height="11.5" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <line x1="5.5" y1="1" x2="5.5" y2="3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="10.5" y1="1" x2="10.5" y2="3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              {showArchived ? `Archived (${archivedCount})` : 'Archive'}
            </button>
          </div>
        )}

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 py-2">
            <span className="text-caption text-secondary">{selectedIds.size} selected</span>
            <button
              onClick={async () => { await bulkArchive(Array.from(selectedIds)); setSelectedIds(new Set()); }}
              className="text-caption text-accent-error hover:underline"
            >
              Archive selected
            </button>
            <button onClick={() => setSelectedIds(new Set())} className="text-caption text-secondary hover:underline">
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Surface Cards */}
      <div className="max-w-2xl mx-auto px-4 pt-2 space-y-2">
        {showSearch && (
          <SearchBar
            page={page}
            onSearch={setSearchQuery}
            onClose={() => { setSearchQuery(''); setShowSearch(false); }}
          />
        )}

        {page === 'inbox' && inboxSurfaces.length === 0 ? (
          <EmptyState variant="inbox" dashboardMode={dashboardMode} />
        ) : page === 'history' && historySurfaces.length === 0 ? (
          <EmptyState variant="history" />
        ) : (
          displaySurfaces.map((surface) => (
            <SurfaceCard
              key={surface.surface_id}
              surface={surface}
              isSelected={page === 'history' ? selectedIds.has(surface.surface_id) : undefined}
              onSelect={page === 'history' ? () => toggleSelect(surface.surface_id) : undefined}
              onOpen={() => openSurface(surface)}
              onArchive={page === 'inbox' ? (id) => archive(id) : undefined}
              onApprove={page === 'inbox' ? (id) => approve(id) : undefined}
              onReject={page === 'inbox' ? (id) => reject(id) : undefined}
              onOpenReject={page === 'inbox' ? () => handleOpenReject(surface) : undefined}
              onDecline={page === 'inbox' ? (id) => decline(id) : undefined}
              showStateBadge={page === 'history'}
            />
          ))
        )}
      </div>

      {/* Surface View (bottom sheet / modal) */}
      {selectedSurface && (
        <SurfaceView
          surface={selectedSurface}
          onClose={() => { setSelectedSurface(null); setRejectTargetId(null); }}
          initialDecision={rejectTargetId === selectedSurface?.surface_id ? 'rejected' : undefined}
        />
      )}

      {showKeyPrompt && (
        <KeyPromptModal
          mode={dashboardMode}
          onClose={() => { setShowKeyPrompt(false); sessionStorage.setItem('ido-key-prompt-shown', '1'); }}
        />
      )}
      {showInstall && installPlatform && (
        <InstallBanner platform={installPlatform} onInstall={triggerInstall} onDismissForever={dismissForever} />
      )}

      {dismissConfirm && (
        <DismissAllModal
          onConfirm={() => { handleDismissAll(); setDismissConfirm(false); }}
          onCancel={() => setDismissConfirm(false)}
        />
      )}

      <BottomNav
        page={page}
        showSearch={showSearch}
        onInbox={() => { setPage('inbox'); setShowArchived(false); setShowSearch(false); setSearchQuery(''); }}
        onToggleSearch={() => { setShowSearch(!showSearch); setSearchQuery(''); }}
        onHistory={() => { setPage('history'); setShowArchived(false); setShowSearch(false); setSearchQuery(''); }}
      />
    </div>
  );
}
