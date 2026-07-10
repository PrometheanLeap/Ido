import { navigate } from '../../utils/navigation';

interface EmptyStateProps {
  variant: 'inbox' | 'history';
  dashboardMode?: string;
}

export function EmptyState({ variant, dashboardMode }: EmptyStateProps) {
  if (variant === 'inbox') {
    return (
      <div className="max-w-md mx-auto py-16 px-4 text-center animate-slide-up">
        <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-primary/10 flex items-center justify-center">
          <svg width="30" height="30" viewBox="0 0 36 36" fill="none" aria-hidden="true">
            <circle cx="18" cy="10" r="3" fill="var(--color-primary)" opacity="0.9" />
            <circle cx="11" cy="22" r="3" fill="var(--color-primary)" opacity="0.6" />
            <circle cx="25" cy="22" r="3" fill="var(--color-primary)" opacity="0.6" />
          </svg>
        </div>
        <h2 className="text-heading font-semibold mb-2">You're all caught up</h2>
        <p className="text-secondary text-caption mb-6 max-w-xs mx-auto">
          Forms, approvals, and notifications from your AI agents will land here in real time.
        </p>
        {dashboardMode !== 'dev' && (
          <button
            onClick={() => navigate('settings')}
            className="inline-flex items-center gap-1.5 text-caption text-primary font-medium hover:underline"
          >
            Connect an agent
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-16 px-4 text-center animate-slide-up">
      <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-secondary/10 flex items-center justify-center">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="var(--color-secondary)" strokeWidth="1.5" />
          <path d="M12 7v5l3 2" stroke="var(--color-secondary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 className="text-heading font-semibold mb-2">No history yet</h2>
      <p className="text-secondary text-caption">Completed and dismissed surfaces will appear here.</p>
    </div>
  );
}
