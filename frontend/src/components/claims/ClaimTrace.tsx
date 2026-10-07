import React from 'react';
import { CLAIM_ACTION_LABELS, WORKLOG_ACTION_LABELS, dateOnly, dateTime, humanize, label, money, num, roleLabel } from '../../format';
import { useApi } from '../../hooks';
import { Icon } from '../Icon';
import { Alert, Empty, LocationBadge, Section, StatusBadge } from '../ui';

interface Contribution {
  entry_id: number;
  date: string;
  value: number;
  hours_worked: number;
  evidence_text: string;
  comment: string | null;
  location_status: string;
  gps_lat?: number | null;
  gps_lon?: number | null;
}

interface TraceComponent {
  id: number;
  component_name: string;
  unit_type: string;
  measure_key: string | null;
  measure_label_en: string | null;
  measure_label_sw: string | null;
  units: number;
  rate: number;
  amount: number;
  basis: string;
  rate_rule: {
    id: number;
    status: string;
    effective_start_date: string;
    effective_end_date: string | null;
    created_by_name: string | null;
    approved_by_name: string | null;
    approved_at: string | null;
    cap_amount: number | null;
  } | null;
  contributions: Contribution[];
  traced_total: number | null;
  reconciles: boolean | null;
  confirmed_version_units: number | null;
  matches_confirmed_version: boolean | null;
}

interface ChainRow {
  id: number;
  action: string;
  actor_name: string | null;
  actor_role: string | null;
  version?: number | null;
  comment: string | null;
  timestamp: string;
}

interface Trace {
  claim: { id: number; amount: number; currency: string; status: string; payment_status: string; category: string; staff_name: string; period: string; budget_line: string | null; approved_at: string | null };
  basis: 'WORK_LOG' | 'DECLARED_UNITS';
  work_log: { id: number; status: string; version: number; confirmed_version: number | null; confirmed_at: string | null; attested_at: string | null; approved_at: string | null; days: number } | null;
  declared_units: Record<string, number> | null;
  evidence_text: string | null;
  community_verification: { verified_by: string | null; verified_at: string } | null;
  components: TraceComponent[];
  summary: { all_reconcile: boolean | null; all_match_confirmed_version: boolean | null; components_total: number; location_exceptions: string[]; gps_visible: boolean };
  work_log_chain: ChainRow[];
  claim_chain: ChainRow[];
  payments: { id: number; payment_reference: string; amount: number; payment_date: string; status: string }[];
  proof_count: number | null;
}

function Check({ ok, yes, no, unknown }: { ok: boolean | null; yes: string; no: string; unknown: string }) {
  const tone = ok === null ? 'neutral' : ok ? 'success' : 'danger';
  return (
    <div className={`check check-${tone}`}>
      <Icon name={ok === null ? 'clock' : ok ? 'check' : 'alert'} size={18} />
      <span>{ok === null ? unknown : ok ? yes : no}</span>
    </div>
  );
}

const UNIT_LABEL: Record<string, string> = { PER_DAY: 'days', PER_HOUR: 'hours', PER_UNIT: 'units', FIXED: 'fixed' };

function Chain({ rows, labels }: { rows: ChainRow[]; labels: Record<string, string> }) {
  if (!rows.length) return <Empty>No steps recorded.</Empty>;
  return (
    <ol className="chain">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="chain-dot" aria-hidden="true" />
          <div>
            <strong>{label(labels, r.action)}</strong>
            {r.version ? <span className="muted small"> · version {r.version}</span> : null}
            <div className="muted small">
              {r.actor_name || 'System'} {r.actor_role ? `(${roleLabel(r.actor_role)})` : ''} · {dateTime(r.timestamp)}
            </div>
            {r.comment && <div className="small chain-comment">{r.comment}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Start-to-end lineage of a claim: from the money back to each day's recorded work and every decision. */
export function ClaimTrace({ claimId }: { claimId: number }) {
  const { data: t, error, loading } = useApi<Trace>(`/claims/${claimId}/trace`);
  if (error) return <Alert>{error}</Alert>;
  if (!t) return <p className="muted">{loading ? 'Tracing…' : ''}</p>;
  const s = t.summary;

  return (
    <div className="stack-lg">
      <div className="lineage" aria-label="Lineage">
        {t.work_log ? (
          <>
            <div className="lineage-step">
              <span className="lineage-k">Daily work</span>
              <strong>{num(t.work_log.days)} day(s)</strong>
              <span className="muted small">Work log #{t.work_log.id}</span>
            </div>
            <Icon name="chevron" />
            <div className="lineage-step">
              <span className="lineage-k">Confirmed by provider</span>
              <strong>{t.work_log.confirmed_version ? `Version ${t.work_log.confirmed_version}` : 'Not confirmed'}</strong>
              <span className="muted small">{dateTime(t.work_log.confirmed_at)}</span>
            </div>
            <Icon name="chevron" />
            <div className="lineage-step">
              <span className="lineage-k">Work log approved</span>
              <strong>{dateOnly(t.work_log.approved_at)}</strong>
              <StatusBadge kind="log" status={t.work_log.status} bare />
            </div>
          </>
        ) : (
          <div className="lineage-step">
            <span className="lineage-k">Declared units</span>
            <strong>{Object.entries(t.declared_units || {}).map(([k, v]) => `${humanize(k)}: ${num(v)}`).join(' · ') || '—'}</strong>
            <span className="muted small">{t.community_verification ? `Verified by ${t.community_verification.verified_by}` : 'Not yet verified'}</span>
          </div>
        )}
        <Icon name="chevron" />
        <div className="lineage-step">
          <span className="lineage-k">Claim</span>
          <strong>{money(t.claim.amount, t.claim.currency)}</strong>
          <StatusBadge kind="claim" status={t.claim.status} bare />
        </div>
        <Icon name="chevron" />
        <div className="lineage-step">
          <span className="lineage-k">Payment</span>
          <strong>{t.payments.length ? `${t.payments.length} record(s)` : '—'}</strong>
          <StatusBadge kind="payment" status={t.claim.payment_status} bare />
        </div>
      </div>

      <div className="checks-row">
        <Check ok={s.all_reconcile} yes="Every paid unit traces to a daily entry" no="Traced daily values do not match the paid units" unknown="Units were declared (no daily entries to trace)" />
        <Check
          ok={s.all_match_confirmed_version}
          yes="Matches the version the provider confirmed"
          no="Differs from the provider-confirmed version"
          unknown="No provider-confirmed version to compare"
        />
        <Check
          ok={s.location_exceptions.length === 0}
          yes="No location exceptions on paid days"
          no={`Location exceptions on ${s.location_exceptions.map(dateOnly).join(', ')}`}
          unknown=""
        />
      </div>
      {s.all_reconcile === false && (
        <Alert>
          The daily values now in the database differ from what was paid. Approved logs are locked in the system, so this points to a change made outside the
          normal workflow. Investigate before further payment.
        </Alert>
      )}

      {t.components.map((c) => (
        <section key={c.id} className="card trace-comp">
          <header className="trace-head">
            <div>
              <h3>{c.component_name}</h3>
              <p className="muted small">{c.basis}</p>
            </div>
            <div className="trace-formula">
              <span>
                {num(c.units)} {UNIT_LABEL[c.unit_type] || ''} × {money(c.rate, t.claim.currency)}
              </span>
              <strong>= {money(c.amount, t.claim.currency)}</strong>
            </div>
          </header>
          {c.measure_key && (
            <p className="small">
              Counts the form row <strong>{c.measure_label_sw || c.measure_key}</strong>
              {c.measure_label_en && <span className="muted"> / {c.measure_label_en}</span>}
            </p>
          )}
          {c.rate_rule && (
            <p className="muted small">
              Rate rule #{c.rate_rule.id} ({c.rate_rule.status.toLowerCase()}), effective {dateOnly(c.rate_rule.effective_start_date)}
              {c.rate_rule.effective_end_date ? ` – ${dateOnly(c.rate_rule.effective_end_date)}` : ''}; proposed by {c.rate_rule.created_by_name || '—'}, approved by{' '}
              {c.rate_rule.approved_by_name || '—'} {c.rate_rule.approved_at ? `on ${dateOnly(c.rate_rule.approved_at)}` : ''}
              {c.rate_rule.cap_amount !== null ? `; capped at ${money(c.rate_rule.cap_amount, t.claim.currency)}` : ''}
            </p>
          )}
          {c.contributions.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col" className="num">
                      {c.unit_type === 'PER_DAY' ? 'Day' : c.unit_type === 'PER_HOUR' ? 'Hours' : 'Value'}
                    </th>
                    <th scope="col">Evidence / output</th>
                    <th scope="col">Location</th>
                    {s.gps_visible && <th scope="col">GPS</th>}
                  </tr>
                </thead>
                <tbody>
                  {c.contributions.map((row) => (
                    <tr key={row.entry_id}>
                      <td className="nowrap">{dateOnly(row.date)}</td>
                      <td className="num">{num(row.value)}</td>
                      <td>
                        {row.evidence_text}
                        {row.comment && <div className="muted small">{row.comment}</div>}
                      </td>
                      <td>
                        <LocationBadge status={row.location_status} />
                      </td>
                      {s.gps_visible && <td className="nowrap small">{row.gps_lat !== null && row.gps_lat !== undefined ? `${Number(row.gps_lat).toFixed(5)}, ${Number(row.gps_lon).toFixed(5)}` : '—'}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Traced total</th>
                    <td className="num">{num(c.traced_total)}</td>
                    <td colSpan={s.gps_visible ? 3 : 2}>
                      {c.reconciles ? (
                        <span className="badge badge-success">
                          <Icon name="check" size={13} /> Equals the {num(c.units)} paid
                        </span>
                      ) : (
                        <span className="badge badge-danger">
                          <Icon name="alert" size={13} /> Paid {num(c.units)}
                        </span>
                      )}
                      {c.matches_confirmed_version !== null && (
                        <span className="muted small"> · confirmed version: {num(c.confirmed_version_units)}</span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      ))}
      {!t.components.length && <Empty>This claim has no priced components yet.</Empty>}

      {t.evidence_text && (
        <Section title="Claim evidence">
          <p>{t.evidence_text}</p>
        </Section>
      )}

      <div className="grid-2 align-start">
        <Section title="Work-log decisions">
          {t.work_log ? <Chain rows={t.work_log_chain} labels={WORKLOG_ACTION_LABELS} /> : <Empty>No HRH work log behind this claim.</Empty>}
        </Section>
        <Section title="Claim and payment steps">
          <Chain rows={t.claim_chain} labels={CLAIM_ACTION_LABELS} />
        </Section>
      </div>

      {t.payments.length > 0 && (
        <Section title="Payments recorded">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Result</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {t.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{dateOnly(p.payment_date)}</td>
                    <td>{p.payment_reference}</td>
                    <td>{humanize(p.status)}</td>
                    <td className="num">{money(p.amount, t.claim.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t.proof_count ? `${t.proof_count} proof file(s) attached.` : 'No proof attached yet.'}</p>
        </Section>
      )}
    </div>
  );
}
