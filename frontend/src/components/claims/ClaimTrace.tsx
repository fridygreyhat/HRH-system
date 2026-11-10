import React from 'react';
import { useAuth } from '../../AuthContext';
import { CLAIM_ACTION_LABELS, CLAIM_ACTION_LABELS_SW, PAYMENT_STATUS_LABELS_SW, WORKLOG_ACTION_LABELS, dateOnly, dateTime, humanize, label, money, num, roleLabel } from '../../format';
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
  claim: { id: number; amount: number; currency: string; status: string; payment_status: string; category: string | null; staff_name: string; period: string; budget_line: string | null; approved_at: string | null };
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
const UNIT_LABEL_SW: Record<string, string> = { PER_DAY: 'siku', PER_HOUR: 'masaa', PER_UNIT: 'vipimo', FIXED: 'kiasi maalum' };
const RATE_STATUS_LABELS_SW: Record<string, string> = { PENDING_APPROVAL: 'inasubiri idhini', ACTIVE: 'inatumika', REJECTED: 'imekataliwa', RETIRED: 'imestaafishwa' };
const WORKLOG_ACTION_LABELS_SW: Record<string, string> = {
  create: 'Imeundwa',
  edit_header: 'Kichwa kimehaririwa',
  edit_entry: 'Taarifa ya siku imehaririwa',
  delete_entry: 'Taarifa ya siku imefutwa',
  submit: 'Wasilisha',
  recall: 'Uwasilishaji umerudishwa kwa kuhariri',
  cancel: 'Ghairi kumbukumbu ya kazi',
  verify: 'Hakiki na idhinisha (CTC)',
  return: 'Rudisha kwa mtoa huduma',
  confirm_otp: 'Imethibitishwa kwa namba ya SMS',
  decline: 'Kataa (ripoti tatizo)',
  endorse: 'Idhinisha mapitio ya kitaalamu',
  return_to_reviewer: 'Rudisha kwa mkaguzi aliyetangulia',
  reject: 'Kataa',
  authorize: 'Idhinisha (RM)',
  finance_timesheet_approve: 'Idhinisha jedwali',
  finance_review: 'Kamilisha mapitio ya Fedha',
  route_fhi360: 'Tuma FHI360',
  route_cso: 'Tuma CSO',
  paid: 'Rekodi imelipwa',
  hold: 'Zuio la kihistoria',
  release: 'Ondoa zuio la kihistoria',
  reopen: 'Fungua tena kwa marekebisho',
  facility_endorse: 'Idhini ya Mkuu wa Kituo',
  opened: 'Imefunguliwa kwa mapitio',
  otp_resend: 'Namba mpya imeombwa',
  otp_failed: 'Namba isiyo sahihi imewekwa',
};

function Chain({ rows, labels }: { rows: ChainRow[]; labels: Record<string, string> }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  if (!rows.length) return <Empty>{sw ? 'Hakuna hatua zilizorekodiwa.' : 'No steps recorded.'}</Empty>;
  return (
    <ol className="chain">
      {rows.map((r) => (
        <li key={r.id}>
          <span className="chain-dot" aria-hidden="true" />
          <div>
            <strong>{label(labels, r.action)}</strong>
            {r.version ? <span className="muted small"> · {sw ? 'toleo' : 'version'} {r.version}</span> : null}
            <div className="muted small">
              {r.actor_name || (sw ? 'Mfumo' : 'System')} {r.actor_role ? `(${roleLabel(r.actor_role)})` : ''} · {dateTime(r.timestamp)}
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
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const { data: t, error, loading } = useApi<Trace>(`/claims/${claimId}/trace`);
  if (error) return <Alert>{error}</Alert>;
  if (!t) return <p className="muted">{loading ? (sw ? 'Inafuatilia…' : 'Tracing…') : ''}</p>;
  const s = t.summary;

  return (
    <div className="stack-lg">
      <div className="lineage" aria-label={sw ? 'Mtiririko wa dai' : 'Lineage'}>
        {t.work_log ? (
          <>
            <div className="lineage-step">
              <span className="lineage-k">{sw ? 'Kazi ya kila siku' : 'Daily work'}</span>
              <strong>{sw ? `Siku ${num(t.work_log.days)}` : `${num(t.work_log.days)} day(s)`}</strong>
              <span className="muted small">{sw ? 'Kumbukumbu ya kazi' : 'Work log'} #{t.work_log.id}</span>
            </div>
            <Icon name="chevron" />
            <div className="lineage-step">
              <span className="lineage-k">{sw ? 'Imethibitishwa na mtoa huduma' : 'Confirmed by provider'}</span>
              <strong>{t.work_log.confirmed_version ? `${sw ? 'Toleo' : 'Version'} ${t.work_log.confirmed_version}` : (sw ? 'Haijathibitishwa' : 'Not confirmed')}</strong>
              <span className="muted small">{dateTime(t.work_log.confirmed_at)}</span>
            </div>
            <Icon name="chevron" />
            <div className="lineage-step">
              <span className="lineage-k">{sw ? 'Kumbukumbu imeidhinishwa' : 'Work log approved'}</span>
              <strong>{dateOnly(t.work_log.approved_at)}</strong>
              <StatusBadge kind="log" status={t.work_log.status} bare />
            </div>
          </>
        ) : (
          <div className="lineage-step">
            <span className="lineage-k">{sw ? 'Vipimo vilivyotangazwa' : 'Declared units'}</span>
            <strong>{Object.entries(t.declared_units || {}).map(([k, v]) => `${humanize(k)}: ${num(v)}`).join(' · ') || '—'}</strong>
            <span className="muted small">{t.community_verification ? `${sw ? 'Imehakikiwa na' : 'Verified by'} ${t.community_verification.verified_by}` : (sw ? 'Bado haijahakikiwa' : 'Not yet verified')}</span>
          </div>
        )}
        <Icon name="chevron" />
        <div className="lineage-step">
          <span className="lineage-k">{sw ? 'Dai' : 'Claim'}</span>
          <strong>{money(t.claim.amount, t.claim.currency)}</strong>
          <StatusBadge kind="claim" status={t.claim.status} bare />
        </div>
        <Icon name="chevron" />
        <div className="lineage-step">
          <span className="lineage-k">{sw ? 'Malipo' : 'Payment'}</span>
          <strong>{t.payments.length ? (sw ? `Rekodi ${t.payments.length}` : `${t.payments.length} record(s)`) : '—'}</strong>
          <StatusBadge kind="payment" status={t.claim.payment_status} bare />
        </div>
      </div>

      <div className="checks-row">
        <Check
          ok={s.all_reconcile}
          yes={sw ? 'Kila kipimo kilicholipwa kinafuatiliwa hadi taarifa ya siku' : 'Every paid unit traces to a daily entry'}
          no={sw ? 'Thamani za kila siku hazilingani na vipimo vilivyolipwa' : 'Traced daily values do not match the paid units'}
          unknown={sw ? 'Vipimo vilitangazwa (hakuna taarifa za kila siku za kufuatilia)' : 'Units were declared (no daily entries to trace)'}
        />
        <Check
          ok={s.all_match_confirmed_version}
          yes={sw ? 'Inalingana na toleo alilothibitisha mtoa huduma' : 'Matches the version the provider confirmed'}
          no={sw ? 'Inatofautiana na toleo alilothibitisha mtoa huduma' : 'Differs from the provider-confirmed version'}
          unknown={sw ? 'Hakuna toleo lililothibitishwa na mtoa huduma la kulinganisha' : 'No provider-confirmed version to compare'}
        />
        <Check
          ok={s.location_exceptions.length === 0}
          yes={sw ? 'Hakuna dosari za mahali katika siku zilizolipwa' : 'No location exceptions on paid days'}
          no={`${sw ? 'Dosari za mahali tarehe' : 'Location exceptions on'} ${s.location_exceptions.map(dateOnly).join(', ')}`}
          unknown=""
        />
      </div>
      {s.all_reconcile === false && (
        <Alert>
          {sw
            ? 'Thamani za kila siku sasa zinatofautiana na kilicholipwa. Chunguza kabla ya malipo mengine.'
            : 'Daily values now differ from what was paid. Investigate before further payment.'}
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
                {sw ? `${UNIT_LABEL_SW[c.unit_type] || ''} ${num(c.units)}` : <>{num(c.units)} {UNIT_LABEL[c.unit_type] || ''}</>} × {money(c.rate, t.claim.currency)}
              </span>
              <strong>= {money(c.amount, t.claim.currency)}</strong>
            </div>
          </header>
          {c.measure_key && (
            <p className="small">
              {sw ? 'Inahesabu mstari wa fomu' : 'Counts the form row'} <strong>{c.measure_label_sw || c.measure_key}</strong>
              {c.measure_label_en && <span className="muted"> / {c.measure_label_en}</span>}
            </p>
          )}
          {c.rate_rule && (
            <p className="muted small">
              {sw ? (
                `Kanuni ya kiwango #${c.rate_rule.id} (${RATE_STATUS_LABELS_SW[c.rate_rule.status] || c.rate_rule.status.toLowerCase()}), inaanza ${dateOnly(c.rate_rule.effective_start_date)}${c.rate_rule.effective_end_date ? ` – ${dateOnly(c.rate_rule.effective_end_date)}` : ''}; imeundwa na ${c.rate_rule.created_by_name || '—'}${c.rate_rule.cap_amount !== null ? `; kikomo ${money(c.rate_rule.cap_amount, t.claim.currency)}` : ''}`
              ) : (
                <>
                  Rate rule #{c.rate_rule.id} ({c.rate_rule.status.toLowerCase()}), effective {dateOnly(c.rate_rule.effective_start_date)}
                  {c.rate_rule.effective_end_date ? ` – ${dateOnly(c.rate_rule.effective_end_date)}` : ''}; created by {c.rate_rule.created_by_name || '—'}
                  {c.rate_rule.cap_amount !== null ? `; capped at ${money(c.rate_rule.cap_amount, t.claim.currency)}` : ''}
                </>
              )}
            </p>
          )}
          {c.contributions.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{sw ? 'Tarehe' : 'Date'}</th>
                    <th scope="col" className="num">
                      {c.unit_type === 'PER_DAY' ? (sw ? 'Siku' : 'Day') : c.unit_type === 'PER_HOUR' ? (sw ? 'Masaa' : 'Hours') : (sw ? 'Thamani' : 'Value')}
                    </th>
                    <th scope="col">{sw ? 'Ushahidi / matokeo' : 'Evidence / output'}</th>
                    <th scope="col">{sw ? 'Mahali' : 'Location'}</th>
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
                    <th scope="row">{sw ? 'Jumla iliyofuatiliwa' : 'Traced total'}</th>
                    <td className="num">{num(c.traced_total)}</td>
                    <td colSpan={s.gps_visible ? 3 : 2}>
                      {c.reconciles ? (
                        <span className="badge badge-success">
                          <Icon name="check" size={13} /> {sw ? `Inalingana na ${num(c.units)} zilizolipwa` : <>Equals the {num(c.units)} paid</>}
                        </span>
                      ) : (
                        <span className="badge badge-danger">
                          <Icon name="alert" size={13} /> {sw ? 'Zilizolipwa' : 'Paid'} {num(c.units)}
                        </span>
                      )}
                      {c.matches_confirmed_version !== null && (
                        <span className="muted small"> · {sw ? 'toleo lililothibitishwa' : 'confirmed version'}: {num(c.confirmed_version_units)}</span>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>
      ))}
      {!t.components.length && <Empty>{sw ? 'Dai hili bado halina vipengele vyenye bei.' : 'This claim has no priced components yet.'}</Empty>}

      {t.evidence_text && (
        <Section title={sw ? 'Ushahidi wa dai' : 'Claim evidence'}>
          <p>{t.evidence_text}</p>
        </Section>
      )}

      <div className="grid-2 align-start">
        <Section title={sw ? 'Maamuzi ya kumbukumbu ya kazi' : 'Work-log decisions'}>
          {t.work_log ? <Chain rows={t.work_log_chain} labels={sw ? { ...WORKLOG_ACTION_LABELS, ...WORKLOG_ACTION_LABELS_SW } : WORKLOG_ACTION_LABELS} /> : <Empty>{sw ? 'Hakuna kumbukumbu ya kazi ya HRH nyuma ya dai hili.' : 'No HRH work log behind this claim.'}</Empty>}
        </Section>
        <Section title={sw ? 'Hatua za dai na malipo' : 'Claim and payment steps'}>
          <Chain rows={t.claim_chain} labels={sw ? { ...CLAIM_ACTION_LABELS, ...CLAIM_ACTION_LABELS_SW } : CLAIM_ACTION_LABELS} />
        </Section>
      </div>

      {t.payments.length > 0 && (
        <Section title={sw ? 'Malipo yaliyorekodiwa' : 'Payments recorded'}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{sw ? 'Tarehe' : 'Date'}</th>
                  <th scope="col">{sw ? 'Kumbukumbu' : 'Reference'}</th>
                  <th scope="col">{sw ? 'Matokeo' : 'Result'}</th>
                  <th scope="col" className="num">
                    {sw ? 'Kiasi' : 'Amount'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {t.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{dateOnly(p.payment_date)}</td>
                    <td>{p.payment_reference}</td>
                    <td>{(sw && PAYMENT_STATUS_LABELS_SW[p.status]) || humanize(p.status)}</td>
                    <td className="num">{money(p.amount, t.claim.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">{t.proof_count ? (sw ? `Faili ${t.proof_count} za uthibitisho zimeambatishwa.` : `${t.proof_count} proof file(s) attached.`) : (sw ? 'Bado hakuna uthibitisho ulioambatishwa.' : 'No proof attached yet.')}</p>
        </Section>
      )}
    </div>
  );
}
