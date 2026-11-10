import React, { useEffect, useState } from 'react';
import { api, qs, saveBlob } from '../api';
import { useAuth } from '../AuthContext';
import { PAYMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS_SW, ageSince, dateTime, label, money, num } from '../format';
import { useAction, useApi } from '../hooks';
import { Batch, CsoFinanceOrganization, ClaimSummary, PayPeriod } from '../types';
import { ClaimDrawer } from '../components/claims/ClaimDrawer';
import { BatchDrawer } from '../components/batches/BatchDrawer';
import { SalaryTimesheets } from '../components/cso/SalaryTimesheets';
import { Alert, AsyncState, Empty, Field, KpiStrip, PersonCell, RouteBadge, Section, StatTile, StatusBadge, WorkTypeChip } from '../components/ui';
import './polish-finance.css';

type SectionKey = 'all' | 'pending' | 'receipt' | 'routec' | 'recon' | 'export';

const PENDING_STATUSES = ['PENDING', 'PARTIALLY_RECORDED', 'PROOF_REQUIRED', 'FAILED'];
const NEXT_ACTION: Record<string, [string, string]> = {
  NOT_STARTED: ['Record payment', 'Rekodi malipo'],
  PENDING: ['Record payment', 'Rekodi malipo'],
  PARTIALLY_RECORDED: ['Record remaining payment', 'Rekodi malipo yaliyobaki'],
  PROOF_REQUIRED: ['Upload proof, then confirm paid', 'Pakia uthibitisho, kisha thibitisha malipo'],
  FAILED: ['Record a new payment attempt', 'Rekodi jaribio jipya la malipo'],
};
const RECON_GROUPS: { status: string; title: string; titleSw: string }[] = [
  { status: 'NOT_STARTED', title: 'Ready for payment', titleSw: 'Tayari kwa malipo' },
  { status: 'PENDING', title: 'Unpaid', titleSw: 'Hayajalipwa' },
  { status: 'PARTIALLY_RECORDED', title: 'Partially recorded', titleSw: 'Yamerekodiwa kwa sehemu' },
  { status: 'PROOF_REQUIRED', title: 'Proof missing', titleSw: 'Uthibitisho haupo' },
  { status: 'FAILED', title: 'Failed', titleSw: 'Yameshindikana' },
  { status: 'PAID', title: 'Paid', titleSw: 'Yamelipwa' },
  { status: 'RECONCILED', title: 'Reconciled', titleSw: 'Yamepatanishwa' },
];
const ROUTE_C_GROUPS: { status: string; title: string; titleSw: string; hint: string; hintSw: string }[] = [
  { status: 'VALIDATION_NEEDED', title: 'Returned for correction', titleSw: 'Yamerudishwa kwa marekebisho', hint: 'The provider can update and resubmit.', hintSw: 'Mtoa huduma anaweza kusahihisha na kutuma tena.' },
  { status: 'BUDGET_HOLD', title: 'Historical hold', titleSw: 'Zuio la kihistoria', hint: 'Kept for reference.', hintSw: 'Yamehifadhiwa kwa kumbukumbu.' },
  { status: 'DRAFT', title: 'Drafts', titleSw: 'Rasimu', hint: 'Not submitted yet.', hintSw: 'Bado hayajatumwa.' },
  { status: 'AWAITING_APPROVAL', title: 'Awaiting approval', titleSw: 'Yanasubiri idhini', hint: 'Approve after community verification.', hintSw: 'Idhinisha baada ya uhakiki wa jamii.' },
  {
    status: 'PENDING_COMMUNITY_VERIFICATION', title: 'Awaiting community verification', titleSw: 'Yanasubiri uhakiki wa jamii',
    hint: 'A community verifier must confirm first.', hintSw: 'Mhakiki wa jamii lazima athibitishe kwanza.',
  },
  {
    status: 'APPROVED', title: 'Approved · payment to record', titleSw: 'Yameidhinishwa · malipo ya kurekodi',
    hint: 'Pay externally, then record payment and attach proof.', hintSw: 'Lipa nje ya mfumo, kisha rekodi malipo na ambatisha uthibitisho.',
  },
];

const outstanding = (c: ClaimSummary) => Math.max(0, Number(c.amount) - Number(c.amount_paid || 0));
const hoursSince = (iso: string) => (Date.now() - new Date(iso).getTime()) / 3_600_000;
const sum = (rows: ClaimSummary[], f: (c: ClaimSummary) => number) => rows.reduce((s, c) => s + f(c), 0);

/** "3 h" / "saa 3": how long something has waited, in the reader's language. */
function ageText(iso: string, sw: boolean): string {
  if (!sw) return ageSince(iso);
  const hours = hoursSince(iso);
  if (hours < 1) return 'chini ya saa 1';
  if (hours < 48) return `saa ${Math.round(hours)}`;
  return `siku ${Math.floor(hours / 24)} saa ${Math.round(hours % 24)}`;
}

function TypeChip({ type, sw }: { type: ClaimSummary['work_type']; sw: boolean }) {
  if (!type || type === 'LEGACY') return null;
  if (type === 'COMMUNITY') return <span className="chip chip-legacy">{sw ? 'Jamii' : 'Community'}</span>;
  return <WorkTypeChip type={type} />;
}

function openOnKey(e: React.KeyboardEvent, open: () => void) {
  if (e.key === 'Enter') open();
}

function CategoryCell({ c, sw }: { c: ClaimSummary; sw: boolean }) {
  return (
    <td className="fin-wrap">
      <span className="cell-main">{c.category_name || '—'}</span>
      {c.workflow_version === 2 && c.work_type && <span className="cell-sub"><TypeChip type={c.work_type} sw={sw} /></span>}
    </td>
  );
}

function PendingTable({ rows, onOpen, sw }: { rows: ClaimSummary[]; onOpen: (id: number) => void; sw: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table clickable">
        <thead>
          <tr>
            <th scope="col">{sw ? 'Dai' : 'Claim'}</th>
            <th scope="col">{sw ? 'Mtumishi' : 'Staff'}</th>
            <th scope="col">{sw ? 'Kategoria' : 'Category'}</th>
            <th scope="col">{sw ? 'Hali' : 'Status'}</th>
            <th scope="col" className="num">{sw ? 'Kiasi' : 'Amount'}</th>
            <th scope="col" className="num">{sw ? 'Kilichobaki' : 'Outstanding'}</th>
            <th scope="col">{sw ? 'Hatua inayofuata' : 'Next action'}</th>
            <th scope="col">{sw ? 'Muda wa kusubiri' : 'Waiting'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const late = hoursSince(c.updated_at) > 48;
            const next = NEXT_ACTION[c.payment_status];
            return (
              <tr
                key={c.id}
                className={late ? 'row-over-48' : undefined}
                tabIndex={0}
                onClick={() => onOpen(c.id)}
                onKeyDown={(e) => openOnKey(e, () => onOpen(c.id))}
                aria-label={sw ? `Fungua dai ${c.id}` : `Open claim ${c.id}`}
              >
                <td><span className="fin-stack"><span className="cell-main">#{c.id}</span><RouteBadge route={c.route_code} /></span></td>
                <td><PersonCell name={c.staff_name} sub={c.period_label} /></td>
                <CategoryCell c={c} sw={sw} />
                <td>
                  <div className="badges">
                    <StatusBadge status={c.status} kind="claim" />
                    <StatusBadge status={c.payment_status} kind="payment" />
                  </div>
                  {c.exception_reason && <div className="small over-48">{c.exception_reason}</div>}
                </td>
                <td className="num">
                  <span className="cell-main">{money(c.amount, c.currency)}</span>
                  <span className="cell-sub">{sw ? 'Kilicholipwa' : 'Paid'} {money(c.amount_paid, c.currency)}</span>
                </td>
                <td className="num nowrap"><strong>{money(outstanding(c), c.currency)}</strong></td>
                <td><strong>{next ? next[sw ? 1 : 0] : '—'}</strong></td>
                <td className={`nowrap${late ? ' over-48' : ''}`} title={`${sw ? 'Imesasishwa' : 'Last updated'} ${dateTime(c.updated_at)}`}>
                  {ageText(c.updated_at, sw)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClaimList({ rows, onOpen, meId, sw }: { rows: ClaimSummary[]; onOpen: (id: number) => void; meId?: number; sw: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table clickable">
        <thead>
          <tr>
            <th scope="col">{sw ? 'Dai' : 'Claim'}</th>
            <th scope="col">{sw ? 'Mtumishi' : 'Staff'}</th>
            <th scope="col">{sw ? 'Kategoria' : 'Category'}</th>
            <th scope="col">{sw ? 'Hali' : 'Status'}</th>
            <th scope="col" className="num">{sw ? 'Kiasi' : 'Amount'}</th>
            <th scope="col">{sw ? 'Imesasishwa' : 'Updated'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr
              key={c.id}
              tabIndex={0}
              onClick={() => onOpen(c.id)}
              onKeyDown={(e) => openOnKey(e, () => onOpen(c.id))}
              aria-label={sw ? `Fungua dai ${c.id}` : `Open claim ${c.id}`}
            >
              <td><span className="fin-stack"><span className="cell-main">#{c.id}</span><RouteBadge route={c.route_code} /></span></td>
              <td><PersonCell name={c.staff_name} sub={c.period_label} /></td>
              <CategoryCell c={c} sw={sw} />
              <td>
                <div className="badges">
                  <StatusBadge status={c.status} kind="claim" />
                  <StatusBadge status={c.payment_status} kind="payment" />
                </div>
                {c.exception_reason && (
                  <div className="small">
                    <strong className="over-48">{sw ? 'Dosari' : 'Exception'}:</strong> {c.exception_reason}
                  </div>
                )}
                {meId !== undefined && c.status === 'AWAITING_APPROVAL' && c.created_by === meId && (
                  <div className="small muted">{sw ? 'Uliandaa dai hili, kwa hiyo mwenzako lazima aliidhinishe.' : 'You prepared this claim, so a colleague must approve it.'}</div>
                )}
              </td>
              <td className="num">
                <span className="cell-main">{money(c.amount, c.currency)}</span>
                <span className="cell-sub">{sw ? 'Kilicholipwa' : 'Paid'} {money(c.amount_paid, c.currency)}</span>
              </td>
              <td className="nowrap small">{dateTime(c.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CsoPortal({ initialSection }: { initialSection?: 'export' } = {}) {
  const { me, lang } = useAuth();
  const sw = lang === 'sw';
  const claims = useApi<ClaimSummary[]>('/claims');
  const batches = useApi<Batch[]>('/batches');
  const payPeriods = useApi<PayPeriod[]>('/cso-finance/pay-periods');
  const organizations = useApi<CsoFinanceOrganization[]>('/cso-finance/organizations');
  const receive = useAction();
  const payrollExport = useAction();
  const [section, setSection] = useState<SectionKey>(initialSection || 'all');
  const [claimId, setClaimId] = useState<number | null>(null);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [selectedCsoId, setSelectedCsoId] = useState('');

  useEffect(() => {
    if (payPeriods.data?.length && !payPeriods.data.some((period) => String(period.id) === selectedPeriodId)) {
      setSelectedPeriodId(String(payPeriods.data[0].id));
    }
  }, [payPeriods.data, selectedPeriodId]);
  useEffect(() => {
    if (organizations.data?.length && !organizations.data.some((organization) => String(organization.id) === selectedCsoId)) {
      setSelectedCsoId(String(organizations.data[0].id));
    }
  }, [organizations.data, selectedCsoId]);

  const csoNames = (me?.organizations || []).filter((o) => o.type === 'CSO').map((o) => o.name);
  const names = csoNames.length ? csoNames : (me?.organizations || []).map((o) => o.name);

  const refreshAll = () => {
    claims.reload();
    batches.reload();
    payPeriods.reload();
    organizations.reload();
  };
  const refreshing = claims.loading || batches.loading || payPeriods.loading || organizations.loading;

  const all = claims.data || [];
  const isDirectV2Ready = (claim: ClaimSummary) => claim.workflow_version === 2 && claim.status === 'READY';
  const pending = all
    .filter((c) => PENDING_STATUSES.includes(c.payment_status) || (isDirectV2Ready(c) && c.payment_status !== 'PAID' && c.payment_status !== 'RECONCILED'))
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
  const awaitingReceipt = (batches.data || []).filter((b) => b.route_code === 'B' && b.status === 'HANDED_OFF');
  const routeC = all.filter((c) => c.work_type === 'COMMUNITY' || c.route_code === 'C' || c.route_code === null);
  const inPayment = all.filter((c) => c.payment_status !== 'NOT_STARTED' || isDirectV2Ready(c));
  const directReady = pending.filter((c) => isDirectV2Ready(c) && c.payment_status === 'NOT_STARTED');
  const routeCCount = ROUTE_C_GROUPS.reduce((s, g) => s + routeC.filter((c) => c.status === g.status).length, 0);
  const paid = all.filter((c) => c.payment_status === 'PAID' || c.payment_status === 'RECONCILED');
  const latePending = pending.filter((c) => hoursSince(c.updated_at) > 48).length;

  const acknowledge = async (b: Batch) => {
    if (!window.confirm(sw
      ? `Thibitisha kwamba CSO yako imepokea kundi ${b.reference}? Malipo yanaweza kurekodiwa baada ya kupokelewa tu. Hatua hii haiwezi kurudishwa.`
      : `Acknowledge that your CSO has received batch ${b.reference}? Payments can be recorded only after receipt. This cannot be undone.`)) {
      return;
    }
    setNotice(null);
    const ok = await receive.run(() => api.post(`/batches/${b.id}/receive`));
    if (ok !== undefined) {
      setNotice(sw ? `Kupokelewa kwa ${b.reference} kumethibitishwa. Madai yake sasa yanasubiri malipo.` : `Receipt of ${b.reference} acknowledged. Its claims are now pending payment.`);
      refreshAll();
    }
  };

  const tabs: { key: SectionKey; label: string }[] = [
    { key: 'all', label: sw ? 'Muhtasari' : 'Overview' },
    { key: 'pending', label: `${sw ? 'Malipo yanayosubiri' : 'Pending payments'}${claims.data ? ` (${pending.length})` : ''}` },
    { key: 'receipt', label: `${sw ? 'Yanasubiri kupokelewa' : 'Awaiting receipt'}${batches.data ? ` (${awaitingReceipt.length})` : ''}` },
    { key: 'routec', label: `${sw ? 'Madai ya jamii' : 'Community claims'}${claims.data ? ` (${routeCCount})` : ''}` },
    { key: 'recon', label: sw ? 'Upatanisho' : 'Reconciliation' },
    { key: 'export', label: sw ? 'Majedwali ya mshahara' : 'Salary timesheets' },
  ];
  const show = (k: SectionKey) => section === 'all' || section === k;
  const jump = (k: SectionKey) => setSection(section === k ? 'all' : k);

  return (
    <div className="stack-lg">
      <header className="page-header fin-title-only">
        <h1>{sw ? 'Malipo ya CSO' : 'CSO payments'}{names.length ? ` — ${names.join(', ')}` : ''}</h1>
      </header>

      {claims.data && batches.data && (
        <KpiStrip
          label={sw ? 'Muhtasari wa malipo ya CSO' : 'CSO payments at a glance'}
          items={[
            {
              label: sw ? 'Malipo yanayosubiri' : 'Pending payments', value: num(pending.length), icon: 'wallet', tone: pending.length ? 'warn' : 'neutral',
              note: latePending ? (sw ? `${num(latePending)} zaidi ya saa 48` : `${num(latePending)} over 48 h`) : `${money(sum(pending, outstanding))} ${sw ? 'bado' : 'outstanding'}`,
              onClick: () => jump('pending'), active: section === 'pending',
            },
            {
              label: sw ? 'Makundi ya kupokea' : 'Batches to receive', value: num(awaitingReceipt.length), icon: 'layers', tone: awaitingReceipt.length ? 'info' : 'neutral',
              onClick: () => jump('receipt'), active: section === 'receipt',
            },
            {
              label: sw ? 'Madai ya jamii' : 'Community claims', value: num(routeCCount), icon: 'users', tone: routeCCount ? 'info' : 'neutral',
              onClick: () => jump('routec'), active: section === 'routec',
            },
            {
              label: sw ? 'Yamelipwa' : 'Paid', value: num(paid.length), icon: 'check', tone: 'success',
              note: money(sum(paid, (c) => Number(c.amount_paid || 0))), onClick: () => jump('recon'), active: section === 'recon',
            },
          ]}
        />
      )}

      <div className="fin-toolbar">
        <nav className="subnav" aria-label="CSO portal sections">
          {tabs.map((t) => (
            <button key={t.key} type="button" aria-current={section === t.key ? 'page' : undefined} onClick={() => setSection(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
        <div className="fin-actions">
          {names.length > 0 && <span className="muted small">{names.join(', ')}</span>}
          <button type="button" className="btn btn-secondary" onClick={refreshAll} disabled={refreshing}>
            {refreshing ? (sw ? 'Inapakia upya…' : 'Refreshing…') : (sw ? 'Pakia upya' : 'Refresh')}
          </button>
        </div>
      </div>

      <Alert kind="success">{notice}</Alert>

      {show('pending') && (
        <Section title={sw ? 'Malipo yanayosubiri' : 'Pending payments'} actions={<span className="muted small">{sw ? 'Ya zamani kwanza' : 'Oldest first'}</span>}>
          <AsyncState data={claims.data} error={claims.error} loading={claims.loading}>
            {() => (
              <>
                <div className="stats">
                  {PENDING_STATUSES.map((s) => {
                    const rows = pending.filter((c) => c.payment_status === s);
                    return (
                      <StatTile
                        key={s}
                        label={(sw && PAYMENT_STATUS_LABELS_SW[s]) || label(PAYMENT_STATUS_LABELS, s)}
                        value={num(rows.length)}
                        hint={`${sw ? 'Kilichobaki' : 'Outstanding'} ${money(sum(rows, outstanding))}`}
                        tone={s === 'FAILED' && rows.length ? 'danger' : rows.length ? 'warn' : undefined}
                      />
                    );
                  })}
                  {directReady.length > 0 && <StatTile label={sw ? 'Tayari · moja kwa moja' : 'Ready · v2 direct'} value={num(directReady.length)} hint={`${sw ? 'Kilichobaki' : 'Outstanding'} ${money(sum(directReady, outstanding))}`} tone="warn" />}
                </div>
                {pending.length ? <PendingTable rows={pending} onOpen={setClaimId} sw={sw} /> : <Empty>{sw ? 'Hakuna malipo yanayosubiri CSO yako.' : 'No payments are waiting on your CSO.'}</Empty>}
              </>
            )}
          </AsyncState>
        </Section>
      )}

      {show('receipt') && (
        <Section title={sw ? 'Makundi ya mishahara ya vituo yanayosubiri kupokelewa' : 'Facility payroll batches awaiting receipt'}>
          <p className="muted small">
            {sw ? 'Thibitisha kupokea kabla ya kurekodi malipo ya madai haya.' : 'Acknowledge receipt before recording payments for these claims.'}
          </p>
          <Alert>{receive.error}</Alert>
          <AsyncState data={batches.data} error={batches.error} loading={batches.loading}>
            {() =>
              awaitingReceipt.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th scope="col">{sw ? 'Kundi' : 'Batch'}</th>
                        <th scope="col">{sw ? 'Mlipaji' : 'Payor'}</th>
                        <th scope="col" className="num">{sw ? 'Mistari' : 'Lines'}</th>
                        <th scope="col" className="num">{sw ? 'Jumla' : 'Total'}</th>
                        <th scope="col">{sw ? 'Lilikabidhiwa' : 'Handed off'}</th>
                        <th scope="col">{sw ? 'Hatua' : 'Action'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {awaitingReceipt.map((b) => (
                        <tr key={b.id}>
                          <td>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBatchId(b.id)}>
                              {b.reference}
                            </button>
                          </td>
                          <td>{b.payor_name || '—'}</td>
                          <td className="num">{num(b.line_count)}</td>
                          <td className="num nowrap">{money(b.total_amount, b.currency)}</td>
                          <td>
                            <span className="cell-main">{dateTime(b.handed_off_at)}</span>
                            {b.handed_off_at && <span className="cell-sub">{sw ? `${ageText(b.handed_off_at, sw)} zilizopita` : `${ageSince(b.handed_off_at)} ago`}</span>}
                          </td>
                          <td>
                            {b.can_receive ? (
                              <button type="button" className="btn btn-primary btn-sm" onClick={() => acknowledge(b)} disabled={receive.busy}>
                                {receive.busy ? (sw ? 'Inafanya kazi…' : 'Working…') : (sw ? 'Thibitisha kupokea' : 'Acknowledge receipt')}
                              </button>
                            ) : (
                              <span className="muted small">{sw ? 'Hujapangiwa' : 'Not assigned to you'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>{sw ? 'Hakuna makundi yanayosubiri upokee.' : 'No batches are waiting for your receipt.'}</Empty>
              )
            }
          </AsyncState>
        </Section>
      )}

      {show('routec') && (
        <Section title={sw ? 'Madai ya jamii yanayohitaji hatua' : 'Community claims needing attention'}>
          <AsyncState data={claims.data} error={claims.error} loading={claims.loading}>
            {() =>
              routeCCount ? (
                <div className="stack">
                  {ROUTE_C_GROUPS.map((g) => {
                    const rows = routeC.filter((c) => c.status === g.status);
                    if (!rows.length) return null;
                    return (
                      <div key={g.status} className="stack">
                        <div className="fin-section-head">
                          <h4>{sw ? g.titleSw : g.title} ({rows.length})</h4>
                          <span className="muted">{sw ? g.hintSw : g.hint}</span>
                        </div>
                        <ClaimList rows={rows} onOpen={setClaimId} meId={me?.id} sw={sw} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <Empty>{sw ? 'Hakuna madai ya jamii yanayohitaji hatua.' : 'No community claims need attention.'}</Empty>
              )
            }
          </AsyncState>
        </Section>
      )}

      {show('recon') && (
        <Section title={sw ? 'Upatanisho' : 'Reconciliation'} actions={<span className="muted small">{sw ? 'Yaliyolipwa na kupatanishwa tu ndiyo yamelipwa.' : 'Only Paid and Reconciled claims have been paid.'}</span>}>
          <AsyncState data={claims.data} error={claims.error} loading={claims.loading}>
            {() =>
              inPayment.length ? (
                <div className="stack">
                  {RECON_GROUPS.map((g) => {
                    const rows = inPayment.filter((c) => c.payment_status === g.status);
                    return (
                      <details key={g.status} className="card">
                        <summary>
                          <strong>{sw ? g.titleSw : g.title}</strong>
                          <span className="muted small">
                            {sw
                              ? `madai ${num(rows.length)} · kiasi ${money(sum(rows, (c) => Number(c.amount)))} · kilichorekodiwa ${money(sum(rows, (c) => Number(c.amount_paid || 0)))}`
                              : `${num(rows.length)} claims · amount ${money(sum(rows, (c) => Number(c.amount)))} · recorded ${money(sum(rows, (c) => Number(c.amount_paid || 0)))}`}
                          </span>
                        </summary>
                        {rows.length ? <ClaimList rows={rows} onOpen={setClaimId} sw={sw} /> : <Empty>{sw ? 'Hakuna.' : 'None.'}</Empty>}
                      </details>
                    );
                  })}
                </div>
              ) : (
                <Empty>{sw ? 'Hakuna dai la CSO yako lililoingia kwenye malipo bado.' : "None of your CSO's claims have entered payment yet."}</Empty>
              )
            }
          </AsyncState>
        </Section>
      )}

      {show('export') && <SalaryTimesheets csoId={selectedCsoId} noCso={organizations.data?.length === 0} />}

      {show('export') && (
        <Section title={sw ? 'Madai ya zamani ya mshahara · CSV ya benki' : 'Older payroll claims · bank CSV'}>
          <p className="muted small">
            {sw
              ? 'Madai ya mshahara yaliyopangiwa na bado hayajalipwa, kama CSV. Haihamishi pesa wala haibadilishi hali ya dai. Ina taarifa za malipo ya benki tu; taarifa za benki zikikosekana, upakuaji unazuiwa.'
              : 'Unpaid routed payroll claims as CSV. This does not transfer money or change claim status. Includes bank payment details only; missing bank details block the export.'}
          </p>
          {(organizations.error || payPeriods.error) && (
            <div className="stack">
              <Alert>{organizations.error || payPeriods.error}</Alert>
              <div className="row">
                {organizations.error && <button type="button" className="btn btn-secondary btn-sm" onClick={organizations.reload} disabled={organizations.loading}>{sw ? 'Jaribu tena orodha ya CSO' : 'Retry CSO list'}</button>}
                {payPeriods.error && <button type="button" className="btn btn-secondary btn-sm" onClick={payPeriods.reload} disabled={payPeriods.loading}>{sw ? 'Jaribu tena vipindi vya malipo' : 'Retry pay periods'}</button>}
              </div>
            </div>
          )}
          {!organizations.error && !payPeriods.error && (
            <form
              className="stack"
              onSubmit={async (event) => {
                event.preventDefault();
                if (!selectedCsoId || !selectedPeriodId) return;
                const file = await payrollExport.run(() =>
                  api.blob(`/cso-finance/export-payroll${qs({ cso_id: Number(selectedCsoId), period_id: Number(selectedPeriodId) })}`, 'GET', 'payroll-export.csv'),
                );
                if (file) saveBlob(file);
              }}
            >
              <div className="fin-toolbar">
                <div className="filters">
                  {organizations.data && organizations.data.length > 1 && (
                    <Field label={sw ? 'CSO uliyopangiwa' : 'Assigned CSO'}>
                      <select value={selectedCsoId} onChange={(event) => setSelectedCsoId(event.target.value)} required>
                        {organizations.data.map((organization) => <option key={organization.id} value={organization.id}>{organization.name}</option>)}
                      </select>
                    </Field>
                  )}
                  <Field label={sw ? 'Kipindi cha malipo' : 'Pay period'}>
                    <select value={selectedPeriodId} onChange={(event) => setSelectedPeriodId(event.target.value)} required disabled={payPeriods.loading || !payPeriods.data?.length}>
                      {(payPeriods.data || []).map((period) => (
                        <option key={period.id} value={period.id}>
                          {period.period_label || `${period.start_date} – ${period.end_date}`}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <div className="fin-actions">
                  <button type="submit" className="btn btn-primary" disabled={payrollExport.busy || !selectedCsoId || !selectedPeriodId || !payPeriods.data?.length || !organizations.data?.length}>
                    {payrollExport.busy ? (sw ? 'Inaandaa CSV…' : 'Preparing CSV…') : (sw ? 'Pakua CSV ya mshahara' : 'Download payroll CSV')}
                  </button>
                </div>
              </div>
              {payPeriods.data?.length === 0 && <Empty>{sw ? 'Hakuna vipindi vya malipo kwa upakuaji wa mshahara. Msimamizi lazima aunde kimoja kwenye Vipindi vya malipo.' : 'No pay periods for payroll export. An administrator must create one under Pay periods.'}</Empty>}
              {organizations.data?.length === 0 && <Empty>{sw ? 'Hakuna CSO uliyopangiwa kwa upakuaji wa mshahara.' : 'No assigned CSOs are available for payroll export.'}</Empty>}
              <Alert>{payrollExport.error}</Alert>
            </form>
          )}
        </Section>
      )}

      {claimId !== null && <ClaimDrawer claimId={claimId} onClose={() => setClaimId(null)} onChanged={refreshAll} />}
      {batchId !== null && <BatchDrawer batchId={batchId} onClose={() => setBatchId(null)} onChanged={refreshAll} />}
    </div>
  );
}
