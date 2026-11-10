import React, { useState } from 'react';
import { api, openBlob, saveBlob } from '../../api';
import { useAuth } from '../../AuthContext';
import {
  CLAIM_ACTION_LABELS,
  CLAIM_ACTION_LABELS_SW,
  CLAIM_REASON_REQUIRED,
  DESTRUCTIVE_ACTIONS,
  dateOnly,
  dateTime,
  fileSize,
  humanize,
  label,
  money,
  num,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS_SW,
  todayLocal,
} from '../../format';
import { useAction, useApi } from '../../hooks';
import { ClaimAudit, ClaimComponent, ClaimDetail, PaymentProof } from '../../types';
import { AdminAudit } from '../AdminAudit';
import { Alert, AuditTimeline, Drawer, Facts, Field, Modal, ReasonDialog, RouteBadge, Section, StatusBadge, Tabs } from '../ui';
import { ClaimTrace } from './ClaimTrace';
import { ServicesProofPaymentDialog } from './ServicesProofPaymentDialog';
import { PrintWorkLog } from '../../pages/PrintWorkLog';
import { navigate } from '../../nav';

const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const PROOF_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const UNIT_TYPE_LABELS_SW: Record<string, string> = { PER_DAY: 'Kwa siku', PER_HOUR: 'Kwa saa', PER_UNIT: 'Kwa kipimo', FIXED: 'Kiasi maalum' };
const ORIGIN_LABELS_SW: Record<string, string> = { FACILITY: 'Kituo', COMMUNITY: 'Jamii' };

export function ComponentsTable({ components, currency }: { components: ClaimComponent[]; currency: string }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  if (!components.length) return <p className="muted">{sw ? 'Hakuna vipengele vyenye bei.' : 'No priced components.'}</p>;
  const total = components.reduce((s, c) => s + Number(c.amount), 0);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{sw ? 'Kipengele' : 'Component'}</th>
            <th>{sw ? 'Kipimo' : 'Unit'}</th>
            <th className="num">{sw ? 'Idadi' : 'Units'}</th>
            <th className="num">{sw ? 'Kiwango' : 'Rate'}</th>
            <th className="num">{sw ? 'Kikomo' : 'Cap'}</th>
            <th className="num">{sw ? 'Kiasi' : 'Amount'}</th>
          </tr>
        </thead>
        <tbody>
          {components.map((c, i) => (
            <tr key={c.id ?? `${c.component_name}-${i}`}>
              <td>{c.component_name}</td>
              <td>
                {(sw && c.unit_type && UNIT_TYPE_LABELS_SW[c.unit_type]) || humanize(c.unit_type)}
                {c.measure_key ? <div className="muted small">{c.measure_key}</div> : null}
              </td>
              <td className="num">{num(c.units)}</td>
              <td className="num">× {money(c.rate, currency)}</td>
              <td className="num">{c.cap_amount !== undefined && c.cap_amount !== null ? money(c.cap_amount, currency) : '—'}</td>
              <td className="num">= {money(c.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={5}>{sw ? 'Jumla' : 'Total'}</th>
            <th className="num">{money(total, currency)}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function auditRows(rows: ClaimAudit[]) {
  return rows.map((a) => ({
    ...a,
    extra:
      a.old_payment_status !== a.new_payment_status && a.new_payment_status ? (
        <div className="row-inline small">
          {a.old_payment_status && <StatusBadge kind="payment" status={a.old_payment_status} />}
          {a.old_payment_status && <span aria-hidden>→</span>}
          <StatusBadge kind="payment" status={a.new_payment_status} />
        </div>
      ) : a.details && Object.keys(a.details).length ? (
        <div className="muted small">
          {Object.entries(a.details)
            .map(([k, v]) => `${humanize(k)}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
            .join(' · ')}
        </div>
      ) : null,
  }));
}

function RecordPaymentDialog({ claim, onDone, onClose }: { claim: ClaimDetail; onDone: (c: ClaimDetail) => void; onClose: () => void }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const outstanding = Math.max(0, Number(claim.amount) - Number(claim.amount_paid));
  const [amount, setAmount] = useState(String(outstanding));
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayLocal());
  const [status, setStatus] = useState('PAID');
  const [method, setMethod] = useState('');
  const { busy, error, run } = useAction();
  const value = Number(amount);
  const tooMuch = status !== 'FAILED' && value > outstanding;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await run(() =>
      api.post<ClaimDetail>(`/claims/${claim.id}/payments`, {
        amount: value,
        payment_reference: reference.trim(),
        payment_date: paymentDate,
        status,
        payment_method: method.trim() || null,
      }),
    );
    if (result) onDone(result);
  };
  return (
    <Modal title={sw ? `Rekodi malipo – dai #${claim.id}` : `Record payment – claim #${claim.id}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="notice notice-info">
          {sw ? 'Kilichobaki:' : 'Outstanding:'} <strong>{money(outstanding, claim.currency)}</strong>.
        </p>
        <div className="grid-2">
          <Field label={sw ? 'Kiasi' : 'Amount'} hint={sw ? `Kisichozidi ${money(outstanding, claim.currency)}` : `At most ${money(outstanding, claim.currency)}`}>
            <input type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={sw ? 'Matokeo' : 'Result'}>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PAID">{sw ? 'Imelipwa (kamili au awamu ya mwisho)' : 'Paid (full or final instalment)'}</option>
              <option value="PARTIAL">{sw ? 'Malipo ya sehemu' : 'Partial payment'}</option>
              <option value="FAILED">{sw ? 'Jaribio lililoshindikana' : 'Failed attempt'}</option>
            </select>
          </Field>
          <Field label={sw ? 'Kumbukumbu ya malipo' : 'Payment reference'}>
            <input required minLength={2} maxLength={255} value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label={sw ? 'Tarehe ya malipo' : 'Payment date'}>
            <input type="date" required max={todayLocal()} value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} />
          </Field>
          <Field label={sw ? 'Njia ya malipo (si lazima)' : 'Payment method (optional)'} hint={sw ? 'Mishahara ya HCP lazima ilipwe kwenye akaunti ya benki' : 'HCP salaries must be paid into a bank account'}>
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">{sw ? 'Haijabainishwa' : 'Not specified'}</option>
              <option value="BANK">{sw ? 'Akaunti ya benki' : 'Bank account'}</option>
              <option value="MOBILE_WALLET">{sw ? 'Pesa kwa simu' : 'Mobile wallet'}</option>
            </select>
          </Field>
        </div>
        {tooMuch && <Alert kind="warn">{sw ? 'Kiasi ni kikubwa kuliko salio lililobaki.' : 'The amount is more than the outstanding balance.'}</Alert>}
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || tooMuch || !(value > 0) || reference.trim().length < 2}>
            {busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Rekodi malipo' : 'Record payment')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {sw ? 'Ghairi' : 'Cancel'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function UploadProofDialog({ claim, onDone, onClose }: { claim: ClaimDetail; onDone: (c: ClaimDetail) => void; onClose: () => void }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const [file, setFile] = useState<File | null>(null);
  const [recordId, setRecordId] = useState('');
  const { busy, error, setError, run } = useAction();
  const choose = (f: File | null) => {
    setError(null);
    if (f && !PROOF_TYPES.includes(f.type)) setError(sw ? 'Uthibitisho lazima uwe faili la PDF, PNG au JPEG.' : 'Proof must be a PDF, PNG or JPEG file.');
    else if (f && f.size > MAX_PROOF_BYTES) setError(sw ? 'Faili ni kubwa kuliko MB 10.' : 'The file is larger than 10 MB.');
    setFile(f);
  };
  const valid = !!file && PROOF_TYPES.includes(file.type) && file.size <= MAX_PROOF_BYTES;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !valid) return;
    const form = new FormData();
    form.append('file', file);
    if (recordId) form.append('payment_record_id', recordId);
    const result = await run(() => api.upload<ClaimDetail>(`/claims/${claim.id}/proofs`, form));
    if (result) onDone(result);
  };
  return (
    <Modal title={sw ? `Pakia uthibitisho – dai #${claim.id}` : `Upload proof – claim #${claim.id}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p className="notice">
          {sw ? (
            <>Kupakia uthibitisho <strong>hakuweki</strong> dai kuwa limelipwa.</>
          ) : (
            <>Uploading proof does <strong>not</strong> mark the claim paid.</>
          )}
        </p>
        <Field label={sw ? 'Faili la uthibitisho (PDF, PNG au JPEG, hadi MB 10)' : 'Proof file (PDF, PNG or JPEG, up to 10 MB)'}>
          <input type="file" accept="application/pdf,image/png,image/jpeg" required onChange={(e) => choose(e.target.files?.[0] || null)} />
        </Field>
        {claim.payments.length > 0 && (
          <Field label={sw ? 'Unganisha na rekodi ya malipo (si lazima)' : 'Link to payment record (optional)'}>
            <select value={recordId} onChange={(e) => setRecordId(e.target.value)}>
              <option value="">{sw ? 'Haijaunganishwa' : 'Not linked'}</option>
              {claim.payments.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.payment_reference} · {money(p.amount, claim.currency)} · {(sw && PAYMENT_STATUS_LABELS_SW[p.status]) || humanize(p.status)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !valid}>
            {busy ? (sw ? 'Inapakia…' : 'Uploading…') : (sw ? 'Pakia uthibitisho' : 'Upload proof')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            {sw ? 'Ghairi' : 'Cancel'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type Dialog =
  | { kind: 'action'; action: string }
  | { kind: 'record_payment' }
  | { kind: 'upload_proof' }
  | { kind: 'services_proof_payment' }
  | null;

/** Claim detail drawer: components, budget line, exceptions, audit, workflow and payment actions (server-provided only). */
export function ClaimDrawer({ claimId, onClose, onChanged }: { claimId: number; onClose: () => void; onChanged?: () => void }) {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const actionLabel = (a: string) => (sw && CLAIM_ACTION_LABELS_SW[a]) || CLAIM_ACTION_LABELS[a] || humanize(a);
  const isRpmWithoutFinanceRole = hasRole('RPM') && !hasRole('REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE');
  const { data: claim, error, loading, setData, reload } = useApi<ClaimDetail>(`/claims/${claimId}`);
  const canSeeBudgetDetails = hasRole('FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [tab, setTab] = useState<'overview' | 'trace'>('overview');
  const [notice, setNotice] = useState<string | null>(null);
  const [centralConfirmed, setCentralConfirmed] = useState(false);
  const [previewReadyFor, setPreviewReadyFor] = useState('');
  const previewKey = claim ? `${claim.id}:${claim.amount}:${claim.status}` : '';
  const previewReady = !!previewKey && previewReadyFor === previewKey;
  const centralAction = useAction();
  React.useEffect(() => { setCentralConfirmed(false); }, [claim?.id, claim?.amount, claim?.status]);
  const markPreviewReady = React.useCallback(() => setPreviewReadyFor(previewKey), [previewKey]);
  const proofAction = useAction();

  const updated = (c: ClaimDetail, message: string) => {
    setData(c);
    setDialog(null);
    setNotice(message);
    onChanged?.();
  };

  const runAction = async (action: string, comment: string) => {
    const result = await api.post<ClaimDetail>(`/claims/${claimId}/actions/${action}`, { comment: comment || null });
    updated(result, `${actionLabel(action)}: ${sw ? 'imekamilika' : 'done'}.`);
  };

  const fetchProof = (proof: PaymentProof, open: boolean) =>
    proofAction.run(async () => {
      const file = await api.blob(`/claims/${claimId}/proofs/${proof.id}`, 'GET', proof.original_filename);
      if (open) openBlob(file);
      else saveBlob(file);
    });

  const outstanding = claim ? Math.max(0, Number(claim.amount) - Number(claim.amount_paid)) : 0;
  const paid = claim && (claim.payment_status === 'PAID' || claim.payment_status === 'RECONCILED');
  const financeReviewPending = claim?.status === 'PENDING_FINANCE_REVIEW';
  const paymentActions = claim && !isRpmWithoutFinanceRole && !financeReviewPending ? claim.payment_actions : [];
  const noBudgetPolicy = claim?.payment_policy === 'FIXED_DAILY_MONTHLY_REGIONAL_BUDGET' || claim?.payment_policy === 'FIXED_DAILY_NO_BUDGET' || claim?.payment_policy === 'APPROVED_AMOUNTS_NO_BUDGET';
  const budget = claim && !noBudgetPolicy && canSeeBudgetDetails && claim.budget_line && claim.budget_line.id === claim.budget_line_id
    ? claim.budget_line
    : undefined;
  const exposure = budget ? Number(budget.committed_amount || 0) + Number(budget.spent_amount || 0) : 0;
  const estimateReached = !!budget && budget.estimated_amount != null && exposure > 0 && exposure >= budget.estimated_amount;

  return (
    <Drawer title={`${sw ? 'Dai' : 'Claim'} #${claimId}`} onClose={onClose} wide>
      {error && <Alert>{error}</Alert>}
      {!claim && loading && <p className="muted">{sw ? 'Inapakia…' : 'Loading…'}</p>}
      {claim && (
        <div className="stack-lg">
          <div className="stack">
            <div className="badges">
              <RouteBadge route={claim.route_code} />
              <StatusBadge kind="claim" status={claim.status} />
              <StatusBadge kind="payment" status={claim.payment_status} />
            </div>
            <div className="stats">
              <div className="stat card">
                <div className="stat-label">{sw ? 'Kiasi cha dai' : 'Claim amount'}</div>
                <div className="stat-value">{money(claim.amount, claim.currency)}</div>
              </div>
              <div className="stat card">
                <div className="stat-label">{sw ? 'Malipo yaliyorekodiwa' : 'Payments recorded'}</div>
                <div className="stat-value">{money(claim.amount_paid, claim.currency)}</div>
                <div className="stat-hint">{paid ? (sw && PAYMENT_STATUS_LABELS_SW[claim.payment_status]) || label(PAYMENT_STATUS_LABELS, claim.payment_status) : (sw ? 'Bado hayajawekwa kuwa yamelipwa' : 'Not marked paid')}</div>
              </div>
              <div className="stat card">
                <div className="stat-label">{sw ? 'Kilichobaki' : 'Outstanding'}</div>
                <div className="stat-value">{money(outstanding, claim.currency)}</div>
              </div>
            </div>
          </div>
          <Tabs
            label={sw ? 'Mwonekano wa dai' : 'Claim view'}
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'overview', label: sw ? 'Muhtasari na hatua' : 'Overview & actions' },
              { key: 'trace', label: sw ? 'Fuatilia hadi kazi ya kila siku' : 'Trace to daily work' },
            ]}
          />
          {claim.central_reviewer_id && (
            <Section title={sw ? 'Mapitio ya Huduma ya Fedha Kuu' : 'Central Finance Services review'}>
              <Facts items={[
                [sw ? 'Mkaguzi aliyepangiwa' : 'Assigned reviewer', claim.central_reviewer_name],
                [sw ? 'Idhini ya Fedha Kuu' : 'Central approval', claim.central_reviewed_at ? dateTime(claim.central_reviewed_at) : (sw ? 'Inasubiri mkaguzi aliyechaguliwa' : 'Pending selected reviewer')],
              ]} />
              {claim.status === 'PENDING_CENTRAL_REVIEW' && <p className="notice notice-info">{sw ? 'Kurekodi malipo kumezuiwa hadi mkaguzi aliyechaguliwa aidhinishe.' : 'Payment recording is blocked until the selected reviewer approves.'}</p>}
              {claim.available_actions.includes('central_approve') && claim.work_log_id && <>
                <h3>{sw ? 'Muonekano wa kuchapisha kwa idhini' : 'Approval print preview'}</h3>
                <p>{claim.staff_name} · {claim.period_label} · {money(claim.amount, claim.currency)}</p>
                <ComponentsTable components={claim.components} currency={claim.currency} />
                <PrintWorkLog logId={claim.work_log_id} embedded onReady={markPreviewReady} />
                <button className="btn btn-secondary" onClick={() => navigate('print', claim.work_log_id!)}>{sw ? 'Fungua ripoti ya kuchapisha' : 'Open printable report'}</button>
                <label className="row">
                  <input type="checkbox" checked={centralConfirmed} disabled={!previewReady} onChange={event => setCentralConfirmed(event.target.checked)} />
                  {sw ? 'Nimekagua ripoti kamili ya Huduma, mtoa huduma na kiasi cha malipo.' : 'I have reviewed the full Services report, provider and payment amount.'}
                </label>
                <Alert>{centralAction.error}</Alert>
                <button className="btn btn-primary" disabled={!previewReady || !centralConfirmed || centralAction.busy} onClick={async () => {
                  const result = await centralAction.run(() => api.post<ClaimDetail>(`/claims/${claim.id}/actions/central_approve`, {
                    review_confirmed: centralConfirmed, expected_amount: claim.amount,
                  }));
                  if (result) updated(result, sw ? 'Fedha Kuu imeidhinisha. Huduma ziko tayari kwa kurekodi malipo.' : 'Central Finance approved. Services are ready for payment recording.');
                }}>{centralAction.busy ? (sw ? 'Inaidhinisha…' : 'Approving…') : (sw ? 'Idhinisha Huduma kwa malipo' : 'Approve Services for payment')}</button>
              </>}
            </Section>
          )}
          {tab === 'trace' ? (
            <ClaimTrace claimId={claimId} />
          ) : (
            <>
          {claim.exception_reason && (
            <div className="alert alert-warn" role="status">
              <strong>{sw ? 'Dosari – inahitaji kushughulikiwa:' : 'Exception – needs attention:'}</strong> {claim.exception_reason}
            </div>
          )}
          <Alert kind="success">{notice}</Alert>
          {estimateReached && budget && (
            <Alert kind="warn">
              {sw
                ? `Makadirio yamefikiwa kwa ${budget.code}: ${money(exposure, claim.currency)} kati ya ${money(budget.estimated_amount!, claim.currency)} zilizokadiriwa.`
                : `Soft estimate reached for ${budget.code}: ${money(exposure, claim.currency)} of ${money(budget.estimated_amount!, claim.currency)} estimated.`}
            </Alert>
          )}
          {financeReviewPending && (
            <p className="notice notice-info">
              {sw
                ? 'Linasubiri mapitio ya Fedha ya Mkoa; bado haliwezi kulipwa.'
                : 'Awaiting Regional Finance review; not payable yet.'}
            </p>
          )}
          {claim.payment_recipient && (
            <Section title={sw ? 'Mpokea malipo · uhakiki wa CSO' : 'Payment recipient · CSO verification'}>
              <Facts items={[
                [sw ? 'Mpokeaji' : 'Recipient', claim.payment_recipient.name],
                [sw ? 'Njia ya malipo' : 'Payment method', claim.payment_recipient.payment_method],
                [sw ? 'Mtoa huduma ya malipo' : 'Provider', claim.payment_recipient.payment_provider],
                [sw ? 'Akaunti' : 'Account', claim.payment_recipient.payment_account],
                ...(claim.payment_recipient.bank_branch ? [[sw ? 'Tawi la benki' : 'Bank branch', claim.payment_recipient.bank_branch] as [string, React.ReactNode]] : []),
              ]} />
            </Section>
          )}

          {claim.available_actions.length > 0 && (
            <Section title={sw ? 'Hatua za dai' : 'Claim actions'}>
              <div className="row">
                {claim.available_actions.filter((a) => a !== 'central_approve' && (!financeReviewPending || !['mark_ready', 'export'].includes(a))).map((a) => (
                  <button
                    key={a}
                    className={`btn ${DESTRUCTIVE_ACTIONS.has(a) ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={() => setDialog({ kind: 'action', action: a })}
                  >
                    {actionLabel(a)}
                  </button>
                ))}
              </div>
              <p className="muted small">{sw ? 'Anayeidhinisha lazima awe tofauti na aliyeandaa.' : 'The approver must differ from the preparer.'}</p>
            </Section>
          )}

          <Section title={sw ? 'Taarifa' : 'Details'}>
            <Facts
              items={[
                [sw ? 'Mtumishi' : 'Staff', claim.staff_name],
                [sw ? 'Kategoria' : 'Category', claim.category_name || (claim.category_id == null ? (sw ? 'Bado haijachaguliwa' : 'Not selected yet') : `${sw ? 'Kategoria' : 'Category'} #${claim.category_id}`)],
                [sw ? 'Kipindi' : 'Period', claim.period_label],
                [sw ? 'Mlipaji' : 'Payor', claim.payor_name],
                [sw ? 'Mtekelezaji (analipa)' : 'Executor (pays)', claim.executor_name],
                ...(!noBudgetPolicy && claim.budget_line_id != null
                  ? [[sw ? 'Kifungu cha bajeti' : 'Budget line', claim.budget_line ? `${claim.budget_line.code} – ${claim.budget_line.name}` : (sw ? 'Hakijabainishwa' : 'Not resolved')] as [string, React.ReactNode]]
                  : []),
                [sw ? 'Chanzo' : 'Origin', (sw && claim.origin_channel && ORIGIN_LABELS_SW[claim.origin_channel]) || humanize(claim.origin_channel)],
                [sw ? 'Kumbukumbu ya kazi' : 'Work log', claim.work_log_id ? `#${claim.work_log_id}` : (sw ? 'Hakuna (dai la jamii)' : 'None (community claim)')],
                [sw ? 'Kundi la malipo' : 'Batch', claim.batch_reference],
                [sw ? 'Imeundwa' : 'Created', dateTime(claim.created_at)],
                [sw ? 'Uhakiki wa jamii' : 'Community verified', claim.verified_at ? dateTime(claim.verified_at) : null],
                [sw ? 'Imeidhinishwa' : 'Approved', claim.approved_at ? dateTime(claim.approved_at) : null],
              ]}
            />
            {(claim.description || claim.evidence_text) && (
              <div>
                <div className="field-label">{claim.work_type === 'COMMUNITY' ? (sw ? 'Maelezo' : 'Description') : (sw ? 'Ushahidi' : 'Evidence')}</div>
                <p className="timeline-comment">{claim.description || claim.evidence_text}</p>
              </div>
            )}
            {claim.declared_units && Object.keys(claim.declared_units).length > 0 && (
              <div>
                <div className="field-label">{sw ? 'Vipimo vilivyotangazwa' : 'Declared units'}</div>
                <p className="timeline-comment">
                  {Object.entries(claim.declared_units)
                    .map(([k, v]) => `${humanize(k)}: ${num(v)}`)
                    .join(' · ')}
                </p>
              </div>
            )}
          </Section>

          <Section title={sw ? 'Ukokotoaji' : 'Calculation'}>
            <ComponentsTable components={claim.components} currency={claim.currency} />
            {claim.calculation_snapshot ? (
              <p className="muted small">
                {sw
                  ? `Imefungwa wakati wa idhini (${dateTime(claim.calculation_snapshot.authorized_at)}): njia ${claim.calculation_snapshot.route}, ${money(claim.calculation_snapshot.amount, claim.currency)}.`
                  : `Frozen at approval (${dateTime(claim.calculation_snapshot.authorized_at)}): route ${claim.calculation_snapshot.route}, ${money(claim.calculation_snapshot.amount, claim.currency)}.`}
              </p>
            ) : (
              <p className="muted small">{sw ? 'Bado halijaidhinishwa: kiasi kinafuata viwango vya sasa.' : 'Not yet approved: the amount follows current rates.'}</p>
            )}
          </Section>

          {(claim.payments.length > 0 || claim.proofs.length > 0 || paymentActions.length > 0 || (hasRole('FHI360_FINANCE') && claim.payment_manifest?.can_record_with_proof)) && (
            <Section
              title={sw ? 'Malipo' : 'Payment'}
              actions={
                <>
                  {paymentActions.map((a) => (
                    <button
                      key={a}
                      className={`btn btn-sm ${a === 'record_payment' ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setDialog(a === 'record_payment' || a === 'upload_proof' ? { kind: a } : { kind: 'action', action: a })}
                    >
                      {actionLabel(a)}
                    </button>
                  ))}
                  {hasRole('FHI360_FINANCE') && claim.payment_manifest?.can_record_with_proof && (
                    <button className="btn btn-primary btn-sm" onClick={() => setDialog({ kind: 'services_proof_payment' })}>
                      {sw ? 'Uthibitisho + malipo ya Huduma' : 'Services proof + payment'}
                    </button>
                  )}
                </>
              }
            >
              <p className="notice notice-info small">
                {sw
                  ? 'Dai linakuwa “Imelipwa” malipo kamili na uthibitisho yakirekodiwa.'
                  : 'A claim is “Paid” once full payment and proof are recorded.'}
              </p>
              {claim.payments.length > 0 ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{sw ? 'Kumbukumbu' : 'Reference'}</th>
                        <th>{sw ? 'Tarehe' : 'Date'}</th>
                        <th>{sw ? 'Njia' : 'Method'}</th>
                        <th>{sw ? 'Matokeo' : 'Result'}</th>
                        <th className="num">{sw ? 'Kiasi' : 'Amount'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claim.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{p.payment_reference}</td>
                          <td>{dateOnly(p.payment_date)}</td>
                          <td>{p.payment_method || '—'}</td>
                          <td>
                            <StatusBadge status={p.status} label={sw ? PAYMENT_STATUS_LABELS_SW[p.status] : undefined} />
                          </td>
                          <td className="num">{money(p.amount, claim.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="muted">{sw ? 'Hakuna malipo yaliyorekodiwa.' : 'No payments recorded.'}</p>
              )}
              <h3>{sw ? 'Uthibitisho wa malipo' : 'Proof of payment'}</h3>
              {claim.proofs.length ? (
                <ul className="stack" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {claim.proofs.map((p) => (
                    <li key={p.id} className="row-between">
                      <span>
                        {p.original_filename} <span className="muted small">({fileSize(p.size_bytes)}{p.created_at ? `, ${dateTime(p.created_at)}` : ''})</span>
                        {p.beneficiary_snapshot && (
                          <span className="proof-beneficiary-meta">
                            <strong>{p.beneficiary_snapshot.provider_name}</strong>
                            {p.beneficiary_snapshot.services?.length ? ` · ${p.beneficiary_snapshot.services.join(', ')}` : ''}
                            {p.beneficiary_snapshot.provider_id != null && ` · ${sw ? 'Mtoa huduma' : 'Provider'} #${p.beneficiary_snapshot.provider_id}`}
                            {(p.beneficiary_snapshot.claim_amount ?? p.beneficiary_snapshot.amount) != null &&
                              ` · ${sw ? 'Dai' : 'Claim'} ${money(p.beneficiary_snapshot.claim_amount ?? p.beneficiary_snapshot.amount, p.beneficiary_snapshot.currency)}`}
                            {p.beneficiary_snapshot.payment_amount != null &&
                              ` · ${sw ? 'Malipo' : 'Payment'} ${money(p.beneficiary_snapshot.payment_amount, p.beneficiary_snapshot.currency)}`}
                            {p.beneficiary_snapshot.amount_before_payment != null &&
                              ` · ${sw ? 'Yaliyorekodiwa awali' : 'Previously recorded'} ${money(p.beneficiary_snapshot.amount_before_payment, p.beneficiary_snapshot.currency)}`}
                            {p.beneficiary_snapshot.payment_reference ? ` · ${sw ? 'Kumb.' : 'Ref'} ${p.beneficiary_snapshot.payment_reference}` : ''}
                            {p.beneficiary_snapshot.payment_date ? ` · ${dateOnly(p.beneficiary_snapshot.payment_date)}` : ''}
                            {p.beneficiary_snapshot.beneficiaries_confirmed && (sw ? ' · Wanufaika wamethibitishwa kwa mkono' : ' · Beneficiaries manually confirmed')}
                          </span>
                        )}
                      </span>
                      <span className="row">
                        <button className="btn btn-secondary btn-sm" disabled={proofAction.busy} onClick={() => fetchProof(p, true)}>
                          {sw ? 'Fungua' : 'Open'}
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={proofAction.busy} onClick={() => fetchProof(p, false)}>
                          {sw ? 'Pakua' : 'Download'}
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">{sw ? 'Hakuna uthibitisho uliopakiwa.' : 'No proof uploaded.'}</p>
              )}
              <Alert>{proofAction.error}</Alert>
            </Section>
          )}

          {!!claim.review_feedback?.length && <Section title={sw ? 'Maoni ya sasa ya mapitio' : 'Current review feedback'}>
            {claim.review_feedback.map((feedback, index) => feedback.comment ? <p key={index}>{feedback.comment}</p> : null)}
          </Section>}
          <AdminAudit><Section title={sw ? 'Historia' : 'History'}>
            <AuditTimeline rows={auditRows(claim.audit)} actionLabels={sw ? { ...CLAIM_ACTION_LABELS, ...CLAIM_ACTION_LABELS_SW } : CLAIM_ACTION_LABELS} statusKind="claim" />
          </Section></AdminAudit>
            </>
          )}
        </div>
      )}

      {claim && dialog?.kind === 'action' && (
        <ReasonDialog
          title={actionLabel(dialog.action)}
          required={CLAIM_REASON_REQUIRED.has(dialog.action)}
          danger={DESTRUCTIVE_ACTIONS.has(dialog.action)}
          confirmLabel={actionLabel(dialog.action)}
          description={actionHelp(dialog.action, claim, sw)}
          onConfirm={(comment) => runAction(dialog.action, comment)}
          onClose={() => setDialog(null)}
        />
      )}
      {claim && dialog?.kind === 'record_payment' && (
        <RecordPaymentDialog claim={claim} onClose={() => setDialog(null)} onDone={(c) => updated(c, sw ? 'Malipo yamerekodiwa.' : 'Payment recorded.')} />
      )}
      {claim && dialog?.kind === 'upload_proof' && (
        <UploadProofDialog claim={claim} onClose={() => setDialog(null)} onDone={(c) => updated(c, sw ? 'Uthibitisho umepakiwa. Dai bado halijawekwa kuwa limelipwa.' : 'Proof uploaded. The claim is not marked paid yet.')} />
      )}
      {claim && dialog?.kind === 'services_proof_payment' && claim.payment_manifest && (
        <ServicesProofPaymentDialog
          manifests={[claim.payment_manifest]}
          onClose={() => setDialog(null)}
          onDone={(result) => {
            setDialog(null);
            setNotice(sw ? `Dai ${result.paid_count} la Huduma limehifadhiwa na uthibitisho.` : `${result.paid_count} Services claim saved with proof.`);
            reload();
            onChanged?.();
          }}
        />
      )}
    </Drawer>
  );
}

function actionHelp(action: string, claim: ClaimDetail, sw: boolean): string {
  switch (action) {
    case 'approve':
      if (noBudgetPolicyForClaim(claim)) {
        if (sw) {
          return claim.work_type === 'COMMUNITY'
            ? 'Idhinisha kwa kiasi cha viwango vilivyoidhinishwa; mgao wa bajeti ya mkoa hauhitajiki.'
            : 'Idhinisha kiasi cha Huduma kilichokaguliwa.';
        }
        return claim.work_type === 'COMMUNITY'
          ? 'Approve at the approved-rate amount. No regional budget allocation is required.'
          : 'Approve the reviewed Services amount.';
      }
      return sw
        ? `Inatenga ${money(claim.amount, claim.currency)} kutoka kifungu cha bajeti; kikipungukiwa, dai linazuiliwa.`
        : `Commits ${money(claim.amount, claim.currency)} to the budget line; held if the line is short.`;
    case 'send_back':
      return sw ? 'Dai linarudi kwenye “Inahitaji uhakiki” pamoja na sababu yako.' : 'The claim returns to “Validation needed” with your reason.';
    case 'cancel':
      if (noBudgetPolicyForClaim(claim)) return sw ? 'Ghairi dai hili ambalo halijalipwa. Makato ya bajeti ya mwezi yanarejeshwa.' : 'Cancel this unpaid claim. Any monthly budget deduction is restored.';
      return sw ? 'Kughairi kunaachilia bajeti yoyote iliyotengwa. Hatua hii haiwezi kutenduliwa.' : 'Cancelling releases any committed budget. This cannot be undone.';
    case 'confirm_paid':
      return sw ? 'Thibitisha kuwa malipo yaliyorekodiwa na uthibitisho uliopakiwa vinafikia kiasi chote.' : 'Confirm that the recorded payments and uploaded proof cover the full amount.';
    case 'reconcile':
      return sw ? 'Lazima ufanywe na mtu tofauti na aliyerekodi malipo.' : 'Must be done by someone other than the payment recorder.';
    case 'verify_community':
      return sw ? 'Thibitisha kuwa huduma ya jamii iliyoelezwa kwenye ushahidi ilifanyika.' : 'Confirm that the community service described in the evidence took place.';
    case 'mark_ready':
      return sw ? 'Dai litajumuishwa kwenye kundi la malipo linalofuata la njia yake.' : 'The claim will be included in the next payment batch for its route.';
    case 'revalidate':
      if (noBudgetPolicyForClaim(claim)) {
        if (sw) {
          return claim.work_type === 'COMMUNITY'
            ? 'Kokotoa upya kiasi cha jamii kutoka mipangilio ya sasa.'
            : 'Kokotoa upya kiasi cha kila siku cha Huduma kutoka viwango vilivyoidhinishwa.';
        }
        return claim.work_type === 'COMMUNITY'
          ? 'Recalculate the community amount from current settings.'
          : 'Recalculate the daily Services amount from approved rates.';
      }
      return sw ? 'Kokotoa upya njia, kifungu cha bajeti na kiasi kutoka mipangilio ya sasa.' : 'Recalculate the route, budget line and amount from the current configuration.';
    default:
      return '';
  }
}

function noBudgetPolicyForClaim(claim: ClaimDetail): boolean {
  return claim.payment_policy === 'FIXED_DAILY_MONTHLY_REGIONAL_BUDGET' || claim.payment_policy === 'FIXED_DAILY_NO_BUDGET'
    || claim.payment_policy === 'APPROVED_AMOUNTS_NO_BUDGET'
    || (claim.work_type === 'COMMUNITY' && claim.budget_line_id == null);
}
