import React, { useEffect, useId, useRef, useState } from 'react';
import {
  CLAIM_STATUS_LABELS,
  LOCATION_LABELS,
  PAYMENT_STATUS_LABELS,
  WORKLOG_STATUS_LABELS,
  dateTime,
  humanize,
  label,
  roleLabel,
  routeLabel,
} from '../format';

type Tone = 'neutral' | 'info' | 'success' | 'warn' | 'danger';

const LOG_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  RETURNED_TO_PROVIDER: 'warn',
  BUDGET_HOLD: 'warn',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  APPROVED: 'success',
  FINANCE_REVIEWED: 'info',
  PENDING_ROUTING: 'info',
  ROUTED_FHI360: 'info',
  ROUTED_CSO: 'info',
  PAID: 'success',
};
const CLAIM_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  VALIDATION_NEEDED: 'warn',
  HELD: 'warn',
  BUDGET_HOLD: 'warn',
  PENDING_FINANCE_REVIEW: 'info',
  PENDING_ROUTING: 'info',
  CANCELLED: 'neutral',
  APPROVED: 'success',
  READY: 'success',
};
const PAYMENT_TONE: Record<string, Tone> = {
  NOT_STARTED: 'neutral',
  PENDING: 'info',
  PARTIALLY_RECORDED: 'warn',
  PROOF_REQUIRED: 'warn',
  FAILED: 'danger',
  PAID: 'success',
  RECONCILED: 'success',
};
const GENERIC_TONE: Record<string, Tone> = {
  ACTIVE: 'success',
  SUCCESS: 'success',
  APPROVED: 'success',
  RECONCILED: 'success',
  RECEIVED: 'success',
  SENT: 'success',
  IMPORTED: 'info',
  EXPORTED: 'info',
  HANDED_OFF: 'info',
  PENDING: 'warn',
  PENDING_APPROVAL: 'warn',
  PARTIAL: 'warn',
  UNSYNCED: 'warn',
  EXITED: 'neutral',
  INACTIVE: 'neutral',
  NOT_APPLICABLE: 'neutral',
  SUPPRESSED: 'neutral',
  REJECTED: 'danger',
  FAILED: 'danger',
  ERROR: 'danger',
};

type BadgeKind = 'log' | 'claim' | 'payment' | 'generic';
const KIND_PREFIX: Record<BadgeKind, string> = { log: 'Work log', claim: 'Claim', payment: 'Payment', generic: '' };

/**
 * Status badge. Work-log, claim and payment statuses are different dimensions, so each badge carries
 * its dimension as a prefix ("Claim: Exported", "Payment: Pending payment").
 */
export function StatusBadge({ status, kind = 'generic', bare = false }: { status: string | null | undefined; kind?: BadgeKind; bare?: boolean }) {
  if (!status) return <span className="muted">—</span>;
  const tone =
    kind === 'log' ? LOG_TONE[status] : kind === 'claim' ? CLAIM_TONE[status] : kind === 'payment' ? PAYMENT_TONE[status] : GENERIC_TONE[status];
  const text =
    kind === 'log'
      ? label(WORKLOG_STATUS_LABELS, status)
      : kind === 'claim'
        ? label(CLAIM_STATUS_LABELS, status)
        : kind === 'payment'
          ? label(PAYMENT_STATUS_LABELS, status)
          : humanize(status);
  const prefix = KIND_PREFIX[kind];
  return (
    <span className={`badge badge-${tone || 'info'}`} title={prefix ? `${prefix} status: ${text}` : text}>
      {prefix && !bare && <span className="badge-prefix">{prefix}:</span>} {text}
    </span>
  );
}

export function LocationBadge({ status }: { status: string }) {
  const tone: Tone = status === 'WITHIN_GEOFENCE' ? 'success' : status === 'NOT_CAPTURED' ? 'neutral' : status === 'COMMUNITY_REVIEW' ? 'info' : 'warn';
  return <span className={`badge badge-${tone}`}>{label(LOCATION_LABELS, status)}</span>;
}

export function RouteBadge({ route }: { route: string | null | undefined }) {
  return route ? <span className="badge badge-route" title={`Route ${route}`}>{routeLabel(route)}</span> : <span className="badge badge-warn">No payment route</span>;
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success' | 'info' | 'warn'; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function Loading({ label: text = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted loading" role="status">
      {text}
    </p>
  );
}

/** Loading / error / empty states in one place. Renders children only when data is present. */
export function AsyncState<T>({
  data,
  error,
  loading,
  empty,
  isEmpty,
  children,
}: {
  data: T | null;
  error: string | null;
  loading: boolean;
  empty?: React.ReactNode;
  isEmpty?: (d: T) => boolean;
  children: (d: T) => React.ReactNode;
}) {
  if (error) return <Alert>{error}</Alert>;
  if (data === null) return loading ? <Loading /> : null;
  const blank = isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0;
  if (blank && empty) return <Empty>{empty}</Empty>;
  return <>{children(data)}</>;
}

/** Shown when the mock SMS gateway echoes the OTP so testers can complete the flow. */
export function DevCodeNotice({ code, label: text = 'Development code (test mode only — real users receive this by SMS)' }: { code?: string | null; label?: string }) {
  if (!code) return null;
  return (
    <div className="dev-code" role="status">
      <span className="dev-code-label">{text}</span>
      <code className="dev-code-value">{code}</code>
    </div>
  );
}

/** Open dialogs, innermost last: only the top one reacts to Escape. */
const dialogStack: symbol[] = [];

function useDialogFocus(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const token = Symbol('dialog');
    dialogStack.push(token);
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusable = node?.querySelector<HTMLElement>('[autofocus], input, select, textarea, button:not([data-close])');
    (focusable || node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dialogStack[dialogStack.length - 1] === token) {
        e.preventDefault();
        close.current();
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      dialogStack.splice(dialogStack.indexOf(token), 1);
      if (!dialogStack.length) document.body.classList.remove('no-scroll');
      previous?.focus?.();
    };
  }, []);
  return ref;
}

/** Side drawer: Escape closes, focus moves in and returns to the opener. */
export function Drawer({ title, onClose, children, wide = false }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useDialogFocus(onClose);
  const id = useId();
  return (
    <div className="drawer-backdrop no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`drawer${wide ? ' drawer-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="drawer-header">
          <h2 id={id}>{title}</h2>
          <button className="btn btn-ghost" data-close onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </div>
    </div>
  );
}

/** Centered modal dialog. */
export function Modal({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  const ref = useDialogFocus(onClose);
  const id = useId();
  return (
    <div className="modal-backdrop no-print" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className="modal card" role="dialog" aria-modal="true" aria-labelledby={id}>
        <header className="modal-header">
          <h2 id={id}>{title}</h2>
          <button className="btn btn-ghost" data-close onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/**
 * Ask for a comment before an action. When `required`, the confirm button stays disabled until a reason
 * is typed. `onConfirm` may throw; the message is shown in the dialog.
 */
export function ReasonDialog({
  title,
  description,
  required,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  required: boolean;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (comment: string) => Promise<void>;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (required && !comment.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(comment.trim());
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {description && <div className="muted">{description}</div>}
        {children}
        <Field label={required ? 'Reason (required)' : 'Comment (optional)'}>
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required={required} maxLength={2000} />
        </Field>
        <Alert>{error}</Alert>
        <div className="row">
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (required && !comment.trim())}>
            {busy ? 'Working…' : confirmLabel}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function Field({ label: text, children, hint, className }: { label: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode; className?: string }) {
  return (
    <label className={`field${className ? ` ${className}` : ''}`}>
      <span className="field-label">{text}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Tabs<K extends string>({ tabs, value, onChange, label: aria }: { tabs: { key: K; label: React.ReactNode }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="segmented" role="tablist" aria-label={aria}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === value} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function StatTile({ label: text, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone }) {
  return (
    <div className={`stat card${tone ? ` stat-${tone}` : ''}`}>
      <div className="stat-label">{text}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Facts({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v === null || v === undefined || v === '' ? '—' : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface TimelineRow {
  id: number | string;
  actor_name: string | null;
  actor_role?: string | null;
  action: string;
  old_status?: string | null;
  new_status?: string | null;
  comment?: string | null;
  timestamp: string;
  extra?: React.ReactNode;
}

/** Full audit trail: actor, role, action, old → new status, comment and time (EAT). */
export function AuditTimeline({ rows, actionLabels, statusKind }: { rows: TimelineRow[]; actionLabels: Record<string, string>; statusKind: BadgeKind }) {
  if (!rows.length) return <p className="muted">No history yet.</p>;
  return (
    <ol className="timeline">
      {rows.map((a) => (
        <li key={a.id}>
          <div className="timeline-head">
            <strong>{actionLabels[a.action] || humanize(a.action)}</strong>
            {a.old_status !== a.new_status && a.new_status && (
              <span className="row-inline">
                {a.old_status ? <StatusBadge status={a.old_status} kind={statusKind} bare /> : null}
                {a.old_status ? <span aria-hidden>→</span> : null}
                <StatusBadge status={a.new_status} kind={statusKind} bare />
              </span>
            )}
          </div>
          <div className="muted small">
            {a.actor_name || 'System'}
            {a.actor_role ? ` (${roleLabel(a.actor_role)})` : ''} · {dateTime(a.timestamp)}
          </div>
          {a.comment && <p className="timeline-comment">“{a.comment}”</p>}
          {a.extra}
        </li>
      ))}
    </ol>
  );
}

/** A card section with a heading. */
export function Section({ title, actions, children, className }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`card stack${className ? ` ${className}` : ''}`}>
      <div className="section-head">
        <h3>{title}</h3>
        {actions && <div className="row">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
