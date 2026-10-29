import React, { useState } from 'react';
import { qs } from '../api';
import { Alert, AsyncState, Field, StatusBadge } from '../components/ui';
import { WorkLogDrawer } from '../components/worklogs/WorkLogDrawer';
import { useApi } from '../hooks';
import { Named, RoutingQueueItem } from '../types';

export function RoutingQueue() {
  const [regionId, setRegionId] = useState('');
  const [stage, setStage] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const regions = useApi<Named[]>('/finance/regions');
  const queue = useApi<RoutingQueueItem[]>(`/finance/pending-routing${qs({ work_type: 'SERVICES', region_id: regionId, stage })}`);

  return (
    <div className="stack-lg">
      <header className="page-header">
        <div>
          <p className="routing-eyebrow">Finance · services payment</p>
          <h1>Services routing queue</h1>
          <p className="muted small">Review approved service claims and select the eligible paying organization.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => { queue.reload(); regions.reload(); }} disabled={queue.loading}>
          Refresh queue
        </button>
      </header>

      <section className="routing-principle" aria-label="Routing review principle">
        <span className="routing-principle-mark" aria-hidden="true">01</span>
        <div><strong>Services only. Assignment first.</strong><p>Payroll is not routed or financially approved here. Payroll work appears in the monthly report after CTC, Technical and RM authorization.</p></div>
      </section>

      <div className="filters routing-filters" role="search" aria-label="Filter routing queue">
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
            <option value="BUDGET_HOLD">Historical hold</option>
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
          isEmpty={(items) => items.every((item) => item.work_type !== 'SERVICES')}
          empty={<div className="routing-empty"><span aria-hidden="true">✓</span><strong>No service claims need finance action</strong><p>RM-approved service claims appear here for fixed daily amount review, channel selection or historical hold review. Payroll is reported separately by calendar month.</p></div>}
        >
          {(items) => (
            <div className="table-wrap routing-table-wrap">
              <table className="routing-table">
                <thead><tr>
                  <th>Provider / cadre</th><th>Verified assignment</th><th>Period</th><th>Status</th><th className="num">Amount</th><th>Eligible payor</th><th><span className="sr-only">Review</span></th>
                </tr></thead>
                <tbody>{items.filter((item) => item.work_type === 'SERVICES').map((item) => {
                  const reviewAmount = item.finance_review_required || item.next_action === 'REVIEW_AMOUNT';
                  const resolveHold = item.next_action === 'RESOLVE_BUDGET_HOLD';
                  return (
                  <tr key={item.work_log_id}>
                    <td><strong>{item.provider_name}</strong><span className="routing-subline">{item.cadre_code} · {item.cadre_name}</span></td>
                    <td><strong>{item.facility_name || 'Facility not recorded'}</strong><span className="routing-subline">{item.region_name}</span></td>
                    <td>{item.period_label}<span className="routing-subline"><span className="type-mark type-services">Services</span></span></td>
                    <td><StatusBadge kind="log" status={item.status} bare /><span className="routing-subline">{reviewAmount ? 'Amount review required' : resolveHold ? 'Historical hold' : 'Channel selection'}</span></td>
                    <td className="num routing-amount">{item.amount === null || !item.currency ? <span className="muted">Not prepared</span> : `${item.currency} ${item.amount}`}</td>
                    <td>
                      {item.eligible_payors.length ? item.eligible_payors.map((payor) => <span className="routing-payor" key={payor.id}>{payor.name}</span>) : <span className="muted">Pending lookup</span>}
                      {item.routing_exception && <span className="routing-exception" title={item.routing_exception}>Exception to resolve</span>}
                    </td>
                    <td><button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenId(item.work_log_id)}>{reviewAmount ? 'Review amount' : resolveHold ? 'Review historical hold' : 'Choose channel'}</button></td>
                  </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </AsyncState>
      )}
      <p className="muted small routing-footnote">Services use approved fixed daily rates; only the highest eligible amount per day is payable. Historical held records remain available for finance review. Payroll has no pricing, finance approval or routing step; view RM-authorized work in the monthly report.</p>
      {openId !== null && <WorkLogDrawer logId={openId} onClose={() => setOpenId(null)} onChanged={queue.reload} />}
    </div>
  );
}
