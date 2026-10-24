import { MiniStepper } from '../components/worklogs/ApprovalStepper';
import React, { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { WorkLogEditor } from '../components/worklogs/WorkLogEditor';
import { Alert, AsyncState, Field, StatusBadge } from '../components/ui';
import { dateOnly, num, todayLocal } from '../format';
import { useAction, useApi } from '../hooks';
import { PayPeriod, WorkLogDetail, WorkLogSummary } from '../types';

export function MyWorkLogs() {
  const { me, t } = useAuth();
  const logs = useApi<WorkLogSummary[]>('/worklogs?mine=true');
  const periods = useApi<PayPeriod[]>('/admin/pay-periods');
  const [openId, setOpenId] = useState<number | null>(null);
  const [periodId, setPeriodId] = useState('');
  const [workType, setWorkType] = useState<'SERVICES' | 'PAYROLL'>('SERVICES');
  const { busy, error, run } = useAction();

  if (openId !== null) {
    return (
      <WorkLogEditor
        logId={openId}
        onBack={() => {
          setOpenId(null);
          logs.reload();
        }}
      />
    );
  }

  const used = new Set((logs.data || []).filter((l) => l.work_type === workType).map((l) => l.period_id));
  const today = todayLocal();
  const startable = (periods.data || []).filter((p) => p.status === 'OPEN' && p.start_date <= today && !used.has(p.id));

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    const created = await run(() => api.post<WorkLogDetail>('/worklogs', { period_id: Number(periodId), work_type: workType }));
    if (created) {
      setPeriodId('');
      setOpenId(created.id);
    }
  };

  return (
    <div className="stack-lg">
      <header className="page-header">
        <div>
          <h1>{t('myWorkLogs')}</h1>
          {me?.cadre && <p className="muted small">{me.cadre.form_title || me.cadre.name}</p>}
        </div>
      </header>

      {!me?.staff && (
        <Alert kind="warn">
          Your account is not linked to a staff record (CHW, Data Clerk or HCP), so you cannot start work logs yet. A system administrator can link it
          under Administration → Users → Manage.
        </Alert>
      )}

      <form className="card stack" onSubmit={start}>
        <h3>{t('startLog')}</h3>
        {periods.error && <Alert>{periods.error}</Alert>}
        {periods.data && startable.length === 0 ? (
          <p className="muted">{t('noOpenPeriods')}</p>
        ) : (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Work type">
              <select value={workType} onChange={(e) => { setWorkType(e.target.value as 'SERVICES' | 'PAYROLL'); setPeriodId(''); }}>
                <option value="SERVICES">Services</option>
                <option value="PAYROLL">Payroll</option>
              </select>
            </Field>
            <Field label={t('payPeriod')}>
              <select required value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                <option value="">—</option>
                {startable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.period_label || `${dateOnly(p.start_date)} – ${dateOnly(p.end_date)}`}
                  </option>
                ))}
              </select>
            </Field>
            <button className="btn btn-primary" disabled={busy || !periodId}>
              {t('start')}
            </button>
          </div>
        )}
        <Alert>{error}</Alert>
      </form>

      <AsyncState data={logs.data} error={logs.error} loading={logs.loading} empty={t('noLogs')}>
        {(rows) => (
          <div className="stack">
            {rows.map((l) => (
              <button key={l.id} type="button" className="card log-card" onClick={() => setOpenId(l.id)} aria-label={`${t('open')} ${l.period_label}`}>
                <div className="row-between">
                  <strong>{l.period_label}</strong>
                  <span className="row"><span className="badge badge-neutral">{l.work_type === 'LEGACY' ? 'Legacy' : l.work_type}</span><StatusBadge kind="log" status={l.status} /></span>
                </div>
                <MiniStepper status={l.status} />
                <div className="muted small">
                  {num(l.entry_count)} {t('days').toLowerCase()} · {num(l.total_hours)} {t('hours').toLowerCase()} · #{l.id}
                </div>
              </button>
            ))}
          </div>
        )}
      </AsyncState>
    </div>
  );
}
