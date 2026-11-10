import React, { useMemo, useState } from 'react';
import { qs } from '../api';
import { useAuth } from '../AuthContext';
import { Alert } from '../components/ui';
import { WORKLOG_STATUS_LABELS, label, num, payMonth, payMonthDates, previousMonth, todayLocal, workHours } from '../format';
import { useApi } from '../hooks';
import { navigate } from '../nav';
import { PrintableLog, TimesheetPaper, monthLabel } from './PrintWorkLog';
import './polish-review.css';

export interface PrintBatchLog extends PrintableLog {
  days: number;
  hours: string | number;
}

export interface PrintBatchData {
  month: string;
  printed_by: string;
  logs: PrintBatchLog[];
}

/** Filters copied from the review list, so the printout holds exactly what the list showed. */
const FILTERS = ['queue', 'status', 'period_id', 'region_id', 'cadre', 'work_type'] as const;

export function printBatchTarget(filters: Partial<Record<(typeof FILTERS)[number], string | boolean>>): string {
  return encodeURIComponent(qs(filters).replace(/^\?/, ''));
}

/** The pay month most likely under review: the latest one that has already ended on the 25th. */
const lastEndedMonth = () => previousMonth(payMonth(todayLocal()));

export function PrintBatch({ target }: { target: string | null }) {
  const filters = useMemo(() => {
    const params = new URLSearchParams(decodeURIComponent(target || ''));
    return Object.fromEntries(FILTERS.filter((key) => params.get(key)).map((key) => [key, params.get(key) as string]));
  }, [target]);
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const [month, setMonth] = useState(lastEndedMonth);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const batch = useApi<PrintBatchData>(`/worklogs/print${qs({ ...filters, month })}`, { timeoutMs: 120000 });
  const logs = batch.data?.logs || [];
  const printed = skipEmpty ? logs.filter((log) => log.days > 0) : logs;
  const months = [0, 1, 2, 3, 4, 5].map((back) => {
    let value = payMonth(todayLocal());
    for (let i = 0; i < back; i += 1) value = previousMonth(value);
    return value;
  });
  const totalHours = printed.reduce((sum, log) => sum + Number(log.hours || 0), 0);
  const totalDays = printed.reduce((sum, log) => sum + log.days, 0);
  const scope = [
    filters.queue ? 'Waiting on me' : 'All visible logs',
    filters.work_type === 'PAYROLL' ? 'Payroll' : filters.work_type === 'LEGACY' ? 'Legacy' : 'Services',
    filters.cadre, filters.status && label(WORKLOG_STATUS_LABELS, filters.status),
  ].filter(Boolean).join(' · ');

  return (
    <div className="print-batch">
      <div className="print-toolbar review-print-toolbar no-print">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => (window.history.length > 1 ? window.history.back() : navigate('worklogs'))}>← {sw ? 'Rudi' : 'Back'}</button>
        <label className="row print-month">
          <span className="review-print-label">{sw ? 'Mwezi wa malipo' : 'Pay month'}</span>
          <select aria-label={sw ? 'Mwezi wa malipo' : 'Pay month'} value={month} onChange={(event) => setMonth(event.target.value)}>
            {months.map((value) => <option key={value} value={value}>{monthLabel(value)} ({payMonthDates(value)})</option>)}
          </select>
        </label>
        <label className="check-line">
          <input type="checkbox" checked={skipEmpty} onChange={(event) => setSkipEmpty(event.target.checked)} />
          <span>{sw ? 'Acha majedwali yasiyo na siku mwezi huu' : 'Leave out timesheets with no days this month'}</span>
        </label>
        <span className="review-print-end">
          {batch.data && printed.length > 0 && <span className="review-print-summary">
            {sw
              ? `Majedwali ${num(printed.length)} · siku ${num(totalDays)} · masaa ${workHours(totalHours)}`
              : `${num(printed.length)} timesheets · ${num(totalDays)} days · ${workHours(totalHours)} h`}
          </span>}
          <span className="muted small">{sw ? 'A4 kwa ulalo.' : 'Landscape A4.'}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()} disabled={!printed.length}>
            {sw ? `Chapisha${printed.length ? ` majedwali ${printed.length}` : ''}` : `Print${printed.length ? ` ${printed.length} timesheets` : ''}`}
          </button>
        </span>
      </div>

      {batch.error && <Alert>{batch.error}</Alert>}
      {batch.loading && !batch.data && <p className="muted" role="status">{sw ? 'Inaandaa majedwali…' : 'Preparing timesheets…'}</p>}
      {batch.data && !printed.length && <Alert kind="info">{sw
        ? `Hakuna jedwali kwenye orodha hii lenye siku za ${monthLabel(month)}. Chagua mwezi mwingine.`
        : `No timesheets in this list have days in ${monthLabel(month)}. Choose another pay month.`}</Alert>}

      {batch.data && printed.length > 0 && (
        <>
          <article className="paper register" aria-label="Timesheet register">
            <h1>Daftari la majedwali / Timesheet register</h1>
            <h2>{monthLabel(month)} · {payMonthDates(month)} · {scope}</h2>
            <div className="paper-table">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Jina / Provider</th><th>Kada / Cadre</th><th>Mkoa / Region</th><th>Kituo / Facility</th>
                    <th>Siku / Days</th><th>Masaa / Hours</th><th>Hali / Status</th><th>Kumbukumbu / Log</th>
                  </tr>
                </thead>
                <tbody>
                  {printed.map((log, index) => (
                    <tr key={log.id}>
                      <td>{index + 1}</td>
                      <td>{log.staff.name}</td>
                      <td>{log.cadre.code}</td>
                      <td>{log.assignment?.region || '—'}</td>
                      <td>{log.assignment?.facility || log.assignment?.community_area || '—'}</td>
                      <td>{num(log.days)}</td>
                      <td>{workHours(log.hours)}</td>
                      <td>{label(WORKLOG_STATUS_LABELS, log.status)}</td>
                      <td>#{log.id}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={5}>Jumla / Total · {printed.length} providers</th>
                    <th>{num(totalDays)}</th>
                    <th>{workHours(totalHours)}</th>
                    <th colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="signoff">
              <div><b>Imeandaliwa na</b> / <i>Printed by</i><div className="who">{batch.data.printed_by}</div></div>
              <div><b>Sahihi</b> / <i>Signature</i><div className="who">&nbsp;</div></div>
              <div><b>Tarehe</b> / <i>Date</i><div className="who">&nbsp;</div></div>
            </div>
          </article>
          {printed.map((log) => <TimesheetPaper key={log.id} log={log} month={month} />)}
        </>
      )}
    </div>
  );
}
