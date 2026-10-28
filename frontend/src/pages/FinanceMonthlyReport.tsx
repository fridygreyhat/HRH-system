import React, { useMemo, useState } from 'react';
import { qs } from '../api';
import { Alert, AsyncState, Field } from '../components/ui';
import { todayLocal, num } from '../format';
import { useApi } from '../hooks';
import { Named } from '../types';
import './finance-monthly-report.css';

type WorkType = 'PAYROLL' | 'SERVICES';
interface IndicatorTotal {
  key: string;
  label: string;
  total: string;
}
interface MonthlyProvider {
  staff_id: number;
  provider_name: string;
  cadre_code: string;
  cadre_name: string;
  facility_name: string;
  region_name: string;
  days: number;
  hours: string;
  indicators: IndicatorTotal[];
}
interface MonthlyCadre {
  code: string;
  name: string;
  provider_count: number;
  days: number;
  hours: string;
  indicators: IndicatorTotal[];
}
interface MonthlySummary {
  month: string;
  work_type: WorkType;
  totals: { providers: number; days: number; hours: string; logs: number };
  providers: MonthlyProvider[];
  cadres: MonthlyCadre[];
}

const monthName = (month: string) => {
  const date = new Date(`${month}-01T00:00:00`);
  return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(date);
};

function IndicatorList({ indicators }: { indicators: IndicatorTotal[] }) {
  if (!indicators.length) return <span className="muted">No indicators recorded</span>;
  return (
    <dl className="finance-indicators">
      {indicators.map((indicator) => (
        <div key={indicator.key}>
          <dt>{indicator.label}</dt>
          <dd>{num(indicator.total)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FinanceMonthlyReport() {
  const [month, setMonth] = useState(() => todayLocal().slice(0, 7));
  const [workType, setWorkType] = useState<WorkType>('PAYROLL');
  const [regionId, setRegionId] = useState('');
  const regions = useApi<Named[]>('/finance/regions');
  const summary = useApi<MonthlySummary>(`/finance/monthly-summary${qs({ month, region_id: regionId, work_type: workType })}`);
  const providers = useMemo(() => summary.data?.providers || [], [summary.data]);

  return (
    <div className="stack-lg finance-monthly">
      <header className="page-header finance-monthly-heading">
        <div>
          <p className="routing-eyebrow">Finance · calendar-month totals</p>
          <h1>Monthly work report</h1>
          <p className="muted small">One approved-work view across CHW, HCP and Data Clerk cadres. Totals follow entry dates within the selected calendar month.</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => { summary.reload(); regions.reload(); }} disabled={summary.loading}>
          Refresh report
        </button>
      </header>

      <section className="finance-report-note" aria-label="Report scope">
        <span className="finance-report-note-mark" aria-hidden="true">MONTH</span>
        <p><strong>Approved work, not payment preparation.</strong> Payroll appears after CTC → Technical → RM authorization. This report aggregates indicators and hours only; it does not show daily entries, prices, budgets or finance approvals.</p>
      </section>

      <div className="filters finance-monthly-filters" role="search" aria-label="Filter monthly report">
        <Field label="Calendar month">
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Calendar month" />
        </Field>
        <Field label="Work type">
          <select value={workType} onChange={(event) => setWorkType(event.target.value as WorkType)} aria-label="Work type">
            <option value="PAYROLL">Payroll · approved work</option>
            <option value="SERVICES">Services · aggregate view</option>
          </select>
        </Field>
        <Field label="Region">
          <select value={regionId} onChange={(event) => setRegionId(event.target.value)} aria-label="Region">
            <option value="">All regions in my scope</option>
            {(regions.data || []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
          </select>
        </Field>
        {regions.error && <Alert kind="warn">Region options could not be loaded. Showing your authorized scope. {regions.error}</Alert>}
      </div>

      {summary.error ? (
        <div className="stack">
          <Alert>{summary.error}</Alert>
          <div><button type="button" className="btn btn-secondary" onClick={summary.reload}>Try again</button></div>
        </div>
      ) : (
        <AsyncState
          data={summary.data}
          error={null}
          loading={summary.loading}
          isEmpty={(data) => data.providers.length === 0}
          empty={<div className="finance-monthly-empty"><span className="finance-empty-month">{month}</span><div><strong>No approved work in this month</strong><p>Try another month or region. Only RM-authorized work with entry dates in the selected month is included.</p></div></div>}
        >
          {(data) => (
            <div className="stack-lg" aria-live="polite">
              <section className="finance-monthly-overview" aria-label={`${monthName(data.month)} report totals`}>
                <div className="finance-overview-title">
                  <span className="finance-overview-kicker">{data.work_type === 'PAYROLL' ? 'Approved payroll work' : 'Services activity'}</span>
                  <h2>{monthName(data.month)}</h2>
                </div>
                <div className="finance-total"><span>Providers</span><strong>{num(data.totals.providers)}</strong></div>
                <div className="finance-total"><span>Total hours</span><strong>{num(data.totals.hours)}<small>hrs</small></strong></div>
                <div className="finance-total"><span>Work days</span><strong>{num(data.totals.days)}</strong></div>
                <div className="finance-total"><span>Approved logs</span><strong>{num(data.totals.logs)}</strong></div>
              </section>

              <section className="finance-cadre-section" aria-labelledby="cadre-totals-heading">
                <div className="finance-section-heading">
                  <div><p className="finance-overview-kicker">Across the same month</p><h2 id="cadre-totals-heading">Cadre totals</h2></div>
                  <span>{data.cadres.length} cadres in scope</span>
                </div>
                <div className="table-wrap finance-report-table-wrap">
                  <table className="finance-report-table finance-cadre-table">
                    <thead><tr><th>Cadre</th><th className="num">Providers</th><th className="num">Days</th><th className="num">Hours</th><th>Aggregate indicators</th></tr></thead>
                    <tbody>{data.cadres.map((cadre) => (
                      <tr key={cadre.code}>
                        <th scope="row"><strong>{cadre.name}</strong><span className="finance-subline">{cadre.code}</span></th>
                        <td className="num">{num(cadre.provider_count)}</td>
                        <td className="num">{num(cadre.days)}</td>
                        <td className="num finance-hours">{num(cadre.hours)}</td>
                        <td><IndicatorList indicators={cadre.indicators} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>

              <section className="finance-provider-section" aria-labelledby="provider-totals-heading">
                <div className="finance-section-heading">
                  <div><p className="finance-overview-kicker">No daily entries</p><h2 id="provider-totals-heading">Provider month totals</h2></div>
                  <span>{num(data.totals.providers)} providers</span>
                </div>
                <div className="table-wrap finance-report-table-wrap">
                  <table className="finance-report-table finance-provider-table">
                    <thead><tr><th>Provider</th><th>Cadre</th><th>Facility · region</th><th className="num">Days</th><th className="num">Hours</th><th>Aggregate indicators</th></tr></thead>
                    <tbody>{providers.map((provider) => (
                      <tr key={`${provider.staff_id}-${provider.cadre_code}`}>
                        <th scope="row"><strong>{provider.provider_name}</strong></th>
                        <td><strong>{provider.cadre_code}</strong><span className="finance-subline">{provider.cadre_name}</span></td>
                        <td><strong>{provider.facility_name || '—'}</strong><span className="finance-subline">{provider.region_name}</span></td>
                        <td className="num">{num(provider.days)}</td>
                        <td className="num finance-hours">{num(provider.hours)}</td>
                        <td><IndicatorList indicators={provider.indicators} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </AsyncState>
      )}
      <p className="muted small finance-report-footnote">Indicators are aggregated activity totals, not unique-client counts. A work period spanning months is counted by its entry dates, never as a whole pay period.</p>
    </div>
  );
}
