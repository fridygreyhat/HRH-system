import React, { useState } from 'react';
import { qs } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateTime, humanize, roleLabel } from '../../format';
import { useApi } from '../../hooks';
import { AuditEvent, SmsOutboxRow } from '../../types';
import { AsyncState, Field, PersonCell, StatusBadge } from '../../components/ui';

const LIMITS = [50, 200, 500, 1000];
const OUTBOX_STATUSES = ['PENDING', 'SENT', 'FAILED', 'SUPPRESSED'];

export function OutboxSection() {
  const { hasRole } = useAuth();
  const [status, setStatus] = useState('');
  const [limit, setLimit] = useState(200);
  const { data, error, loading, reload } = useApi<SmsOutboxRow[]>(`/admin/sms-outbox${qs({ status, limit })}`);

  return (
    <section className="card stack">
      <div className="section-head">
        <h3>SMS outbox</h3>
        <button className="btn btn-secondary btn-sm" onClick={() => reload()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {!hasRole('SYSTEM_ADMIN') && <p className="muted">Phone numbers are partly hidden for your role.</p>}
      <div className="filters">
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {OUTBOX_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Show">
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {LIMITS.map((l) => (
              <option key={l} value={l}>
                Latest {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <AsyncState data={data} error={error} loading={loading} empty="No messages match.">
        {(rows) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Event</th>
                  <th>Recipient</th>
                  <th>Status</th>
                  <th className="num">Attempts</th>
                  <th>Last error</th>
                  <th>Related record</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className="cell-main">{dateTime(r.created_at)}</span>
                      <span className="cell-sub">{r.sent_at ? `Sent ${dateTime(r.sent_at)}` : 'Not sent'}</span>
                    </td>
                    <td className="nowrap">{humanize(r.event_name)}</td>
                    <td>
                      <span className="cell-main">{r.destination_phone}</span>
                      <span className="cell-sub">{r.language ? `Language: ${r.language}` : 'Language: —'}</span>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="num">{r.attempts}</td>
                    <td className="small">{r.last_error || '—'}</td>
                    <td className="small">
                      {r.related_type ? (
                        <>
                          {humanize(r.related_type)} #{r.related_id}
                          {r.related_status && <div className="muted">at {humanize(r.related_status)}</div>}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="small" style={{ minWidth: '16rem' }}>
                      {r.message_body}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncState>
    </section>
  );
}

const ENTITY_TYPES = [
  'auth',
  'user',
  'user_roles',
  'user_scopes',
  'setting',
  'sms_template',
  'rate_rule',
  'cadre',
  'cadre_form_field',
  'organizations',
  'regions',
  'clusters',
  'districts',
  'wards',
  'facilities',
  'community-areas',
  'sections',
  'pay-periods',
  'funding-sources',
  'claim-categories',
  'staff',
  'staff_assignment',
  'staff_change_request',
  'roster_import',
  'budget_line',
  'budget_sync',
  'payroll_batch',
  'payment_proof',
];

const json = (v: unknown) => (v === null || v === undefined ? 'null' : JSON.stringify(v, null, 2));

export function AuditSection() {
  const [entityType, setEntityType] = useState('');
  const [limit, setLimit] = useState(200);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { data, error, loading, reload } = useApi<AuditEvent[]>(`/admin/audit-events${qs({ entity_type: entityType, limit })}`);
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="card stack">
      <div className="section-head">
        <h3>Audit events</h3>
        <button className="btn btn-secondary btn-sm" onClick={() => reload()} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="filters">
        <Field label="Record type">
          <select value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">All types</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanize(t.replace(/-/g, '_'))}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Show">
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {LIMITS.map((l) => (
              <option key={l} value={l}>
                Latest {l}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <AsyncState data={data} error={error} loading={loading} empty="No audit events match.">
        {(rows) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Record</th>
                  <th>Action</th>
                  <th>Reason</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const expanded = open.has(a.id);
                  const hasDetail = a.before !== null || a.after !== null;
                  return (
                    <React.Fragment key={a.id}>
                      <tr>
                        <td className="nowrap">{dateTime(a.created_at)}</td>
                        <td>
                          <PersonCell
                            name={a.actor_name || 'System'}
                            sub={a.actor_roles ? a.actor_roles.split(',').map((r) => roleLabel(r.trim())).join(', ') : undefined}
                          />
                        </td>
                        <td className="nowrap">
                          {humanize(a.entity_type.replace(/-/g, '_'))}
                          {a.entity_id ? ` #${a.entity_id}` : ''}
                        </td>
                        <td>{humanize(a.action)}</td>
                        <td className="small">{a.reason || '—'}</td>
                        <td>
                          {hasDetail ? (
                            <button className="btn btn-ghost btn-sm" aria-expanded={expanded} onClick={() => toggle(a.id)}>
                              {expanded ? 'Hide' : 'Show'} changes
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={6}>
                            <div className="grid-2">
                              <div className="stack">
                                <strong className="small">Before</strong>
                                <pre className="json">{json(a.before)}</pre>
                              </div>
                              <div className="stack">
                                <strong className="small">After</strong>
                                <pre className="json">{json(a.after)}</pre>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AsyncState>
    </section>
  );
}
