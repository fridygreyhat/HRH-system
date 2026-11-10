import React, { useState } from 'react';
import { qs } from '../api';
import { Alert, AsyncState, Field, KpiStrip, pageLang, PersonCell, StatusBadge, WorkTypeChip } from '../components/ui';
import { WorkLogDrawer } from '../components/worklogs/WorkLogDrawer';
import { CADRE_NAMES, cadreName, money, num } from '../format';
import { useApi } from '../hooks';
import { Named, RoutingQueueItem } from '../types';
import './polish-finance.css';

type Step = 'timesheet' | 'amount' | 'hold' | 'channel';

const stepOf = (item: RoutingQueueItem): Step => {
  if (item.next_action === 'REVIEW_TIMESHEET') return 'timesheet';
  if (item.finance_review_required || item.next_action === 'REVIEW_AMOUNT') return 'amount';
  if (item.next_action === 'RESOLVE_BUDGET_HOLD') return 'hold';
  return 'channel';
};

/** Amounts per currency, e.g. "TZS 173,450". */
const totalText = (items: RoutingQueueItem[]) => {
  const totals = new Map<string, number>();
  items.forEach((item) => {
    if (item.amount !== null && item.currency) totals.set(item.currency, (totals.get(item.currency) || 0) + Number(item.amount));
  });
  return Array.from(totals, ([currency, total]) => money(total, currency)).join(' + ') || '—';
};

export function RoutingQueue() {
  const sw = pageLang() === 'sw';
  const [regionId, setRegionId] = useState('');
  const [stage, setStage] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const regions = useApi<Named[]>('/finance/regions');
  const queue = useApi<RoutingQueueItem[]>(`/finance/pending-routing${qs({ work_type: 'SERVICES', region_id: regionId, stage })}`);
  const services = (queue.data || []).filter((item) => item.work_type === 'SERVICES');
  const count = (step: Step) => services.filter((item) => stepOf(item) === step).length;

  const stepText: Record<Step, string> = {
    timesheet: sw ? 'Mapitio 1 kati ya 2: jedwali la kazi' : 'Review 1 of 2: timesheet',
    amount: sw ? 'Mapitio 2 kati ya 2: malipo ya Huduma' : 'Review 2 of 2: Services payment',
    hold: sw ? 'Zuio la kihistoria' : 'Historical hold',
    channel: sw ? 'Kuchagua mlipaji' : 'Channel selection',
  };
  const actionText: Record<Step, string> = {
    timesheet: sw ? 'Pitia jedwali' : 'Review timesheet',
    amount: sw ? 'Pitia kiasi' : 'Review amount',
    hold: sw ? 'Pitia zuio la kihistoria' : 'Review historical hold',
    channel: sw ? 'Chagua mlipaji' : 'Choose channel',
  };

  return (
    <div className="stack-lg">
      <header className="page-header fin-title-only">
        <h1>{sw ? 'Huduma za kukagua na kupangia mlipaji' : 'Services routing queue'}</h1>
      </header>

      {services.length > 0 && (
        <KpiStrip
          label={sw ? 'Muhtasari wa foleni' : 'Queue at a glance'}
          items={[
            { label: sw ? 'Zinasubiri hatua yangu' : 'Waiting on me', value: num(services.length), icon: 'clock', tone: 'warn', note: totalText(services) },
            { label: sw ? 'Jedwali la kupitia' : 'Timesheets to review', value: num(count('timesheet')), icon: 'clipboard', tone: count('timesheet') ? 'info' : 'neutral', note: sw ? 'Hatua 1 kati ya 2' : 'Step 1 of 2' },
            { label: sw ? 'Kiasi cha kupitia' : 'Amounts to review', value: num(count('amount')), icon: 'receipt', tone: count('amount') ? 'info' : 'neutral', note: sw ? 'Hatua 2 kati ya 2' : 'Step 2 of 2' },
            {
              label: sw ? 'Mlipaji wa kuchagua' : 'Channel to choose', value: num(count('channel')), icon: 'route', tone: count('channel') ? 'success' : 'neutral',
              note: count('hold') ? (sw ? `Zuio la kihistoria ${num(count('hold'))}` : `${num(count('hold'))} historical hold`) : undefined,
            },
          ]}
        />
      )}

      <div className="fin-toolbar">
        <div className="filters" role="search" aria-label="Filter routing queue">
          <Field label={sw ? 'Mkoa' : 'Region'}>
            <select value={regionId} onChange={(event) => setRegionId(event.target.value)} aria-label="Filter by region">
              <option value="">{sw ? 'Mikoa yote niliyopangiwa' : 'All regions in my scope'}</option>
              {(regions.data || []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </Field>
          <Field label={sw ? 'Hatua ya foleni' : 'Queue stage'}>
            <select value={stage} onChange={(event) => setStage(event.target.value)} aria-label="Filter by queue stage">
              <option value="">{sw ? 'Hatua zote' : 'All stages'}</option>
              <option value="PENDING_FINANCE_REVIEW">{sw ? 'Mapitio ya kiasi' : 'Amount review'}</option>
              <option value="FINANCE_REVIEWED">{sw ? 'Kuchagua mlipaji' : 'Channel selection'}</option>
              <option value="BUDGET_HOLD">{sw ? 'Zuio la kihistoria' : 'Historical hold'}</option>
            </select>
          </Field>
        </div>
        <div className="fin-actions">
          <button type="button" className="btn btn-secondary" onClick={() => { queue.reload(); regions.reload(); }} disabled={queue.loading}>
            {sw ? 'Pakia foleni upya' : 'Refresh queue'}
          </button>
        </div>
      </div>
      {regions.error && <Alert kind="warn">{sw ? 'Orodha ya mikoa haikupakia.' : 'Region options could not be loaded.'} {regions.error}</Alert>}

      {queue.error ? (
        <div className="stack">
          <Alert>{queue.error}</Alert>
          <div><button type="button" className="btn btn-secondary" onClick={queue.reload}>{sw ? 'Jaribu tena' : 'Try again'}</button></div>
        </div>
      ) : (
        <AsyncState
          data={queue.data}
          error={null}
          loading={queue.loading}
          isEmpty={(items) => items.every((item) => item.work_type !== 'SERVICES')}
          empty={<div className="routing-empty"><span aria-hidden="true">✓</span><strong>{sw ? 'Hakuna madai ya Huduma yanayohitaji hatua ya Fedha' : 'No service claims need finance action'}</strong></div>}
        >
          {(items) => (
            <div className="table-wrap routing-table-wrap">
              <table className="routing-table">
                <thead><tr>
                  <th>{sw ? 'Mtoa huduma / kada' : 'Provider / cadre'}</th>
                  <th>{sw ? 'Kituo kilichothibitishwa' : 'Verified assignment'}</th>
                  <th>{sw ? 'Kipindi' : 'Period'}</th>
                  <th>{sw ? 'Hali' : 'Status'}</th>
                  <th className="num">{sw ? 'Kiasi' : 'Amount'}</th>
                  <th>{sw ? 'Mlipaji anayestahili' : 'Eligible payor'}</th>
                  <th><span className="sr-only">{sw ? 'Pitia' : 'Review'}</span></th>
                </tr></thead>
                <tbody>{items.filter((item) => item.work_type === 'SERVICES').map((item) => {
                  const step = stepOf(item);
                  return (
                    <tr key={item.work_log_id}>
                      <td><PersonCell name={item.provider_name} sub={CADRE_NAMES[item.cadre_code] ? cadreName(item.cadre_code, sw ? 'sw' : 'en') : item.cadre_name} /></td>
                      <td>
                        <span className="cell-main">{item.facility_name || (sw ? 'Kituo hakijarekodiwa' : 'Facility not recorded')}</span>
                        <span className="cell-sub">{item.region_name}</span>
                      </td>
                      <td>
                        <span className="cell-main">{item.period_label}</span>
                        <span className="routing-subline"><WorkTypeChip type="SERVICES" /></span>
                      </td>
                      <td><StatusBadge kind="log" status={item.status} bare /><span className="routing-subline">{stepText[step]}</span></td>
                      <td className="num routing-amount nowrap">{item.amount === null || !item.currency ? <span className="muted">{sw ? 'Haijaandaliwa' : 'Not prepared'}</span> : money(item.amount, item.currency)}</td>
                      <td>
                        {item.eligible_payors.length ? item.eligible_payors.map((payor) => <span className="routing-payor" key={payor.id}>{payor.name}</span>) : <span className="muted">{sw ? 'Inatafutwa' : 'Pending lookup'}</span>}
                        {item.routing_exception && <span className="routing-exception" title={item.routing_exception}>{sw ? 'Dosari ya kutatua' : 'Exception to resolve'}</span>}
                      </td>
                      <td><button type="button" className="btn btn-primary btn-sm" onClick={() => setOpenId(item.work_log_id)}>{actionText[step]}</button></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
        </AsyncState>
      )}
      <p className="muted small routing-footnote">{sw ? 'Mshahara (Payroll) hauna bei wala kupangiwa mlipaji; tazama ripoti ya mwezi.' : 'Payroll has no pricing or routing; see the monthly report.'}</p>
      {openId !== null && <WorkLogDrawer logId={openId} onClose={() => setOpenId(null)} onChanged={queue.reload} />}
    </div>
  );
}
