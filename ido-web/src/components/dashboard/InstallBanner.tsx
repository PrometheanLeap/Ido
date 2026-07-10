import type { Platform } from '../../hooks/useInstallPrompt';

interface InstallBannerProps {
  platform: Platform;
  onInstall: () => void;
  onDismissForever: () => void;
}

export function InstallBanner({ platform, onInstall, onDismissForever }: InstallBannerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface mx-5 p-6 rounded-xl ring-1 ring-inset ring-gray-400/25 dark:ring-gray-500/25 shadow-2xl max-w-sm w-full animate-slide-up">

        <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4 mx-auto">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5 17h14" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </div>

        <h2 className="text-heading font-semibold text-center mb-1">Install Ido</h2>

        {platform === 'chrome' && (
          <>
            <p className="text-caption text-secondary text-center mb-5">Add Ido to your device for quick access and push notifications.</p>
            <button onClick={onInstall} className="w-full py-2.5 bg-base border border-accent-success text-accent-success rounded-xl font-semibold text-body hover:bg-accent-success/5 transition-colors press mb-2">
              Install
            </button>
          </>
        )}

        {platform === 'safari-ios' && (
          <>
            <p className="text-caption text-secondary text-center mb-4">Tap the Share button below and select “Add to Home Screen”.</p>
            <div className="flex items-center justify-center gap-2 mb-5">
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

        <button onClick={onDismissForever} className="w-full py-2.5 bg-base border border-border text-secondary rounded-xl text-body font-medium hover:text-primary transition-colors press mb-2">
          {platform === 'safari-ios' ? 'Got it' : 'Not now'}
        </button>
        <p className="text-caption text-secondary/60 text-center">You can install anytime from Settings → App</p>
      </div>
    </div>
  );
}
