import React, { useEffect, useRef, useState } from 'react';
import { qs } from '../api';
import { useAuth } from '../AuthContext';
import { AsyncState, Field, StatusBadge, Tabs } from '../components/ui';
import { WorkLogDrawer } from '../components/worklogs/WorkLogDrawer';
import { ApprovalFinanceGuide } from '../components/worklogs/ApprovalFinanceGuide';
import { dateTime, hoursAge, num, WORKLOG_STATUS_LABELS, WORKLOG_STATUSES, workHours } from '../format';
import { useApi } from '../hooks';
import { Named, PayPeriod, WorkLogSummary } from '../types';
import { navigate } from '../nav';

const REVIEWER_ROLES = ['SUPERVISOR', 'FACILITY_IN_CHARGE', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE'];
const OPERATIONAL_APPROVER_ROLES = ['SUPERVISOR', 'FACILITY_IN_CHARGE', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM'];
const DECISION_ROLES = ['SUPERVISOR', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE'];
const FINANCE_ROLES = ['REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE', 'SUPER_ADMIN'];

function LogTable({ rows, queue, onOpen }: { rows: WorkLogSummary[]; queue: boolean; onOpen: (id: number) => void }) {
  return (
    <div className="table-wrap">
      <table className="clickable">
        <thead>
          <tr>
            <th>#</th>
            <th>Provider</th>
            <th>Cadre</th>
            <th>Region</th>
            <th>Facility</th>
            <th>Period</th>
            <th>Type</th>
            <th>Status</th>
            <th className="num">Days</th>
            <th className="num">Hours</th>
            <th>{queue ? 'Waiting' : 'Updated'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => {
            const overdue = l.is_overdue;
            return (
              <tr
                key={l.id}
                className={overdue ? 'row-over-48' : undefined}
                tabIndex={0}
                onClick={() => onOpen(l.id)}
                onKeyDown={(e) => e.key === 'Enter' && onOpen(l.id)}
                aria-label={`Open work log ${l.id} for ${l.staff_name}`}
              >
                <td>{l.id}</td>
                <td>{l.staff_name}</td>
                <td>{l.cadre_code}</td>
                <td>{l.region_name}</td>
                <td>{l.facility_name || '—'}</td>
                <td>{l.period_label}</td>
                <td><span className="badge badge-neutral">{l.work_type === 'LEGACY' ? 'Legacy' : l.work_type}</span></td>
                <td>
                  <StatusBadge kind="log" status={l.status} bare />
                </td>
                <td className="num">{num(l.entry_count)}</td>
                <td className="num">{workHours(l.total_hours)}</td>
                <td className="nowrap small">
                  {queue || overdue || l.status.startsWith('PENDING') ? (
                    <span className={overdue ? 'over-48' : undefined}>
                      {hoursAge(l.hours_in_status)}
                      {overdue ? ` (${l.reminder_after_hours} h or more)` : ''}
                    </span>
                  ) : (
                    dateTime(l.updated_at)
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ReviewWorkLogs({ initialType }: { initialType?: 'SERVICES' | 'PAYROLL' } = {}) {
  const { hasRole } = useAuth();
  const isReviewer = hasRole(...REVIEWER_ROLES);
  const isFinance = hasRole(...FINANCE_ROLES);
  const canReviewPayroll = hasRole(...OPERATIONAL_APPROVER_ROLES, 'OVERSIGHT');
  // Facility In-Charge has no approval step, so nothing is ever waiting on them. They read their facility's timesheets.
  const decides = hasRole(...DECISION_ROLES);
  const viewsFacilityOnly = hasRole('FACILITY_IN_CHARGE') && !decides;
  const [tab, setTab] = useState<'queue' | 'all'>(decides ? 'queue' : 'all');
  const [status, setStatus] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [cadre, setCadre] = useState('');
  const [regionId, setRegionId] = useState('');
  const [workType, setWorkType] = useState<'SERVICES' | 'PAYROLL' | 'LEGACY'>(initialType || 'SERVICES');
  const visibleWorkType = canReviewPayroll ? workType : 'SERVICES';
  const periods = useApi<PayPeriod[]>(tab === 'all' ? '/admin/pay-periods' : null);
  const cadres = useApi<{ code: string; name: string }[]>('/worklogs/cadres');
  const regions = useApi<Named[]>('/worklogs/regions');
  // The menu badge counts every work type, so open on whichever list actually holds the waiting work.
  const waiting = useApi<WorkLogSummary[]>(decides ? '/worklogs?queue=true' : null);
  const waitingCount = (kind: string) => (waiting.data || []).filter((row) => row.work_type === kind).length;
  const chosen = useRef(Boolean(initialType));
  useEffect(() => {
    if (chosen.current || !waiting.data || !canReviewPayroll) return;
    chosen.current = true;
    if (!waitingCount('SERVICES') && waitingCount('PAYROLL')) setWorkType('PAYROLL');
  }, [waiting.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const path = tab === 'queue' ? `/worklogs${qs({ queue: true, work_type: visibleWorkType, region_id: regionId, cadre })}` : `/worklogs${qs({ status, period_id: periodId, cadre, work_type: visibleWorkType, region_id: regionId })}`;
  const logs = useApi<WorkLogSummary[]>(path);
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <div className="stack-lg">
      <header className="page-header">
        <div>
          <h1>{viewsFacilityOnly ? "My facility's timesheets" : 'Timesheet reviews'}</h1>
          <p className="muted small">{viewsFacilityOnly ? 'Read every cadre at your facility, at any stage.' : 'Open a timesheet, check it, and record your decision.'}</p>
        </div>
        <div className="row">
          {isReviewer && (
            <>
              <Tabs
                label="Work log lists"
                value={tab}
                onChange={setTab}
                tabs={[
                  ...(decides ? [{ key: 'queue' as const, label: `Waiting on me${tab === 'queue' && logs.data ? ` (${logs.data.length})` : ''}` }] : []),
                  { key: 'all' as const, label: 'All visible logs' },
                ]}
              />
              {canReviewPayroll && <Tabs label="Work type queue" value={workType} onChange={setWorkType} tabs={[
                { key: 'SERVICES', label: `Services${waitingCount('SERVICES') ? ` (${waitingCount('SERVICES')})` : ''}` },
                { key: 'PAYROLL', label: `Payroll${waitingCount('PAYROLL') ? ` (${waitingCount('PAYROLL')})` : ''}` },
                { key: 'LEGACY', label: 'Legacy' },
              ]} />}
            </>
          )}
          <button className="btn btn-secondary" onClick={logs.reload} disabled={logs.loading}>
            Refresh
          </button>
          {isFinance && <button type="button" className="btn btn-primary" onClick={() => navigate('finance-monthly')}>Monthly work report</button>}
        </div>
      </header>

      {!isFinance && <ApprovalFinanceGuide />}
      {isFinance && <p className="notice notice-info">Payroll is reported by pay month (26th to 25th) only after CTC, Technical and RM authorization. Finance does not price, budget-review or approve Payroll. <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('finance-monthly')}>Open monthly report</button></p>}
      <p className="notice notice-info">
        {tab === 'queue'
          ? 'Waiting on me shows only records at your approval stage. Use All visible logs to track records at other stages within your assigned scope.'
          : 'All visible logs includes records at every stage within your assigned scope. Technical approval follows CTC verification; RM approval follows technical approval. Drafts cannot be approved.'}
      </p>
      {viewsFacilityOnly && (
        <p className="notice notice-info">These are the timesheets of the cadres at your facility. You can open and read them at every stage. CTC In-Charge verifies them, so you have no approval step here.</p>
      )}
      {((regions.data?.length ?? 0) > 1 || (cadres.data?.length ?? 0) > 1) && (
        <div className="filters" role="search" aria-label="Filter by region and cadre">
          {(regions.data?.length ?? 0) > 1 && <Field label="Region">
            <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
              <option value="">All my regions</option>
              {(regions.data || []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </Field>}
          {(cadres.data?.length ?? 0) > 1 && <Field label="Cadre">
            <select value={cadre} onChange={(e) => setCadre(e.target.value)}>
              <option value="">All my cadres</option>
              {(cadres.data || []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </select>
          </Field>}
        </div>
      )}
      {tab === 'all' && (
        <div className="filters" role="search">
          <Field label="Work type">
            <select value={visibleWorkType} onChange={(e) => setWorkType(e.target.value as typeof workType)}>
              <option value="SERVICES">Services</option>{canReviewPayroll && <option value="PAYROLL">Payroll · approval workflow</option>}<option value="LEGACY">Legacy</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              {WORKLOG_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {WORKLOG_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Period">
            <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
              <option value="">All</option>
              {(periods.data || []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.period_label || p.start_date}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <AsyncState
        data={logs.data}
        error={logs.error}
        loading={logs.loading}
        empty={tab === 'queue' ? 'Nothing is waiting on you right now.' : 'No work logs match these filters.'}
      >
        {(rows) => <LogTable rows={rows} queue={tab === 'queue'} onOpen={setOpenId} />}
      </AsyncState>

      {openId !== null && <WorkLogDrawer logId={openId} onClose={() => setOpenId(null)} onChanged={logs.reload} />}
    </div>
  );
}
