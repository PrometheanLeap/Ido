import { useState, useEffect, useCallback } from 'react';

export type Platform = 'chrome' | 'safari-ios' | 'other' | 'installed';

const DISMISSED_KEY = 'ido-install-dismissed';

function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'other';
  if (window.matchMedia('(display-mode: standalone)').matches) return 'installed';
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const isIOSSafari = isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|OPiOS|mercury/.test(ua);
  if (isIOSSafari) return 'safari-ios';
  if (/Chrome/.test(ua) || /Edg\//.test(ua)) return 'chrome';
  return 'other';
}

export interface UseInstallPromptResult {
  platform: Platform;
  promptReady: boolean;
  showModal: boolean;
  triggerInstall: () => void;
  dismissForever: () => void;
}

export function useInstallPrompt(): UseInstallPromptResult {
  const [platform] = useState<Platform>(detectPlatform);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [dismissed, setDismissed] = useState(() => !!localStorage.getItem(DISMISSED_KEY));

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Modal is actionable only when:
  // - Chrome/Edge: beforeinstallprompt has actually fired (prompt is ready)
  // - iOS Safari: always (manual share flow)
  const showModal = !dismissed && (
    (platform === 'chrome' && !!deferredPrompt) ||
    platform === 'safari-ios'
  );

  const triggerInstall = useCallback(() => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((result: { outcome: string }) => {
      if (result.outcome === 'accepted') {
        localStorage.setItem(DISMISSED_KEY, '1');
        setDismissed(true);
      }
    });
  }, [deferredPrompt]);

  const dismissForever = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, '1');
    setDismissed(true);
  }, []);

  return { platform, promptReady: !!deferredPrompt, showModal, triggerInstall, dismissForever };
}
