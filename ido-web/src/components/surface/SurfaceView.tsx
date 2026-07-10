import { useState, useEffect, Fragment, useRef, useCallback } from 'react';
import type React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Surface } from '../../stores/useStore';
import { api } from '../../services/api';
import { useStore } from '../../stores/useStore';
import { StateBadge } from '../shared/StateBadge';
import { clearSurfaceNotification } from '../../utils/push';
import { formatDuration } from '../../utils/format';

interface SurfaceViewProps {
  surface: Surface;
  onClose: () => void;
  /** If set, the approval chips start with this decision pre-selected.
   *  Used when swiping to approve/reject on the dashboard card — opens the
   *  surface so the user can provide required fields (e.g. reject reason). */
  initialDecision?: 'approved' | 'rejected';
}

export function SurfaceView({ surface, onClose, initialDecision }: SurfaceViewProps) {
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [declineConfirm, setDeclineConfirm] = useState(false);
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(initialDecision ?? null);
  const [remainingMs, setRemainingMs] = useState<number | null>(
    surface.expires_at ? new Date(surface.expires_at).getTime() - Date.now() : null,
  );
  const { removeSurface, setSurfaces } = useStore();

  // Dismiss / decline handlers (defined before swipe so touch handlers can call them)
  const handleDismiss = useCallback(async () => {
    setSubmitting(true);
    try {
      await api.dismissSurface(surface.surface_id);
      setClosing(true);
      clearSurfaceNotification(surface.surface_id);
      const updated = await api.getSurfaces();
      setTimeout(() => {
        setSurfaces(updated);
        onClose();
      }, 500);
    } catch (err: any) {
      setError(err.message || 'Failed to dismiss');
    } finally {
      setSubmitting(false);
    }
  }, [surface.surface_id, onClose, setSurfaces]);

  const handleDecline = useCallback(async () => {
    setDeclineConfirm(false);
    setSubmitting(true);
    try {
      await api.declineSurface(surface.surface_id);
      setClosing(true);
      clearSurfaceNotification(surface.surface_id);
      const updated = await api.getSurfaces();
      setTimeout(() => {
        setSurfaces(updated);
        onClose();
      }, 500);
    } catch (err: any) {
      setError(err.message || 'Failed to decline');
    } finally {
      setSubmitting(false);
    }
  }, [surface.surface_id, onClose, setSurfaces]);

  // Swipe-down-to-close (only when scrolled to top)
  const sheetRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [swipeY, setSwipeY] = useState(0);
  const touchStartY = useRef(0);
  const isSwiping = useRef(false);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
    isSwiping.current = true;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSwiping.current) return;
    const dy = e.touches[0].clientY - touchStartY.current;
    // Only respond to downward swipes on the header (no scroll conflict).
    if (dy > 0) setSwipeY(dy);
  }, []);

  const onTouchEnd = useCallback(() => {
    isSwiping.current = false;
    if (swipeY > 120) onClose();
    setSwipeY(0);
  }, [swipeY, onClose]);

  // Scroll error into view when it appears
  useEffect(() => {
    if (error && errorRef.current) {
      errorRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [error]);

  // Countdown timer — update every 30s, auto-close on expiry
  useEffect(() => {
    if (!surface.expires_at) return;
    const terminalStates = ['COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'DISMISSED'];
    // Notifications in COMPLETED shouldn't be treated as terminal — still dismissible
    if (terminalStates.includes(surface.state) && !(surface.type === 'notification' && surface.state === 'COMPLETED')) return;
    const tick = () => {
      const left = new Date(surface.expires_at!).getTime() - Date.now();
      if (left <= 0) {
        setRemainingMs(0);
        removeSurface(surface.surface_id);
        onClose();
        return;
      }
      setRemainingMs(left);
    };
    tick();
    const interval = setInterval(tick, 30000);
    return () => clearInterval(interval);
  }, [surface.surface_id]);

  // Parse components and schema
  // When opened from the dashboard card, the surface is initially a lightweight
  // summary without components_json/schema_json. Detect this "hydrating" state
  // so we can show a skeleton instead of an empty modal that jumps in size.
  const isHydrating = surface.components_json == null && surface.schema_json == null;
  const components = JSON.parse(surface.components_json || '[]');
  const schema = JSON.parse(surface.schema_json || '{}');
  const requiredFields = new Set<string>(
    Array.isArray(schema.required) ? schema.required : [],
  );
  const currentData = JSON.parse(surface.data_json || '{}');

  const terminalStates = ['COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'DISMISSED'];
  // Notifications in COMPLETED are still actionable (can be dismissed)
  const isTerminal = (terminalStates.includes(surface.state) && !(surface.type === 'notification' && surface.state === 'COMPLETED')) || !!surface.archived;
  const isReadOnly = isTerminal || (remainingMs !== null && remainingMs <= 0);

  // Try to extract submitted decision — surface.data_json only contains
  // userInput (form fields), NOT the decision. The decision is stored in
  // the task output. Derive it from the surface state instead.
  const submittedDecision =
    surface.state === 'REJECTED' ? 'rejected'
    : (surface.state === 'COMPLETED' && surface.type === 'approval') ? 'approved'
    : (currentData as any)?.decision || null;
  const submittedReason = (formData.reason as string) || (currentData as any)?.reason || null;

  // Apply initialDecision when the surface is opened from a swipe gesture.
  useEffect(() => {
    if (initialDecision) setDecision(initialDecision);
  }, [initialDecision]);

  // Initialize form data — re-runs when the full surface record hydrates
  // (the dashboard swaps the lightweight summary for the full record with
  // the same surface_id, so we depend on data_json to catch that transition).
  useEffect(() => {
    const initial: Record<string, unknown> = { ...currentData };
    if (schema.properties) {
      for (const key of Object.keys(schema.properties)) {
        if (!(key in initial)) initial[key] = '';
      }
    }
    setFormData(initial);
  }, [surface.surface_id, surface.data_json]);

  const handleBlur = (key: string) => {
    const val = formData[key];
    const prop = schema.properties?.[key];
    let err = '';

    // Required check
    if (schema.required && Array.isArray(schema.required) && schema.required.includes(key)) {
      if (val === '' || val === null || val === undefined) {
        err = 'Required';
      }
    }

    // Format checks
    if (!err && prop) {
      if (prop.type === 'string' && prop.format === 'email' && typeof val === 'string' && val.length > 0) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
          err = 'Invalid email';
        }
      }
      if ((prop.type === 'string' && prop.format === 'uri') || (prop.type === 'string' && prop.format === 'url')) {
        if (typeof val === 'string' && val.length > 0 && !/^https?:\/\/.+/.test(val)) {
          err = 'Invalid URL';
        }
      }
    }

    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) next[key] = err;
      else delete next[key];
      return next;
    });
  };

  const handleSubmit = async (overrideDecision?: string) => {
    const submitDecision = overrideDecision || decision;
    // Check for existing field-level errors
    const fieldErrKeys = Object.keys(fieldErrors);
    if (fieldErrKeys.length > 0) {
      setError(`Please fix ${fieldErrKeys.length} field error${fieldErrKeys.length > 1 ? 's' : ''}`);
      return;
    }

    // Required field enforcement
    if (schema.required && Array.isArray(schema.required)) {
      const missing = schema.required.filter((key: string) => {
        const val = formData[key];
        return val === '' || val === null || val === undefined;
      });
      if (missing.length > 0) {
        setError(`Required fields missing: ${missing.join(', ')}`);
        return;
      }
    }

    setSubmitting(true);
    setError('');

    try {
      await api.submitSurface(surface.surface_id, formData, submitDecision ?? undefined);
      setClosing(true);
      clearSurfaceNotification(surface.surface_id);
      // Fetch updated list but defer applying it until modal has closed
      const updated = await api.getSurfaces();
      setTimeout(() => {
        setSurfaces(updated);
        onClose();
      }, 500);
    } catch (err: any) {
      setError(err.message || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  // Parse approval validation rules
  const actionValidation = (() => {
    try {
      const inputJson = JSON.parse(surface.schema_json || '{}');
      return (inputJson as any)?.action_validation || null;
    } catch { return null; }
  })();
  const hasReasonField = schema.properties && 'reason' in schema.properties;
  const reasonRequiredForReject = actionValidation?.reject?.required_fields?.includes('reason');
  const rejectBlocked = decision === 'rejected' && reasonRequiredForReject && !(formData.reason as string)?.trim();

  const isExpired = remainingMs !== null && remainingMs <= 0;
  const expiryLabel = remainingMs !== null && remainingMs > 0 ? formatDuration(remainingMs) : null;

  // Prevent background scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    // Clear notifications related to this surface on open
    try {
      if ('serviceWorker' in navigator && 'getNotifications' in ServiceWorkerRegistration.prototype) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.getNotifications({ tag: surface.surface_id }).then((notifs) => {
            notifs.forEach((n) => n.close());
          });
        });
      }
    } catch { /* ignore */ }
    return () => { document.body.style.overflow = ''; };
  }, []);

  // Focus trap — keep Tab navigation within the modal
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const focusable = sheet.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onKeyDown={onKeyDown}>
      {/* Backdrop */}
      <div className={`absolute inset-0 ${closing ? 'animate-fade-out' : 'animate-fade-in'} bg-black/40 backdrop-blur-sm ${submitting ? 'pointer-events-none' : ''}`} onClick={closing || submitting ? undefined : onClose} />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className={`relative bg-surface w-full sm:max-w-lg max-h-[90dvh] min-h-[40dvh] flex flex-col rounded-t-xl sm:rounded-xl shadow-2xl ring-1 ring-inset ring-gray-400/25 dark:ring-gray-500/25 ${closing ? 'animate-fade-out' : 'animate-slide-up'}`}
        style={{ transform: `translateY(${swipeY}px)`, transition: swipeY ? 'none' : 'transform 0.2s ease-out' }}
        role="dialog"
        aria-modal="true"
      >
        {/* Fixed top section — swipe-down-to-close bound only on this header area */}
        <div
          className="flex-shrink-0"
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Handle — swipe down to close */}
          <div className="flex justify-center pt-3 pb-1 sm:hidden">
            <div className="w-10 h-1 bg-border rounded-full" />
          </div>

        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="min-w-0 overflow-hidden">
            <h2 className="text-heading font-semibold break-words">{surface.title}</h2>
            {expiryLabel && (
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`text-label flex items-center gap-1 ${remainingMs !== null && remainingMs <= 5 * 60 * 1000 ? 'text-accent-error' : 'text-accent-warning'}`}>
                  <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1"/>
                    <line x1="6" y1="3.5" x2="6" y2="6" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                    <line x1="6" y1="6" x2="8" y2="7" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  {expiryLabel}
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isReadOnly && <StateBadge state={surface.state} type={surface.type} archived={surface.archived} />}
            <button onClick={onClose} className="text-accent-error hover:bg-accent-error/10 w-7 h-7 flex items-center justify-center rounded-md text-lg transition-colors border border-accent-error/30" aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
        {isHydrating ? (
          /* Skeleton placeholder while the full surface record loads */
          <div className="px-5 py-4 space-y-3">
            <div className="skeleton h-4 rounded w-3/4" />
            <div className="skeleton h-4 rounded w-1/2" />
            <div className="h-3" />
            <div className="skeleton h-10 rounded-md w-full" />
            <div className="skeleton h-10 rounded-md w-full" />
            <div className="h-3" />
            <div className="skeleton h-4 rounded w-2/3" />
            <div className="skeleton h-10 rounded-md w-full" />
          </div>
        ) : (
        <>
        {/* Context */}
        {surface.context && (
          <div className="px-5 py-3 border-b border-border">
            <p className="text-body text-secondary whitespace-pre-wrap">{surface.context}</p>
          </div>
        )}
        {/* Components rendered as tree */}
        {components.length > 0 && (
          <div className="px-5 py-3 space-y-3">
            <ComponentTree
              components={components}
              formData={formData}
              onChange={(bindKey, value) => setFormData((prev) => ({ ...prev, [bindKey]: value }))}
              fieldErrors={fieldErrors}
              onBlur={handleBlur}
              readOnly={isReadOnly}
              requiredFields={requiredFields}
            />
          </div>
        )}

        {/* Approval decision chips */}
        {surface.type === 'approval' && !isReadOnly && (
          <div className="px-5 py-3 border-t border-border">
            {/* Reason field — injected if in inputs_schema */}
            {hasReasonField && decision === 'rejected' && (
              <div className="mb-3">
                <label className="block text-label font-medium text-secondary mb-1">
                  Reason{reasonRequiredForReject && <span className="text-accent-error ml-0.5">*</span>}
                </label>
                <textarea
                  value={(formData.reason as string) ?? ''}
                  onChange={(e) => setFormData((prev) => ({ ...prev, reason: e.target.value }))}
                  disabled={isReadOnly}
                  className={`w-full px-3 py-2 bg-base border border-border rounded-md text-body resize-y ${isReadOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
                  rows={3}
                  placeholder={reasonRequiredForReject ? 'Required for rejection' : 'Optional'}
                />
              </div>
            )}
            <p className="text-label text-secondary mb-2">Your decision</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (decision === 'rejected') {
                    handleSubmit('rejected');
                  } else {
                    setDecision('rejected');
                    setError('');
                  }
                }}
                disabled={submitting || (decision === 'rejected' && rejectBlocked)}
                className={`flex-1 py-2 rounded-md font-medium text-body transition-colors press ${
                  decision === 'rejected'
                    ? 'bg-accent-error text-white'
                    : 'bg-base border border-accent-error text-accent-error hover:bg-accent-error/10'
                } ${decision === 'rejected' && rejectBlocked ? 'opacity-40 cursor-not-allowed' : ''} disabled:opacity-40`}
              >
                {decision === 'rejected' ? (submitting ? 'Submitting…' : '✕ Confirm Reject') : '✕ Reject'}
              </button>
              <button
                onClick={() => {
                  if (decision === 'approved') {
                    handleSubmit('approved');
                  } else {
                    setDecision('approved');
                    setError('');
                  }
                }}
                disabled={submitting}
                className={`flex-1 py-2 rounded-md font-medium text-body transition-colors press ${
                  decision === 'approved'
                    ? 'bg-accent-success text-white'
                    : 'bg-base border border-accent-success text-accent-success hover:bg-accent-success/10'
                } disabled:opacity-40`}
              >
                {decision === 'approved' ? (submitting ? 'Submitting…' : '✓ Confirm Approve') : '✓ Approve'}
              </button>
            </div>
            {decision === 'rejected' && rejectBlocked && (
              <p className="text-caption text-accent-error mt-1">Reason is required for rejection</p>
            )}
          </div>
        )}

        {/* Approval submitted decision (read-only) */}
        {surface.type === 'approval' && isReadOnly && submittedDecision && (
          <div className="px-5 py-3 border-t border-border">
            <p className="text-label text-secondary mb-2">Decision</p>
            <div className={`inline-flex items-center gap-2 px-3 py-2 rounded-md text-body font-medium ${
              submittedDecision === 'approved'
                ? 'bg-accent-success/10 text-accent-success'
                : 'bg-accent-error/10 text-accent-error'
            }`}>
              {submittedDecision === 'approved' ? '✓ Approved' : '✕ Rejected'}
            </div>
            {/* Show the reason field if it was declared in inputs_schema — same
                field the user filled when rejecting, rendered read-only with the
                submitted value so History viewers don't have to click Reject. */}
            {hasReasonField && submittedDecision === 'rejected' && (
              <div className="mt-3">
                <label className="block text-label font-medium text-secondary mb-1">
                  Reason
                  {reasonRequiredForReject && <span className="text-accent-error ml-0.5">*</span>}
                </label>
                <textarea
                  value={(formData.reason as string) ?? ''}
                  disabled
                  className="w-full px-3 py-2 bg-base border border-border rounded-md text-body resize-y opacity-60 cursor-not-allowed"
                  rows={3}
                />
              </div>
            )}
            {submittedReason && (
              <p className="text-body text-secondary mt-2">{submittedReason}</p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div ref={errorRef} className="mx-5 mb-3 p-3 bg-accent-error/10 text-accent-error text-caption rounded-md">
            {error}
          </div>
        )}
        </>
        )}
        </div>

        {/* Fixed bottom section — hidden while hydrating to prevent layout jump */}
        {isHydrating ? null : (
        <div className="flex-shrink-0 border-t border-border">
        {/* Submit / Dismiss */}
        <div className="px-5 py-4">
          {isReadOnly ? (
            <div className="text-center">
              <button onClick={onClose} className="px-6 py-2 text-caption text-secondary hover:text-primary border border-border rounded-lg press">
                Close
              </button>
            </div>
          ) : isExpired ? (
            <p className="text-center text-accent-error text-caption">This request has expired</p>
          ) : surface.type === 'notification' ? (
            <button
              onClick={handleDismiss}
              disabled={submitting}
              className="w-full py-3 bg-base border border-primary text-primary rounded-xl font-semibold text-body hover:bg-primary/5 disabled:opacity-40 transition-colors press"
            >
              {submitting ? 'Dismissing…' : 'Dismiss'}
            </button>
          ) : surface.type === 'form' ? (
            <div className="flex gap-3">
              <button
                onClick={() => setDeclineConfirm(true)}
                disabled={submitting}
                className="flex-1 py-3 bg-base border border-accent-error text-accent-error rounded-xl font-medium text-body hover:bg-accent-error/5 disabled:opacity-40 transition-colors press"
              >
                Decline
              </button>
              <button
                onClick={() => handleSubmit()}
                disabled={submitting}
                className="flex-1 py-3 bg-base border border-primary text-primary rounded-xl font-semibold text-body hover:bg-primary/5 disabled:opacity-40 transition-colors press"
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          ) : surface.type === 'approval' ? null : null}
        </div>
        </div>
        )}

      </div>

      {/* Decline confirmation modal — outside sheet so fixed positioning works */}
      {declineConfirm && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 rounded-xl">
          <div className="bg-surface mx-5 p-5 rounded-xl border border-border shadow-lg text-center max-w-xs w-full animate-slide-up">
            <p className="text-body font-semibold mb-1">Decline this request?</p>
            <p className="text-caption text-secondary mb-4">You won't be able to respond later. The task will be cancelled.</p>
            <div className="flex gap-2">
              <button onClick={() => setDeclineConfirm(false)} className="flex-1 py-2.5 border border-border rounded-xl text-caption text-secondary hover:text-primary transition-colors press">Go back</button>
              <button onClick={handleDecline} disabled={submitting} className="flex-1 py-2.5 bg-accent-error text-white rounded-xl text-caption font-semibold disabled:opacity-40 press">
                {submitting ? 'Declining…' : 'Yes, decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Visibility Rule Evaluator ───────────────────────────────

function evaluateVisibility(rule: any, formData: Record<string, unknown>): boolean {
  if (!rule) return true;

  // Single condition
  if (rule.when && rule.operator) {
    const fieldValue = formData[rule.when];
    const expected = rule.value;
    switch (rule.operator) {
      case 'equals': return String(fieldValue ?? '') === String(expected ?? '');
      case 'notEquals': return String(fieldValue ?? '') !== String(expected ?? '');
      case 'exists': return fieldValue !== null && fieldValue !== undefined && fieldValue !== '';
      case 'notExists': return fieldValue === null || fieldValue === undefined || fieldValue === '';
      case 'greaterThan': return Number(fieldValue) > Number(expected);
      case 'lessThan': return Number(fieldValue) < Number(expected);
      case 'in': return Array.isArray(expected) ? expected.includes(String(fieldValue)) : false;
      default: return true;
    }
  }

  // AND — all conditions must be true
  if (rule.all && Array.isArray(rule.all)) {
    return rule.all.every((r: any) => evaluateVisibility(r, formData));
  }

  // OR — any condition must be true
  if (rule.any && Array.isArray(rule.any)) {
    return rule.any.some((r: any) => evaluateVisibility(r, formData));
  }

  return true;
}

// ── Component Tree Renderer ──────────────────────────────────

function ComponentTree({
  components,
  formData,
  onChange,
  fieldErrors,
  onBlur,
  readOnly,
  requiredFields,
}: {
  components: any[];
  formData: Record<string, unknown>;
  onChange: (bindKey: string, value: unknown) => void;
  fieldErrors: Record<string, string>;
  onBlur: (key: string) => void;
  readOnly?: boolean;
  requiredFields: Set<string>;
}) {
  // Build lookup and find roots
  const lookup = new Map<string, any>();
  for (const c of components) lookup.set(c.id, c);

  const roots = components.filter((c) => {
    // A component is a root if no other component claims it as a child
    const hasParent = components.some((p) =>
      p.children && Array.isArray(p.children) && p.children.includes(c.id)
    );
    return !hasParent;
  });

  return <>{roots.map((root) => renderNode(root, lookup, formData, onChange, fieldErrors, onBlur, readOnly || false, requiredFields, root.id, null))}</>;
}

interface GridContext {
  bind: string;
  mode: 'single' | 'multiple';
}

function renderNode(
  comp: any,
  lookup: Map<string, any>,
  formData: Record<string, unknown>,
  onChange: (bindKey: string, value: unknown) => void,
  fieldErrors: Record<string, string>,
  onBlur: (key: string) => void,
  readOnly: boolean,
  requiredFields: Set<string>,
  key?: string,
  gridContext?: GridContext | null,
): React.ReactNode {
  // Visibility rule check — hide if condition not met
  if (comp.visible && !evaluateVisibility(comp.visible, formData)) {
    return null;
  }

  const childIds: string[] = comp.children || [];
  const childNodes = childIds.map((id) => lookup.get(id)).filter(Boolean);

  const isContainer = ['Card', 'Row', 'Column', 'ProductGrid', 'Accordion'].includes(comp.component) ||
    childNodes.length > 0;

  const handleChange = (value: unknown) => {
    // If inside a selectable grid, use the grid's bind
    if (gridContext && gridContext.bind) {
      onChange(gridContext.bind, value);
    } else if (comp.bind) {
      onChange(comp.bind, value);
    }
  };

  const renderedChildren = childNodes.length > 0 ? (
    childNodes.map((child: any) => renderNode(child, lookup, formData, onChange, fieldErrors, onBlur, readOnly, requiredFields, child.id, gridContext))
  ) : null;

  // For containers, render the wrapper with children inside
  let result: React.ReactNode;

  if (comp.component === 'Card') {
    result = (
      <div className="bg-surface rounded-lg">
        {comp.props?.title && <h3 className="text-heading font-semibold mb-1 px-1 pt-1">{comp.props.title}</h3>}
        {comp.props?.subtitle && <p className="text-caption text-secondary px-1 mb-2">{comp.props.subtitle}</p>}
        <div className="space-y-2">{renderedChildren}</div>
      </div>
    );
  } else if (comp.component === 'Row') {
    const maxCols = comp.props?.maxColumns as number | undefined;
    const align = comp.props?.align as string | undefined;
    const alignClass = align === 'end' ? 'items-end' : align === 'center' ? 'items-center' : align === 'start' ? 'items-start' : '';
    if (maxCols) {
      result = (
        <div className={`grid gap-3 ${alignClass}`} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(180px, 1fr))` }}>
          {renderedChildren}
        </div>
      );
    } else {
      result = <div className="flex gap-2 flex-wrap">{renderedChildren}</div>;
    }
  } else if (comp.component === 'Column') {
    result = <div className="flex flex-col gap-2">{renderedChildren}</div>;
  } else if (comp.component === 'ProductGrid') {
    const pBind = comp.props?.bind as string | undefined;
    const pMode = (comp.props?.mode || 'single') as 'single' | 'multiple';
    const childCtx: GridContext | null = pBind ? { bind: pBind, mode: pMode } : null;
    const cols = comp.props?.columns || 3;
    const gridChildren = childNodes.length > 0 ? (
      childNodes.map((child: any) => renderNode(child, lookup, formData, onChange, fieldErrors, onBlur, readOnly, requiredFields, child.id, childCtx))
    ) : null;
    result = (
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {gridChildren}
      </div>
    );
  } else if (comp.component === 'Accordion') {
    result = <AccordionRenderer comp={comp} renderedChildren={renderedChildren} />;
  } else {
    // Generic container: render the component itself + its children below
    result = (
      <>
        <ComponentRenderer component={comp} formData={formData} onChange={handleChange} fieldErrors={fieldErrors} onBlur={onBlur} readOnly={readOnly} requiredFields={requiredFields} gridContext={gridContext} />
        {renderedChildren && <div className="space-y-2">{renderedChildren}</div>}
      </>
    );
  }

  return key ? <Fragment key={key}>{result}</Fragment> : result;
}

// ── Accordion Renderer (needs useState) ──────────────────────

function AccordionRenderer({ comp, renderedChildren }: { comp: any; renderedChildren: React.ReactNode }) {
  const [open, setOpen] = useState(comp.props?.defaultOpen ?? false);
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:bg-base/50 text-body font-medium"
      >
        {comp.props?.title}
        <span className={`transform transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>
      {open && <div className="p-4 bg-base space-y-2">{renderedChildren}</div>}
    </div>
  );
}

// ── Simple Component Renderer ───────────────────────────────

function isCardSelected(
  bindKey: string,
  mode: 'single' | 'multiple',
  formData: Record<string, unknown>,
  value: string,
): boolean {
  const raw = formData[bindKey];
  if (!raw) return false;
  if (mode === 'multiple') {
    return String(raw).split(',').includes(value);
  }
  return String(raw) === value;
}

function toggleCardSelection(
  bindKey: string,
  mode: 'single' | 'multiple',
  formData: Record<string, unknown>,
  value: string,
  onChange: (value: unknown) => void,
) {
  if (mode === 'multiple') {
    const raw = formData[bindKey];
    const current = raw ? String(raw).split(',') : [];
    const idx = current.indexOf(value);
    if (idx >= 0) {
      current.splice(idx, 1);
    } else {
      current.push(value);
    }
    onChange(current.join(',') || '');
  } else {
    // Single mode: if already selected, deselect; otherwise select
    const current = formData[bindKey];
    onChange(String(current) === value ? '' : value);
  }
}

function ComponentRenderer({
  component,
  formData,
  onChange,
  fieldErrors,
  onBlur,
  readOnly,
  requiredFields,
  gridContext,
}: {
  component: any;
  formData: Record<string, unknown>;
  onChange: (value: unknown) => void;
  fieldErrors: Record<string, string>;
  onBlur: (key: string) => void;
  readOnly?: boolean;
  requiredFields: Set<string>;
  gridContext?: GridContext | null;
}) {
  const { component: type, props, bind } = component;

  switch (type) {
    case 'Card':
      return (
        <div className="bg-surface rounded-lg">
          {props?.title && <h3 className="text-heading font-semibold mb-1">{props.title}</h3>}
          {props?.subtitle && <p className="text-caption text-secondary">{props.subtitle}</p>}
        </div>
      );

    case 'Row':
      return <div className="flex gap-2 flex-wrap">{null}</div>;

    case 'Column':
      return <div className="flex flex-col gap-2">{null}</div>;

    case 'Text':
      return (
        <p className={`${
          props?.usageHint === 'heading' ? 'text-heading font-semibold' :
          props?.usageHint === 'subheading' ? 'text-body font-medium' :
          props?.usageHint === 'caption' ? 'text-caption text-secondary' :
          props?.usageHint === 'label' ? 'text-label font-medium text-secondary' :
          'text-body'
        }`}>
          {props?.text}
        </p>
      );

    case 'RichText':
      return (
        <div className="prose prose-sm dark:prose-invert max-w-none text-body">
          <ReactMarkdown>{props?.markdown || ''}</ReactMarkdown>
        </div>
      );

    case 'Badge':
      return (
        <span
          className="inline-block text-label px-2 py-0.5 rounded-full font-medium"
          style={{
            backgroundColor: props?.color ? `${props.color}20` : undefined,
            color: props?.color || 'var(--color-text-secondary)',
            border: props?.variant === 'outline' ? `1px solid ${props.color || 'var(--color-border)'}` : undefined,
          }}
        >
          {props?.text}
        </span>
      );

    case 'InputField':
    case 'TextField':
      const isMultiline = type === 'TextField' || props?.multiline;
      const fieldType = props?.type || 'text';
      const value = (formData[bind] as string) ?? '';
      const ifErr = bind ? fieldErrors[bind as string] : null;
      const isRequired = bind ? requiredFields.has(bind as string) : false;

      if (isMultiline) {
        return (
          <div>
            <label className="block text-label font-medium text-secondary mb-1">
              {props?.label}
              {isRequired && <span className="text-accent-error ml-0.5">*</span>}
            </label>
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onBlur={() => bind && onBlur(bind as string)}
              disabled={readOnly}
              className={`w-full px-3.5 py-2.5 bg-base border rounded-xl text-body resize-y focus:ring-2 focus:ring-primary/25 focus:border-primary focus:outline-none ${readOnly ? 'opacity-60 cursor-not-allowed' : ''} ${ifErr ? 'border-accent-error focus:ring-accent-error/25 focus:border-accent-error' : 'border-border'}`}
              rows={props?.rows || 3}
              placeholder={props?.placeholder}
              required={isRequired}
            />
            {ifErr && <p className="text-caption text-accent-error mt-1">{ifErr}</p>}
          </div>
        );
      }

      return (
        <div>
          <label className="block text-label font-medium text-secondary mb-1">
            {props?.label}
            {isRequired && <span className="text-accent-error ml-0.5">*</span>}
          </label>
          <input
            type={fieldType}
            value={value}
            onChange={(e) => onChange(fieldType === 'number' ? Number(e.target.value) : e.target.value)}
            onBlur={() => bind && onBlur(bind as string)}
            disabled={readOnly}
            className={`w-full px-3.5 py-2.5 bg-base border rounded-xl text-body focus:ring-2 focus:ring-primary/25 focus:border-primary focus:outline-none ${readOnly ? 'opacity-60 cursor-not-allowed' : ''} ${ifErr ? 'border-accent-error focus:ring-accent-error/25 focus:border-accent-error' : 'border-border'}`}
            placeholder={props?.placeholder}
            required={isRequired}
            min={props?.min}
            max={props?.max}
            step={props?.step}
          />
          {ifErr && <p className="text-caption text-accent-error mt-1">{ifErr}</p>}
        </div>
      );

    case 'Select': {
      const selErr = bind ? fieldErrors[bind as string] : null;
      const selRequired = bind ? requiredFields.has(bind as string) : false;
      return (
        <div>
          <label className="block text-label font-medium text-secondary mb-1">
            {props?.label}
            {selRequired && <span className="text-accent-error ml-0.5">*</span>}
          </label>
          <select
            value={(formData[bind] as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => bind && onBlur(bind as string)}
            disabled={readOnly}
            className={`w-full px-3.5 py-2.5 bg-base border rounded-xl text-body focus:ring-2 focus:ring-primary/25 focus:border-primary focus:outline-none ${readOnly ? 'opacity-60 cursor-not-allowed' : ''} ${selErr ? 'border-accent-error focus:ring-accent-error/25 focus:border-accent-error' : 'border-border'}`}
            required={selRequired}
          >
            <option value="">Select…</option>
            {(props?.options || []).map((opt: any) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {selErr && <p className="text-caption text-accent-error mt-1">{selErr}</p>}
        </div>
      );
    }

    case 'ChoicePicker': {
      const variant = props?.variant || 'chips';
      const isMulti = variant === 'checkbox';
      const selectedValue = formData[bind] as string;
      const selectedArray: string[] = isMulti
        ? (typeof selectedValue === 'string' ? selectedValue.split(',').filter(Boolean) : Array.isArray(selectedValue) ? selectedValue : [])
        : [];

      if (isMulti) {
        return (
          <div>
            {props?.label && <p className="text-label font-medium text-secondary mb-2">{props.label}</p>}
            <div className="space-y-2">
              {(props?.options || []).map((opt: any) => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedArray.includes(opt.value)}
                    disabled={readOnly}
                    onChange={(e) => {
                      const updated = e.target.checked
                        ? [...selectedArray, opt.value]
                        : selectedArray.filter((v: string) => v !== opt.value);
                      onChange(updated.join(','));
                    }}
                    className="rounded border-border text-primary"
                  />
                  <span className="text-body">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      }

      return (
        <div>
          {props?.label && <p className="text-label font-medium text-secondary mb-2">{props.label}</p>}
          <div className="flex flex-wrap gap-2">
            {(props?.options || []).map((opt: any) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => !readOnly && onChange(opt.value)}
                disabled={readOnly}
                className={`px-3.5 py-2 rounded-full text-caption font-medium transition-all press-sm ${
                  readOnly ? 'opacity-60 cursor-not-allowed' : ''
                } ${
                  selectedValue === opt.value
                    ? 'bg-primary text-white shadow-sm'
                    : 'bg-base border border-border hover:border-primary text-secondary'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      );
    }

    case 'Checkbox':
      return (
        <label className="flex items-center gap-2 cursor-pointer press-sm py-1">
          <input
            type="checkbox"
            checked={!!formData[bind]}
            disabled={readOnly}
            onChange={(e) => onChange(e.target.checked)}
            className="rounded border-border text-primary"
          />
          <span className="text-body">
            {props?.label}
            {bind && requiredFields.has(bind as string) && <span className="text-accent-error ml-0.5">*</span>}
          </span>
        </label>
      );

    case 'DatePicker': {
      const dpErr = bind ? fieldErrors[bind as string] : null;
      const dpRequired = bind ? requiredFields.has(bind as string) : false;
      return (
        <div>
          <label className="block text-label font-medium text-secondary mb-1">
            {props?.label}
            {dpRequired && <span className="text-accent-error ml-0.5">*</span>}
          </label>
          <input
            type="date"
            value={(formData[bind] as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => bind && onBlur(bind as string)}
            disabled={readOnly}
            className={`w-full px-3.5 py-2.5 bg-base border rounded-xl text-body focus:ring-2 focus:ring-primary/25 focus:border-primary focus:outline-none ${readOnly ? 'opacity-60 cursor-not-allowed' : ''} ${dpErr ? 'border-accent-error focus:ring-accent-error/25 focus:border-accent-error' : 'border-border'}`}
            required={dpRequired}
            min={props?.min}
            max={props?.max}
          />
          {dpErr && <p className="text-caption text-accent-error mt-1">{dpErr}</p>}
        </div>
      );
    }

    case 'Rating':
      const rating = (formData[bind] as number) ?? 0;
      const maxStars = props?.max || 5;
      return (
        <div>
          <p className="text-label font-medium text-secondary mb-1">{props?.label}</p>
          <div className="flex gap-1">
            {Array.from({ length: maxStars }, (_, i) => (
              <button
                key={i}
                type="button"
                disabled={readOnly}
                onClick={() => onChange(i + 1)}
                className={`text-2xl transition-colors ${readOnly ? 'cursor-default' : 'press-sm cursor-pointer'} ${i < rating ? 'text-accent-warning' : 'text-border hover:text-accent-warning/40'}`}
              >
                ★
              </button>
            ))}
          </div>
        </div>
      );

    case 'Slider':
      return (
        <div>
          <label className="block text-label font-medium text-secondary mb-1">
            {props?.label}: {formData[bind] as number ?? props?.min}
          </label>
          <input
            type="range"
            min={props?.min}
            max={props?.max}
            step={props?.step || 1}
            disabled={readOnly}
            value={(formData[bind] as number) ?? props?.min}
            onChange={(e) => onChange(Number(e.target.value))}
            className={`w-full h-2 accent-primary ${readOnly ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
          />
        </div>
      );

    case 'Divider':
      return (
        <div className="flex items-center gap-3">
          <hr className="flex-1 border-border" />
          {props?.label && <span className="text-caption text-secondary">{props.label}</span>}
          <hr className="flex-1 border-border" />
        </div>
      );

    case 'Link':
      return (
        <a
          href={props?.href}
          target={props?.target || '_blank'}
          rel="noopener noreferrer"
          className="text-primary hover:underline text-body"
        >
          {props?.text}
        </a>
      );

    case 'Image':
      return (
        <img
          src={props?.src}
          alt={props?.alt || ''}
          className={`w-full rounded-lg ${props?.fit === 'cover' ? 'object-cover' : 'object-contain'}`}
        />
      );

    // ── Layout (extended) ─────────────────────────────────

    case 'Stepper': {
      const steps = (props?.steps || []) as Array<{ label: string; description?: string; completed?: boolean }>;
      const current = (props?.current || 0) as number;
      return (
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-caption font-medium ${
                step.completed ? 'bg-accent-success text-white' :
                i === current ? 'bg-primary text-white' :
                'bg-border text-secondary'
              }`}>
                {step.completed ? '✓' : i + 1}
              </div>
              <div>
                <p className="text-body font-medium">{step.label}</p>
                {step.description && <p className="text-caption text-secondary">{step.description}</p>}
              </div>
            </div>
          ))}
        </div>
      );
    }

    // ── Input (extended) ──────────────────────────────────

    case 'FileInput':
      return (
        <div>
          <label className="block text-label font-medium text-secondary mb-1">{props?.label}</label>
          <input
            type="file"
            accept={props?.accept}
            multiple={props?.multiple}
            disabled={readOnly}
            className={`w-full text-body file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-white file:text-caption file:font-medium hover:file:opacity-90 ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        </div>
      );

    case 'ImagePicker':
      return (
        <div>
          <label className="block text-label font-medium text-secondary mb-1">{props?.label}</label>
          <input
            type="file"
            accept={props?.accept || 'image/*'}
            multiple={props?.multiple}
            disabled={readOnly}
            className={`w-full text-body file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-primary file:text-white file:text-caption file:font-medium hover:file:opacity-90 ${readOnly ? 'opacity-60 cursor-not-allowed' : ''}`}
          />
        </div>
      );

    case 'ImageSelect': {
      const items = (props?.items || []) as Array<{ src: string; value: string; label?: string }>;
      const mode = props?.mode || 'single';
      const cols = props?.columns || 3;
      const rawValue = (formData[bind] as string) ?? '';
      const selected = mode === 'single'
        ? [rawValue]
        : rawValue.split(',').map((s: string) => s.trim()).filter(Boolean);
      return (
        <div>
          <div className={`grid gap-2 ${readOnly ? 'opacity-80' : ''}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {items.map((item) => {
              const isSelected = selected.includes(item.value);
              return (
                <button
                  key={item.value}
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    if (readOnly) return;
                    if (mode === 'single') {
                      onChange(item.value);
                    } else {
                      const next = isSelected
                        ? selected.filter((v: string) => v !== item.value)
                        : [...selected, item.value];
                      onChange(next.join(','));
                    }
                  }}
                  className={`rounded-lg overflow-hidden border-2 transition-colors ${
                    readOnly ? 'cursor-default' : ''
                  } ${
                    isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-primary/50'
                  }`}
                >
                <img src={item.src} alt={item.label || ''} className="w-full aspect-square object-cover" />
                {item.label && <p className="text-caption p-1 text-center truncate">{item.label}</p>}
              </button>
            )})}
          </div>
        </div>
      );
    }

    case 'Signature': {
      const sigValue = (formData[bind] as string) ?? '';
      const canvasRef = useRef<HTMLCanvasElement>(null);
      const containerRef = useRef<HTMLDivElement>(null);
      const isDrawing = useRef(false);

      // Size canvas once on mount — never re-run, or drawing is wiped.
      useEffect(() => {
        const canvas = canvasRef.current;
        const container = containerRef.current;
        if (!canvas || !container) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = 120 * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = '120px';
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.scale(dpr, dpr);
      }, []);

      // Restore a previously submitted signature when viewing in read-only mode.
      // Only fires in History — never during active drawing (readOnly is false).
      useEffect(() => {
        if (!readOnly) return;
        if (!sigValue || !sigValue.startsWith('data:')) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const img = new Image();
        img.onload = () => {
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
          ctx.drawImage(img, 0, 0, canvas.width / dpr, canvas.height / dpr);
        };
        img.src = sigValue;
      }, [sigValue, readOnly]);

      const getScaledCoords = (e: React.MouseEvent | React.TouchEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        return {
          x: clientX - rect.left,
          y: clientY - rect.top,
        };
      };

      const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
        if (readOnly) return;
        isDrawing.current = true;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.beginPath();
        const { x, y } = getScaledCoords(e);
        ctx.moveTo(x, y);
      };

      const draw = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isDrawing.current || readOnly) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const { x, y } = getScaledCoords(e);
        ctx.lineTo(x, y);
        ctx.strokeStyle = '#3B5BDB';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      };

      const stopDraw = () => {
        isDrawing.current = false;
        const canvas = canvasRef.current;
        if (canvas) {
          onChange(canvas.toDataURL());
        }
      };

      const clearSig = () => {
        const canvas = canvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            const dpr = window.devicePixelRatio || 1;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
          }
          onChange('');
        }
      };

      return (
        <div>
          <label className="block text-label font-medium text-secondary mb-1">{props?.label}</label>
          <div ref={containerRef} className="border-2 border-dashed border-border rounded-lg overflow-hidden bg-base">
            <canvas
              ref={canvasRef}
              className={`w-full block ${readOnly ? 'cursor-default' : 'touch-none'}`}
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={stopDraw}
              onMouseLeave={stopDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={stopDraw}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-caption text-secondary">{readOnly ? 'Signature' : 'Draw your signature above'}</span>
            {!readOnly && <button type="button" onClick={clearSig} className="text-caption text-accent-error hover:underline">Clear</button>}
          </div>
          {sigValue && !sigValue.startsWith('data:') && (
            <div className="mt-2 px-3 py-2 bg-base border border-border rounded text-body italic text-secondary">
              {sigValue}
            </div>
          )}
        </div>
      );
    }

    // ── Display (extended) ────────────────────────────────

    case 'ProgressBar': {
      const value = (props?.value ?? 0) as number;
      const max = (props?.max ?? 100) as number;
      const pct = Math.min(100, Math.round((value / max) * 100));
      const variant = (props?.variant || 'default') as string;
      const colors: Record<string, string> = {
        default: 'bg-primary',
        success: 'bg-accent-success',
        warning: 'bg-accent-warning',
        error: 'bg-accent-error',
      };
      return (
        <div>
          {(props?.label || props?.showValue) && (
            <div className="flex justify-between mb-1">
              {props?.label && <span className="text-label text-secondary">{props.label}</span>}
              {props?.showValue && <span className="text-label text-secondary">{pct}%</span>}
            </div>
          )}
          <div className="w-full h-2 bg-border rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${colors[variant] || colors.default}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      );
    }

    // ── Data ──────────────────────────────────────────────

    case 'Table': {
      const headers = (props?.headers || []) as string[];
      const rows = (props?.rows || []) as string[][];
      return (
        <div className="overflow-x-auto">
          <table className={`w-full text-body ${props?.striped ? 'striped' : ''} ${props?.compact ? 'text-caption' : ''}`}>
            <thead>
              <tr className="border-b border-border">
                {headers.map((h, i) => (
                  <th key={i} className="text-left py-2 px-3 text-label font-medium text-secondary">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className={`border-b border-border ${props?.striped && ri % 2 === 1 ? 'bg-base' : ''}`}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="py-2 px-3">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'DataGrid': {
      const columns = (props?.columns || []) as Array<{ key: string; label: string; editable?: boolean }>;
      const rows = (props?.rows || []) as Array<Record<string, unknown>>;
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => (
                  <th key={col.key} className="text-left py-2 px-3 text-label font-medium text-secondary">{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-border">
                  {columns.map((col) => (
                    <td key={col.key} className="py-2 px-3">{String(row[col.key] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'BarChart':
    case 'PieChart':
    case 'DonutChart': {
      const data = (props?.data || []) as Array<{ label: string; value: number }>;
      const colors = (props?.colors as string[] | undefined) || ['#3B5BDB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];
      const chartHeight = (props?.height || 140) as number;
      const maxVal = Math.max(...data.map((d) => d.value), 1);

      if (type === 'PieChart' || type === 'DonutChart') {
        const total = data.reduce((s, d) => s + d.value, 0) || 1;
        let cumulativeAngle = 0;
        return (
          <div className="flex flex-col h-full">
            {props?.title && <h4 className="text-label font-medium text-secondary text-center mb-1">{props.title}</h4>}
            <div className="flex-1 flex items-center gap-3 justify-center">
              <div className="relative flex-shrink-0" style={{ width: chartHeight, height: chartHeight }}>
              <svg viewBox="0 0 40 40" className="w-full h-full" style={{ transform: 'rotate(-90deg)' }}>
                {data.map((d, i) => {
                  const sliceAngle = (d.value / total) * 360;
                  const startAngle = cumulativeAngle;
                  const endAngle = startAngle + sliceAngle;
                  const startRad = (startAngle * Math.PI) / 180;
                  const endRad = (endAngle * Math.PI) / 180;
                  const cx = 20, cy = 20;
                  const outerR = type === 'DonutChart' ? 14 : 19;
                  const innerR = type === 'DonutChart' ? 8 : 0;
                  const x1o = cx + outerR * Math.cos(startRad);
                  const y1o = cy + outerR * Math.sin(startRad);
                  const x2o = cx + outerR * Math.cos(endRad);
                  const y2o = cy + outerR * Math.sin(endRad);
                  const large = sliceAngle > 180 ? 1 : 0;
                  let dAttr: string;
                  if (type === 'DonutChart') {
                    const x1i = cx + innerR * Math.cos(startRad);
                    const y1i = cy + innerR * Math.sin(startRad);
                    const x2i = cx + innerR * Math.cos(endRad);
                    const y2i = cy + innerR * Math.sin(endRad);
                    dAttr = `M${x1o},${y1o} A${outerR},${outerR} 0 ${large},1 ${x2o},${y2o} L${x2i},${y2i} A${innerR},${innerR} 0 ${large},0 ${x1i},${y1i} Z`;
                  } else {
                    dAttr = `M${cx},${cy} L${x1o},${y1o} A${outerR},${outerR} 0 ${large},1 ${x2o},${y2o} Z`;
                  }
                  cumulativeAngle = endAngle;
                  return <path key={i} d={dAttr} fill={colors[i % colors.length]} />;
                })}
              </svg>
            </div>
            <div className="space-y-1">
              {data.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: colors[i % colors.length] }} />
                  <span className="text-caption">{d.label}: {d.value}</span>
                </div>
              ))}
            </div>
            </div>
          </div>
        );
      }

      // Bar chart — use fixed pixel heights for reliability
      return (
        <div className="flex flex-col h-full">
          {props?.title && <h4 className="text-label font-medium text-secondary text-center mb-1">{props.title}</h4>}
          <div className="flex-1 flex flex-col justify-end">
            <div className="flex items-end gap-1" style={{ height: chartHeight, paddingBottom: 0 }}>
              {data.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end" style={{ height: '100%' }}>
                  <span className="text-label font-medium mb-0.5">{d.value}</span>
                  <div
                    className="w-full rounded-t-sm transition-all"
                    style={{
                      height: `${Math.max(2, (d.value / maxVal) * 90)}%`,
                      backgroundColor: colors[i % colors.length],
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-1 mt-1">
              {data.map((d, i) => (
                <div key={i} className="flex-1 text-center">
                  <span className="text-label text-secondary truncate block">{d.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }

    case 'LineChart': {
      const seriesList = (props?.series as Array<{ name: string; data: Array<{ label: string; value: number }> }> | undefined) ||
        (props?.data ? [{ name: '', data: props.data as Array<{ label: string; value: number }> }] : []);
      const colors = (props?.colors as string[] | undefined) || ['#3B5BDB', '#10B981', '#F59E0B', '#EF4444'];
      const chartHeight = (props?.height || 140) as number;
      const allValues = seriesList.flatMap((s: any) => s.data.map((d: any) => d.value));
      const maxVal = Math.max(...allValues, 1);
      const allLabels = seriesList[0]?.data.map((d: any) => d.label) || [];
      const padLeft = 32;
      const padRight = 16;
      const padBottom = 20;
      const padTop = 12;
      const plotW = 300;
      const plotH = chartHeight - padTop - padBottom;
      const getX = (i: number) => padLeft + (allLabels.length > 1 ? (i / (allLabels.length - 1)) * plotW : plotW / 2);
      const getY = (v: number) => padTop + plotH - (v / maxVal) * plotH;

      return (
        <div className="flex flex-col h-full">
          {props?.title && <h4 className="text-label font-medium text-secondary text-center mb-1">{props.title}</h4>}
          <div className="flex-1 flex flex-col justify-end">
            <svg viewBox={`0 0 ${padLeft + plotW + padRight} ${chartHeight}`} className="w-full" style={{ maxHeight: chartHeight }}>
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                const y = getY(maxVal * pct);
                return (
                  <g key={pct}>
                    <line x1={padLeft} y1={y} x2={padLeft + plotW} y2={y} stroke="#e5e7eb" strokeWidth="0.5" />
                    <text x={padLeft - 4} y={y + 3} textAnchor="end" fill="#9ca3af" fontSize="8">
                      {Math.round(maxVal * (1 - pct))}
                    </text>
                  </g>
                );
              })}
              {/* Series lines */}
              {seriesList.map((series: any, si: number) => {
                const color = colors[si % colors.length];
                const linePath = series.data.map((d: any, i: number) => `${i === 0 ? 'M' : 'L'}${getX(i)},${getY(d.value)}`).join(' ');
                return (
                  <g key={si}>
                    <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                    {series.data.map((d: any, i: number) => (
                      <circle key={i} cx={getX(i)} cy={getY(d.value)} r="2.5" fill={color} stroke="#fff" strokeWidth="1.5" />
                    ))}
                  </g>
                );
              })}
            </svg>
            {/* X-axis labels */}
            <div className="flex" style={{ paddingLeft: padLeft, paddingRight: padRight }}>
              {allLabels.map((label: string, i: number) => (
                <div key={i} className="flex-1 text-center mt-1">
                  <span className="text-label text-secondary truncate block">{label}</span>
                </div>
              ))}
            </div>
            {/* Legend (multi-series only) */}
            {seriesList.length > 1 && (
              <div className="flex justify-center gap-3 mt-1 flex-wrap">
                {seriesList.map((series: any, si: number) => (
                  <div key={si} className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: colors[si % colors.length] }} />
                    <span className="text-label text-secondary">{series.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'ItemCard': {
      const icValue = (props?.value || props?.title || '') as string;
      const isSelected = gridContext ? isCardSelected(gridContext.bind, gridContext.mode, formData, icValue) : false;
      const canClick = gridContext && !readOnly;
      const handleClick = canClick ? () => toggleCardSelection(gridContext.bind, gridContext.mode, formData, icValue, onChange) : undefined;
      return (
        <div
          className={`bg-surface border rounded-lg overflow-hidden transition-all ${handleClick ? 'cursor-pointer hover:shadow-md' : ''} ${isSelected ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
          onClick={handleClick}
        >
          <div className="p-3 pb-0">
            <h4 className="text-body font-medium">{props?.title}</h4>
          </div>
          {props?.image && (
            <div className="aspect-[4/3] bg-surface-secondary overflow-hidden mt-2">
              <img src={props.image} alt={props.title || ''} className="w-full h-full object-cover" />
            </div>
          )}
          <div className="p-3">
            {props?.subtitle && <p className="text-caption text-secondary mt-1">{props.subtitle}</p>}
            <div className="flex items-center justify-between mt-2 gap-2">
              {props?.price && <p className="text-body font-semibold">{props.price}</p>}
              {props?.badge && (
                <span className="text-label px-2 py-0.5 rounded-full bg-primary/10 text-primary ml-auto">{props.badge}</span>
              )}
            </div>
          </div>
        </div>
      );
    }

    case 'Map': {
      const lat = props?.lat || 51.5074;
      const lng = props?.lng || -0.1278;
      const zoom = props?.zoom || 14;
      const markerLabel = props?.marker?.label || '';
      const markerLat = props?.marker?.lat || lat;
      const markerLng = props?.marker?.lng || lng;
      const osmUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.02},${lat-0.01},${lng+0.02},${lat+0.01}&layer=mapnik&marker=${markerLat},${markerLng}`;
      return (
        <div className="rounded-lg overflow-hidden border border-border" style={{ height: 200 }}>
          <iframe
            src={osmUrl}
            width="100%"
            height="100%"
            style={{ border: 0 }}
            loading="lazy"
            title="Map"
          />
          {markerLabel && (
            <div className="px-3 py-1.5 bg-surface/90 backdrop-blur border-t border-border">
              <p className="text-caption font-medium">📍 {markerLabel} ({markerLat.toFixed(4)}, {markerLng.toFixed(4)})</p>
            </div>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}
