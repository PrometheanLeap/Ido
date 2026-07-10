import { Logo } from '../shared/Logo';
import { navigate } from '../../utils/navigation';

interface DashboardHeaderProps {
  sseConnected: boolean;
  avatarUrl: string | null;
  userId: string | null;
}

export function DashboardHeader({ sseConnected, avatarUrl, userId }: DashboardHeaderProps) {
  return (
    <header className="sticky top-0 z-10 bg-base/80 backdrop-blur border-b border-border px-4 py-3">
      <div className="max-w-2xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo size="md" />
          {/* SSE connection indicator */}
          {!sseConnected && (
            <span className="flex items-center gap-1 text-label text-accent-warning" title="Reconnecting…">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-warning animate-pulse" />
              Reconnecting
            </span>
          )}
        </div>
        <button
          onClick={() => navigate('settings')}
          className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-label font-semibold hover:bg-primary/20 transition-colors overflow-hidden"
          title="Settings"
          aria-label="Open settings"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            userId ? userId.charAt(0).toUpperCase() : '?'
          )}
        </button>
      </div>
    </header>
  );
}
