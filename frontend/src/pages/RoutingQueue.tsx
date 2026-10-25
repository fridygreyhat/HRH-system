import React, { useState } from 'react';
import { qs } from '../api';
import { Alert, AsyncState, Field, StatusBadge } from '../components/ui';
import { WorkLogDrawer } from '../components/worklogs/WorkLogDrawer';
import { useApi } from '../hooks';
import { Named, RoutingQueueItem } from '../types';

export function RoutingQueue() {
  const [workType, setWorkType] = useState<'' | 'SERVICES' | 'PAYROLL'>('');
  const [regionId, setRegionId] = useState('');
  const [stage, setStage] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const regions = useApi<Named[]>('/finance/regions');
  const queue = useApi<RoutingQueueItem[]>(`/finance/pending-routing${qs({ work_type: workType, region_id: regionId, stage })}`);

  return (
    <div className="stack-lg">
      <header className="page-header">
        <div>
          <p className="routing-eyebrow">Finance · assignment verification</p>
          <h1>Routing queue</h1>
          <p className="muted small">Confirm who did the work and where they were assigned before choosing the paying organization.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => { queue.reload(); regions.reload(); }} disabled={queue.loading}>
          Refresh queue
        </button>
      </header>

      <section className="routing-principle" aria-label="Routing review principle">
        <span className="routing-principle-mark" aria-hidden="true">01</span>
        <div><strong>Assignment first. Payor second.</strong><p>Open each log to review every daily entry and the provider’s monthly totals. The correct channel is determined by verified assignment—not guesswork.</p></div>
      </section>

      <div className="filters routing-filters" role="search" aria-label="Filter routing queue">
        <Field label="Work type">
          <select value={workType} onChange={(event) => setWorkType(event.target.value as typeof workType)} aria-label="Filter by work type">
            <option value="">Services + payroll</option>
            <option value="SERVICES">Services</option>
            <option value="PAYROLL">Payroll</option>
          </select>
        </Field>
        <Field label="Region">
          <select value={regionId} onChange={(event) => setRegionId(event.target.value)} aria-label="Filter by region">
            <option value="">All regions in my scope</option>
            {(regions.data || []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </Field>
        <Field label="Queue stage">
          <select value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Filter by queue stage">
            <option value="">All stages</option>
            <option value="PENDING_FINANCE_REVIEW">Amount review</option>
            <option value="FINANCE_REVIEWED">Channel selection</option>
            <option value="BUDGET_HOLD">Budget hold</option>
          </select>
        </Field>
        {regions.error && <Alert kind="warn">Region options could not be loaded. You can still review the full queue. {regions.error}</Alert>}
      </div>

      {queue.error ? (
        <div className="stack">
          <Alert>{queue.error}</Alert>
          <div><button type="button" className="btn btn-secondary" onClick={queue.reload}>Try again</button></div>
        </div>
      ) : (
        <AsyncState
          data={queue.data}
          error={null}
          loading={queue.loading}
          empty={<div className="routing-empty"><span aria-hidden="true">✓</span><strong>No work items need finance action</strong><p>Every RPM-approved claim appears here for amount review, channel selection or budget-hold resolution. Older legacy records stay in their existing workflow.</p></div>}
        >
          {(items) => (
            <div className="table-wrap routing-table-wrap">
              <table className="routing-table">
                <thead><tr>
                  <th>Provider / cadre</th><th>Verified assignment</th><th>Period · type</th><th>Status</th><th className="num">Amount</th><th>Eligible payor</th><th><span className="sr-only">Review</span></th>
                </tr></thead>
                <tbody>{items.map((item) => {
                  const reviewAmount = item.finance_review_required || item.next_action === 'REVIEW_AMOUNT';
                  const resolveHold = item.next_action === 'RESOLVE_BUDGET_HOLD';
                  return (
                  <tr key={item.work_log_id}>
                    <td><strong>{item.provider_name}</strong><span className="routing-subline">{item.cadre_code} · {item.cadre_name}</span></td>
                    <td><strong>{item.facility_name || 'Facility not recorded'}</strong><span className="routing-subline">{item.region_name}</span></td>
                    <td>{item.period_label}<span className="routing-subline"><span className={`type-mark type-${item.work_type.toLowerCase()}`}>{item.work_type === 'SERVICES' ? 'Services' : 'Payroll'}</span></span></td>
                    <td><StatusBadge kind="log" status={item.status} bare /><span className="routing-subline">{reviewAmount ? 'Amount review required' : resolveHold ? 'Budget hold' : 'Channel selection'}</span></td>
                    <td className="num routing-amount">{item.amount === null || !item.currency ? <span className="muted">Not prepared</span> : `${item.currency} ${item.amount}`}</td>
                    <td>
                      {item.eligible_payors.length ? item.eligible_payors.map((payor) => <span className="routing-payor" key={payor.id}>{payor.name}</span>) : <span className="muted">Pending lookup</span>}
                      {item.routing_exception && <span className="routing-exception" title={item.routing_exception}>Exception to resolve</span>}
                    </td>
                    <td><button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenId(item.work_log_id)}>{reviewAmount ? 'Review amount' : resolveHold ? 'Resolve hold' : 'Choose channel'}</button></td>
                  </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </AsyncState>
      )}
      <p className="muted small routing-footnote">Every RPM-approved claim appears here—not only claims already reviewed by Finance. Review its amount first, then choose the payment channel; budget holds stay visible until resolved.</p>
      {openId !== null && <WorkLogDrawer logId={openId} onClose={() => setOpenId(null)} onChanged={queue.reload} />}
    </div>
  );
}
