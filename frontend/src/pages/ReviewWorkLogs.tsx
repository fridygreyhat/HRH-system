import React, { useState } from 'react';
import { qs } from '../api';
import { useAuth } from '../AuthContext';
import { AsyncState, Field, StatusBadge, Tabs } from '../components/ui';
import { WorkLogDrawer } from '../components/worklogs/WorkLogDrawer';
import { ApprovalFinanceGuide } from '../components/worklogs/ApprovalFinanceGuide';
import { dateTime, hoursAge, num, WORKLOG_STATUS_LABELS, WORKLOG_STATUSES } from '../format';
import { useApi } from '../hooks';
import { Cadre, PayPeriod, WorkLogSummary } from '../types';
import { navigate } from '../nav';

const REVIEWER_ROLES = ['SUPERVISOR', 'FACILITY_IN_CHARGE', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE'];
const OPERATIONAL_APPROVER_ROLES = ['SUPERVISOR', 'FACILITY_IN_CHARGE', 'TECHNICAL_OFFICER', 'RPM'];
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
                <td>{l.facility_name || '—'}</td>
                <td>{l.period_label}</td>
                <td><span className="badge badge-neutral">{l.work_type === 'LEGACY' ? 'Legacy' : l.work_type}</span></td>
                <td>
                  <StatusBadge kind="log" status={l.status} bare />
                </td>
                <td className="num">{num(l.entry_count)}</td>
                <td className="num">{num(l.total_hours)}</td>
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

export function ReviewWorkLogs() {
  const { hasRole } = useAuth();
  const isReviewer = hasRole(...REVIEWER_ROLES);
  const isFinance = hasRole(...FINANCE_ROLES);
  const canReviewPayroll = hasRole(...OPERATIONAL_APPROVER_ROLES);
  const [tab, setTab] = useState<'queue' | 'all'>(hasRole('RPM') || !isReviewer ? 'all' : 'queue');
  const [status, setStatus] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [cadre, setCadre] = useState('');
  const [workType, setWorkType] = useState<'SERVICES' | 'PAYROLL' | 'LEGACY'>('SERVICES');
  const visibleWorkType = canReviewPayroll ? workType : 'SERVICES';
  const periods = useApi<PayPeriod[]>(tab === 'all' ? '/admin/pay-periods' : null);
  const cadres = useApi<Cadre[]>(tab === 'all' ? '/admin/cadres' : null);
  const path = tab === 'queue' ? `/worklogs${qs({ queue: true, work_type: visibleWorkType })}` : `/worklogs${qs({ status, period_id: periodId, cadre, work_type: visibleWorkType })}`;
  const logs = useApi<WorkLogSummary[]>(path);
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <div className="stack-lg">
      <header className="page-header">
        <div>
          <h1>Work logs</h1>
          <p className="muted small">Review and endorse work logs within your assigned approval scope.</p>
        </div>
        <div className="row">
          {isReviewer && (
            <>
              <Tabs
                label="Work log lists"
                value={tab}
                onChange={setTab}
                tabs={[
                  { key: 'queue', label: `Waiting on me${tab === 'queue' && logs.data ? ` (${logs.data.length})` : ''}` },
                  { key: 'all', label: 'All visible logs' },
                ]}
              />
              <Tabs label="Work type queue" value={workType} onChange={setWorkType} tabs={[
                { key: 'SERVICES', label: 'Services' },
                { key: 'PAYROLL', label: 'Payroll' },
                { key: 'LEGACY', label: 'Legacy' },
              ]} />
            </>
          )}
          <button className="btn btn-secondary" onClick={logs.reload} disabled={logs.loading}>
            Refresh
          </button>
          {isFinance && <button type="button" className="btn btn-primary" onClick={() => navigate('finance-monthly')}>Monthly work report</button>}
        </div>
      </header>

      {!isFinance && <ApprovalFinanceGuide />}
      {isFinance && <p className="notice notice-info">Payroll is reported by calendar month only after CTC, Technical and RM authorization. Finance does not price, budget-review or approve Payroll. <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('finance-monthly')}>Open monthly report</button></p>}
      <p className="notice notice-info">
        {tab === 'queue'
          ? 'Waiting on me shows only records at your approval stage. Use All visible logs to track records at other stages within your assigned scope.'
          : 'All visible logs includes records at every stage within your assigned scope. Technical approval follows CTC verification; RM approval follows technical approval. Drafts cannot be approved.'}
      </p>
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
          <Field label="Cadre">
            <select value={cadre} onChange={(e) => setCadre(e.target.value)}>
              <option value="">All</option>
              {(cadres.data || []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
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
