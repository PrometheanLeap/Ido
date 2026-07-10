import { useState, useRef, useCallback } from 'react';
import type React from 'react';
import type { Surface } from '../../stores/useStore';
import { StateBadge } from '../shared/StateBadge';
import { relativeTime, expiresIn } from '../../utils/format';

interface SurfaceCardProps {
  surface: Surface;
  isSelected?: boolean;
  onSelect?: () => void;
  onOpen: () => void;
  onArchive?: (id: string) => void;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  /** Fired when swiping to reject an approval that has required reject fields
   *  (e.g. reason is mandatory). The caller should open the SurfaceView with
   *  Reject pre-selected so the user can fill in the reason. */
  onOpenReject?: () => void;
  onDecline?: (id: string) => void;
  showStateBadge?: boolean;
}

const SEVERITY_COLORS: Record<string, string> = {
  info: 'var(--color-accent-info)',
  success: 'var(--color-accent-success)',
  warning: 'var(--color-accent-warning)',
  error: 'var(--color-accent-error)',
  critical: 'var(--color-accent-critical)',
};

/** Check whether an approval surface has required fields on reject
 *  (e.g. `action_validation.reject.required_fields: ["reason"]`).
 *  Returns false when schema_json is not yet available (summary record). */
function hasRequiredRejectFields(surface: Surface): boolean {
  if (surface.type !== 'approval') return false;
  try {
    const parsed = JSON.parse((surface as any).schema_json || '{}');
    const fields = parsed?.action_validation?.reject?.required_fields;
    return Array.isArray(fields) && fields.length > 0;
  } catch {
    return false;
  }
}

function TypeIcon({ type, color }: { type: string; color: string }) {
  if (type === 'notification') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path d="M9 2C7.07 2 5.5 3.57 5.5 5.5V7C5.5 7.83 5.17 8.62 4.6 9.27L3.5 10.5V13H14.5V10.5L13.4 9.27C12.83 8.62 12.5 7.83 12.5 7V5.5C12.5 3.57 10.93 2 9 2Z" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M10 13C10 13.55 9.55 14 9 14C8.45 14 8 13.55 8 13" stroke={color} strokeWidth="1.3" strokeLinecap="round"/>
        <circle cx="13.5" cy="4.5" r="2.5" fill={color} stroke="white" strokeWidth="1"/>
      </svg>
    );
  }
  if (type === 'approval') {
    return (
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <circle cx="9" cy="9" r="7" stroke={color} strokeWidth="1.3"/>
        <path d="M5.5 9L8 11.5L12.5 7" stroke={color} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.5" y="1.5" width="13" height="15" rx="2" stroke={color} strokeWidth="1.3"/>
      <line x1="5.5" y1="5.5" x2="12.5" y2="5.5" stroke={color} strokeWidth="1" strokeLinecap="round"/>
      <line x1="5.5" y1="8.5" x2="12.5" y2="8.5" stroke={color} strokeWidth="1" strokeLinecap="round"/>
      <line x1="5.5" y1="11.5" x2="9.5" y2="11.5" stroke={color} strokeWidth="1" strokeLinecap="round"/>
    </svg>
  );
}

export function SurfaceCard({ surface, isSelected, onSelect, onOpen, onArchive, onApprove, onReject, onOpenReject, onDecline, showStateBadge }: SurfaceCardProps) {
  const accentColor = surface.type === 'notification' && surface.severity
    ? SEVERITY_COLORS[surface.severity] ?? 'var(--color-accent-info)'
    : surface.type === 'approval'
      ? 'var(--color-accent-approval)'
      : 'var(--color-accent-form)';

  const expiry = surface.expires_at ? expiresIn(surface.expires_at) : null;

  // Swipe state
  const [swipeX, setSwipeX] = useState(0);
  const [swipeActive, setSwipeActive] = useState(false);
  const [swipeDismissing, setSwipeDismissing] = useState(false);
  const [swipeConfirm, setSwipeConfirm] = useState<'approve' | 'reject' | 'decline' | null>(null);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);
  const swipeDir = useRef<'h' | 'v' | null>(null);
  const pendingAction = useRef<(() => void) | null>(null);

  const SWIPE_THRESHOLD = 80;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (swipeDismissing) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = true;
    swipeDir.current = null;
    setSwipeX(0);
    setSwipeActive(false);
    setSwipeDismissing(false);
    pendingAction.current = null;
  }, [swipeDismissing]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSwiping.current || swipeDismissing) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;

    // Lock horizontal after 8px
    if (swipeDir.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      swipeDir.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }

    if (swipeDir.current === 'h') {
      setSwipeX(dx);
      setSwipeActive(true);
    }
  }, [swipeDismissing]);

  const onTouchEnd = useCallback(() => {
    isSwiping.current = false;

    if (swipeDir.current === 'h' && Math.abs(swipeX) >= SWIPE_THRESHOLD) {
      const isRight = swipeX > 0;
      // Animate off-screen, then fire action on transition end
      setSwipeDismissing(true);
      setSwipeX(isRight ? 400 : -400);

      if (surface.type === 'notification') {
        pendingAction.current = () => onArchive?.(surface.surface_id);
      } else if (surface.type === 'approval') {
        if (!isRight && hasRequiredRejectFields(surface)) {
          // Reject with required fields → skip confirmation modal,
          // open the surface directly with Reject pre-selected.
          pendingAction.current = () => onOpenReject?.();
        } else {
          pendingAction.current = () => setSwipeConfirm(isRight ? 'approve' : 'reject');
        }
      } else if (surface.type === 'form') {
        if (!isRight) pendingAction.current = () => setSwipeConfirm('decline');
        else pendingAction.current = () => onOpen();
      }
    } else {
      // Snap back — bg stays until transition completes
      setSwipeX(0);
    }
    swipeDir.current = null;
  }, [swipeX, surface.type, surface.surface_id, onArchive, onOpen]);

  const onTransitionEnd = useCallback(() => {
    if (swipeDismissing) {
      // Card has slid off-screen — fire the pending action.
      // Do NOT reset swipeX — keep the card off-screen so it doesn't
      // slide back before the parent removes it from the list.
      setSwipeActive(false);
      pendingAction.current?.();
      pendingAction.current = null;
    } else {
      setSwipeActive(false);
    }
  }, [swipeDismissing]);

  // Track last direction for bg persistence
  const lastSwipeDir = useRef<'left' | 'right'>('right');
  if (swipeX < 0) lastSwipeDir.current = 'left';
  else if (swipeX > 0) lastSwipeDir.current = 'right';

  // Action colors
  const leftColor = surface.type === 'notification' ? 'var(--color-primary)'
    : 'var(--color-accent-error)';
  const rightColor = surface.type === 'notification' ? 'var(--color-primary)'
    : 'var(--color-accent-success)';
  const leftLabel = surface.type === 'notification' ? 'Dismiss' : surface.type === 'approval' ? 'Reject' : 'Decline';
  const rightLabel = surface.type === 'notification' ? 'Dismiss' : surface.type === 'approval' ? 'Approve' : 'Open';

  const swipeProgress = Math.min(Math.abs(swipeX) / SWIPE_THRESHOLD, 1);
  const isPastThreshold = Math.abs(swipeX) >= SWIPE_THRESHOLD;

  return (
    <div className="relative overflow-hidden rounded-lg">
      {/* Swipe action backgrounds */}
      {swipeActive && lastSwipeDir.current === 'left' && (
        <div className="absolute inset-0 flex items-center justify-end px-4 rounded-lg" style={{ backgroundColor: leftColor }}>
          <div
            className="flex items-center gap-1.5 text-white text-label font-semibold transition-all duration-100"
            style={{ opacity: swipeProgress, transform: `scale(${0.85 + swipeProgress * 0.15})` }}
          >
            {isPastThreshold && <span className="text-body">✓</span>}
            {leftLabel}
          </div>
        </div>
      )}
      {swipeActive && lastSwipeDir.current === 'right' && (
        <div className="absolute inset-0 flex items-center px-4 rounded-lg" style={{ backgroundColor: rightColor }}>
          <div
            className="flex items-center gap-1.5 text-white text-label font-semibold transition-all duration-100"
            style={{ opacity: swipeProgress, transform: `scale(${0.85 + swipeProgress * 0.15})` }}
          >
            {isPastThreshold && <span className="text-body">✓</span>}
            {rightLabel}
          </div>
        </div>
      )}

      {/* Card */}
      <div
        className={`bg-surface border border-border overflow-hidden cursor-pointer card-lift press-sm group relative rounded-lg ${surface.viewed_at ? '' : 'animate-card-arrive'}`}
        style={{ borderLeft: `3px solid ${accentColor}`, transform: `translateX(${swipeX}px)`, transition: (swipeActive && !swipeDismissing) ? 'none' : 'transform 0.25s ease-out' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTransitionEnd={onTransitionEnd}
        onClick={() => { if (swipeDir.current !== 'h') onOpen(); }}
      >
        {/* Header: icon + title + source/age */}
        <div className="flex items-center gap-3 p-3 pb-1">
          <span className="flex-shrink-0 flex items-center">
            <TypeIcon type={surface.type} color={accentColor} />
          </span>
          <div className="flex-1 min-w-0">
            <h3 className="text-body font-semibold truncate">{surface.title}</h3>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 text-label text-secondary">
            {surface.source && (
              <span className="truncate max-w-[100px]">{surface.source}</span>
            )}
            <span className="whitespace-nowrap">{relativeTime(surface.created_at)}</span>
          </div>
          {onSelect && (
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
              className={`w-5 h-5 rounded border-2 flex-shrink-0 transition-colors micro-bounce ${
                isSelected
                  ? 'bg-primary border-primary'
                  : 'border-border group-hover:border-primary'
              }`}
            >
              {isSelected && <span className="text-white text-xs">✓</span>}
            </button>
          )}
        </div>

        <div className="px-3 pb-2 min-h-[1.25em]">
          <p className="text-caption text-secondary truncate">
            {surface.context || ''}
          </p>
        </div>

        {/* Footer: expiry timer or state badge */}
        <div className="flex items-center justify-end px-3 pb-3">
          {expiry && !showStateBadge && (
            <span className={`text-label flex items-center gap-1 ${expiry.urgent ? 'text-accent-error' : 'text-accent-warning'}`}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1"/>
                <line x1="6" y1="3.5" x2="6" y2="6" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                <line x1="6" y1="6" x2="8" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
              </svg>
              {expiry.text}
            </span>
          )}
          {showStateBadge && (
            <StateBadge state={surface.state} type={surface.type} archived={surface.archived} />
          )}
        </div>
      </div>

      {/* Swipe confirmation modal */}
      {swipeConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={() => setSwipeConfirm(null)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div className="relative bg-surface mx-4 mb-8 sm:mb-0 p-5 rounded-2xl border border-border shadow-xl text-center max-w-xs w-full animate-slide-up" onClick={(e) => e.stopPropagation()}>
            {swipeConfirm === 'approve' ? (
              <>
                <p className="text-body font-semibold mb-1">Approve this request?</p>
                <p className="text-caption text-secondary mb-4">This will confirm your approval.</p>
                <div className="flex gap-2">
                  <button onClick={() => setSwipeConfirm(null)} className="flex-1 py-2.5 border border-border rounded-xl text-caption text-secondary hover:text-primary transition-colors press">Cancel</button>
                  <button onClick={() => { setSwipeConfirm(null); onApprove?.(surface.surface_id); }} className="flex-1 py-2.5 bg-accent-success text-white rounded-xl text-caption font-semibold press">Yes, approve</button>
                </div>
              </>
            ) : swipeConfirm === 'reject' ? (
              <>
                <p className="text-body font-semibold mb-1">Reject this request?</p>
                <p className="text-caption text-secondary mb-4">This will confirm your rejection.</p>
                <div className="flex gap-2">
                  <button onClick={() => setSwipeConfirm(null)} className="flex-1 py-2.5 border border-border rounded-xl text-caption text-secondary hover:text-primary transition-colors press">Cancel</button>
                  <button onClick={() => { setSwipeConfirm(null); onReject?.(surface.surface_id); }} className="flex-1 py-2.5 bg-accent-error text-white rounded-xl text-caption font-semibold press">Yes, reject</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-body font-semibold mb-1">Decline this request?</p>
                <p className="text-caption text-secondary mb-4">You won't be able to respond later.</p>
                <div className="flex gap-2">
                  <button onClick={() => setSwipeConfirm(null)} className="flex-1 py-2.5 border border-border rounded-xl text-caption text-secondary hover:text-primary transition-colors press">Go back</button>
                  <button onClick={() => { setSwipeConfirm(null); onDecline?.(surface.surface_id); }} className="flex-1 py-2.5 bg-accent-error text-white rounded-xl text-caption font-semibold press">Yes, decline</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
