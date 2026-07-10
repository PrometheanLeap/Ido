interface DismissAllModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function DismissAllModal({ onConfirm, onCancel }: DismissAllModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label="Clear all notifications"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full sm:max-w-sm mx-4 mb-4 sm:mb-0 bg-surface border border-border rounded-2xl shadow-xl p-6 animate-slide-up">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-accent-error/10 flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M4 4l12 12M16 4l-12 12" stroke="var(--color-accent-error)" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </div>
          <div>
            <h3 className="text-heading font-semibold text-text">Clear all notifications</h3>
            <p className="text-caption text-secondary mt-1">
              This will dismiss every notification currently shown. This action cannot be undone.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-5 py-2.5 text-caption text-secondary hover:text-primary border border-border rounded-xl transition-colors press"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-5 py-2.5 text-caption font-semibold text-white bg-accent-error rounded-xl hover:opacity-90 press"
          >
            Clear all
          </button>
        </div>
      </div>
    </div>
  );
}
