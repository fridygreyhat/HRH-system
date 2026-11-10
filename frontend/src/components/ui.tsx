import React, { useEffect, useId, useRef, useState } from 'react';
import { Icon, IconName } from './Icon';
import {
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_LABELS_SW,
  LOCATION_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS_SW,
  WORKLOG_STATUS_LABELS,
  WORKLOG_STATUS_LABELS_SW,
  dateTime,
  humanize,
  initialsOf,
  workTypeName,
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
  REVERSED: 'neutral',
  INACTIVE: 'neutral',
  NOT_APPLICABLE: 'neutral',
  SUPPRESSED: 'neutral',
  REJECTED: 'danger',
  FAILED: 'danger',
  ERROR: 'danger',
};

type BadgeKind = 'log' | 'claim' | 'payment' | 'generic';
const KIND_PREFIX: Record<BadgeKind, string> = { log: 'Work log', claim: 'Claim', payment: 'Payment', generic: '' };
const KIND_PREFIX_SW: Partial<Record<BadgeKind, string>> = { log: 'Kumbukumbu ya kazi', claim: 'Dai', payment: 'Malipo' };

export const pageLang = () => (typeof document === 'undefined' ? 'en' : document.documentElement.lang);

/**
 * Status badge. Work-log, claim and payment statuses are different dimensions, so each badge carries
 * its dimension as a prefix ("Claim: Exported", "Payment: Pending payment").
 */
export function StatusBadge({ status, kind = 'generic', bare = false, label: shown }: { status: string | null | undefined; kind?: BadgeKind; bare?: boolean; label?: string }) {
  const lang = pageLang();
  if (!status) return <span className="muted">—</span>;
  const tone =
    kind === 'log' ? LOG_TONE[status] : kind === 'claim' ? CLAIM_TONE[status] : kind === 'payment' ? PAYMENT_TONE[status] : GENERIC_TONE[status];
  const text =
    shown ||
    (kind === 'log'
      ? (lang === 'sw' && WORKLOG_STATUS_LABELS_SW[status]) || label(WORKLOG_STATUS_LABELS, status)
      : kind === 'claim'
        ? (lang === 'sw' && CLAIM_STATUS_LABELS_SW[status]) || label(CLAIM_STATUS_LABELS, status)
        : kind === 'payment'
          ? (lang === 'sw' && PAYMENT_STATUS_LABELS_SW[status]) || label(PAYMENT_STATUS_LABELS, status)
          : humanize(status));
  const prefixSw = lang === 'sw' ? KIND_PREFIX_SW[kind] : undefined;
  const prefix = prefixSw || KIND_PREFIX[kind];
  const title = prefixSw ? `Hali ya ${prefixSw.toLowerCase()}: ${text}` : prefix ? `${prefix} status: ${text}` : text;
  return (
    <span className={`badge badge-${tone || 'info'}`} title={title}>
      {prefix && !bare && <span className="badge-prefix">{prefix}:</span>} {text}
    </span>
  );
}

export function LocationBadge({ status }: { status: string }) {
  const tone: Tone = status === 'WITHIN_GEOFENCE' ? 'success' : status === 'NOT_CAPTURED' ? 'neutral' : status === 'COMMUNITY_REVIEW' ? 'info' : 'warn';
  return <span className={`badge badge-${tone}`}>{label(LOCATION_LABELS, status)}</span>;
}

export function RouteBadge({ route }: { route: string | null | undefined }) {
  const lang = pageLang();
  return route ? <span className="badge badge-route" title={`${lang === 'sw' ? 'Njia' : 'Route'} ${route}`}>{routeLabel(route, lang)}</span> : <span className="badge badge-warn">{routeLabel(null, lang)}</span>;
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
  return (
    <div className="empty">
      <span className="empty-icon" aria-hidden="true"><Icon name="layers" size={22} /></span>
      <div>{children}</div>
    </div>
  );
}

export function Loading({ label: text = pageLang() === 'sw' ? 'Inapakia…' : 'Loading…' }: { label?: string }) {
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
export function DevCodeNotice({ code, label: text = 'Test code (real users get it by SMS)' }: { code?: string | null; label?: string }) {
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
      if (e.key === 'Tab' && node && dialogStack[dialogStack.length - 1] === token) {
        const stops = Array.from(node.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'));
        if (!stops.length) return;
        const first = stops[0];
        const last = stops[stops.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
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
          <button className="btn btn-ghost" data-close onClick={onClose} aria-label={pageLang() === 'sw' ? 'Funga' : 'Close'}>
            <Icon name="close" size={18} />
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
          <button className="btn btn-ghost" data-close onClick={onClose} aria-label={pageLang() === 'sw' ? 'Funga' : 'Close'}>
            <Icon name="close" size={18} />
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
  const sw = pageLang() === 'sw';
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
        <Field label={required ? (sw ? 'Sababu (lazima)' : 'Reason (required)') : (sw ? 'Maoni (si lazima)' : 'Comment (optional)')}>
          <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required={required} maxLength={2000} />
        </Field>
        <Alert>{error}</Alert>
        <div className="row">
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (required && !comment.trim())}>
            {busy ? (sw ? 'Inashughulikia…' : 'Working…') : confirmLabel}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {sw ? 'Ghairi' : 'Cancel'}
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
  const move = (event: React.KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = tabs.findIndex((t) => t.key === value);
    onChange(tabs[(index + step + tabs.length) % tabs.length].key);
  };
  return (
    <div className="segmented" role="tablist" aria-label={aria} onKeyDown={move}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === value} tabIndex={t.key === value ? 0 : -1} onClick={() => onChange(t.key)}>
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
  const sw = pageLang() === 'sw';
  if (!rows.length) return <p className="muted">{sw ? 'Bado hakuna historia.' : 'No history yet.'}</p>;
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
            {a.actor_name || (sw ? 'Mfumo' : 'System')}
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


export interface Kpi {
  label: React.ReactNode;
  value: React.ReactNode;
  /** A short second line, e.g. "2 over 24 h". */
  note?: React.ReactNode;
  tone?: Tone;
  icon?: IconName;
  /** Makes the tile a button, e.g. to filter the list below. */
  onClick?: () => void;
  active?: boolean;
}

/** A row of headline numbers at the top of a work page: what is waiting, done and owed, at a glance. */
export function KpiStrip({ items, label: aria }: { items: Kpi[]; label?: string }) {
  return (
    <div className="kpis" role="group" aria-label={aria}>
      {items.map((item, index) => {
        const body = (
          <>
            {item.icon && <span className="kpi-icon" aria-hidden="true"><Icon name={item.icon} size={18} /></span>}
            <span className="kpi-text">
              <span className="kpi-value">{item.value}</span>
              <span className="kpi-label">{item.label}</span>
              {item.note && <span className="kpi-note">{item.note}</span>}
            </span>
          </>
        );
        const className = `kpi kpi-${item.tone || 'neutral'}${item.active ? ' is-active' : ''}`;
        return item.onClick
          ? <button key={index} type="button" className={className} onClick={item.onClick} aria-pressed={!!item.active}>{body}</button>
          : <div key={index} className={className}>{body}</div>;
      })}
    </div>
  );
}

/** Payroll, Services or Legacy as a small coloured chip, in the reader's language. */
export function WorkTypeChip({ type }: { type: string | null | undefined }) {
  if (!type) return <span className="muted">—</span>;
  return <span className={`chip chip-${type.toLowerCase()}`}>{workTypeName(type, pageLang())}</span>;
}

/** A person in a table: initials, name, and a quiet second line such as the facility. */
export function PersonCell({ name, sub }: { name: string | null | undefined; sub?: React.ReactNode }) {
  return (
    <span className="person-cell">
      <span className="avatar-sm" aria-hidden="true">{initialsOf(name)}</span>
      <span className="person-text">
        <span className="cell-main">{name || '—'}</span>
        {sub && <span className="cell-sub">{sub}</span>}
      </span>
    </span>
  );
}
