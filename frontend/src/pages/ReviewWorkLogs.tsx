import React, { useEffect, useRef, useState } from 'react';
import { qs } from '../api';
import { useAuth } from '../AuthContext';
import { AsyncState, Field, Kpi, KpiStrip, PersonCell, StatusBadge, Tabs, WorkTypeChip } from '../components/ui';
import { Icon } from '../components/Icon';
import { WorkLogDrawer } from '../components/worklogs/WorkLogDrawer';
import { ageText } from '../components/worklogs/shared';
import { CADRE_NAMES, cadreName, dateTime, num, WORKLOG_STATUS_LABELS, WORKLOG_STATUS_LABELS_SW, WORKLOG_STATUSES, workHours, workTypeName } from '../format';
import { useApi } from '../hooks';
import { Named, PayPeriod, WorkLogSummary } from '../types';
import { navigate } from '../nav';
import { printBatchTarget } from './PrintBatch';
import './polish-review.css';

const REVIEWER_ROLES = ['SUPERVISOR', 'FACILITY_IN_CHARGE', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE'];
const OPERATIONAL_APPROVER_ROLES = ['SUPERVISOR', 'FACILITY_IN_CHARGE', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM'];
const DECISION_ROLES = ['SUPERVISOR', 'CSO_TECHNICAL_OFFICER', 'TECHNICAL_OFFICER', 'RPM', 'REGIONAL_FINANCE'];
const FINANCE_ROLES = ['REGIONAL_FINANCE', 'FHI360_FINANCE', 'CSO_FINANCE', 'SUPER_ADMIN'];

function LogTable({ rows, queue, sw, onOpen }: { rows: WorkLogSummary[]; queue: boolean; sw: boolean; onOpen: (id: number) => void }) {
  const lang = sw ? 'sw' : 'en';
  return (
    <div className="table-wrap review-table">
      <table className="clickable">
        <thead>
          <tr>
            <th>{sw ? 'Mtoa huduma' : 'Provider'}</th>
            <th>{sw ? 'Kada' : 'Cadre'}</th>
            <th>{sw ? 'Mkoa' : 'Region'}</th>
            <th>{sw ? 'Kipindi' : 'Period'}</th>
            <th>{sw ? 'Aina' : 'Type'}</th>
            <th>{sw ? 'Hali' : 'Status'}</th>
            <th className="num">{sw ? 'Siku' : 'Days'}</th>
            <th className="num">{sw ? 'Masaa' : 'Hours'}</th>
            <th>{queue ? (sw ? 'Imesubiri' : 'Waiting') : (sw ? 'Imesasishwa' : 'Updated')}</th>
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
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(l.id); } }}
                aria-label={sw ? `Fungua jedwali ${l.id} la ${l.staff_name}` : `Open work log ${l.id} for ${l.staff_name}`}
              >
                <td><PersonCell name={l.staff_name} sub={`${l.facility_name || '—'} · #${l.id}`} /></td>
                <td>{cadreName(l.cadre_code, lang)}</td>
                <td className="nowrap">{l.region_name || '—'}</td>
                <td className="nowrap">{l.period_label}</td>
                <td><WorkTypeChip type={l.work_type} /></td>
                <td>
                  <StatusBadge kind="log" status={l.status} bare />
                </td>
                <td className="num">{num(l.entry_count)}</td>
                <td className="num">{workHours(l.total_hours)}</td>
                <td className="nowrap small">
                  {queue || overdue || l.status.startsWith('PENDING') ? (
                    <span className={overdue ? 'over-48' : undefined}>
                      {ageText(l.hours_in_status, lang)}
                      {overdue ? (sw ? ` (saa ${l.reminder_after_hours} au zaidi)` : ` (${l.reminder_after_hours} h or more)`) : ''}
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
  const { hasRole, lang: authLang } = useAuth();
  const lang = authLang === 'sw' ? 'sw' : 'en';
  const sw = lang === 'sw';
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
  const listFilters = tab === 'queue'
    ? { queue: true, work_type: visibleWorkType, region_id: regionId, cadre }
    : { status, period_id: periodId, cadre, work_type: visibleWorkType, region_id: regionId };
  const path = tab === 'queue' ? `/worklogs${qs({ queue: true, work_type: visibleWorkType, region_id: regionId, cadre })}` : `/worklogs${qs({ status, period_id: periodId, cadre, work_type: visibleWorkType, region_id: regionId })}`;
  const logs = useApi<WorkLogSummary[]>(path);
  const [openId, setOpenId] = useState<number | null>(null);
  const t = (en: string, swText: string) => (sw ? swText : en);
  const typeName = (type: string) => workTypeName(type, lang);
  const statusName = (key: string) => (sw && WORKLOG_STATUS_LABELS_SW[key]) || WORKLOG_STATUS_LABELS[key];

  // Headline numbers come only from lists this page already loads.
  const waitingRows = waiting.data || [];
  const listRows = logs.data || [];
  const kpis: Kpi[] | null = decides
    ? waiting.data ? [
      {
        label: t('Waiting on me', 'Zinazonisubiri'), value: num(waitingRows.length), icon: 'clipboard', tone: 'info',
        onClick: () => setTab('queue'), active: tab === 'queue',
      },
      {
        label: t('Waiting over 24 h', 'Zimesubiri zaidi ya saa 24'), value: num(waitingRows.filter((row) => row.hours_in_status > 24).length), icon: 'clock',
        tone: waitingRows.some((row) => row.hours_in_status > 24) ? 'warn' : 'success',
        note: waitingRows.some((row) => row.is_overdue) ? t(`${waitingRows.filter((row) => row.is_overdue).length} past the reminder time`, `${waitingRows.filter((row) => row.is_overdue).length} zimepita muda wa ukumbusho`) : undefined,
      },
      ...(canReviewPayroll ? [
        { label: t('Services waiting', 'Huduma zinazosubiri'), value: num(waitingCount('SERVICES')), icon: 'route' as const, onClick: () => setWorkType('SERVICES'), active: visibleWorkType === 'SERVICES' },
        { label: t('Payroll waiting', 'Mshahara unaosubiri'), value: num(waitingCount('PAYROLL')), icon: 'wallet' as const, onClick: () => setWorkType('PAYROLL'), active: visibleWorkType === 'PAYROLL' },
      ] : []),
    ] : null
    : logs.data ? [
      { label: t('Timesheets in this list', 'Majedwali kwenye orodha hii'), value: num(listRows.length), icon: 'clipboard', tone: 'neutral' },
      { label: t('Awaiting approval', 'Yanasubiri idhini'), value: num(listRows.filter((row) => row.status.startsWith('PENDING')).length), icon: 'clock', tone: 'info' },
      {
        label: t('Waiting over 24 h', 'Zimesubiri zaidi ya saa 24'), value: num(listRows.filter((row) => row.status.startsWith('PENDING') && row.hours_in_status > 24).length), icon: 'alert',
        tone: listRows.some((row) => row.status.startsWith('PENDING') && row.hours_in_status > 24) ? 'warn' : 'success',
      },
      { label: t('Returned to provider', 'Yamerudishwa kwa mtoa huduma'), value: num(listRows.filter((row) => row.status === 'RETURNED_TO_PROVIDER').length), icon: 'refresh', tone: 'neutral' },
    ] : null;
  const showScopeFilters = (regions.data?.length ?? 0) > 1 || (cadres.data?.length ?? 0) > 1;

  return (
    <div className="stack-lg review-page">
      {kpis && <KpiStrip items={kpis} label={t('Timesheet numbers', 'Takwimu za majedwali')} />}

      <header className="page-header review-toolbar">
        <h1>{viewsFacilityOnly ? t("My facility's timesheets", 'Majedwali ya kituo changu') : t('Timesheet reviews', 'Mapitio ya majedwali')}</h1>
        <div className="review-toolbar-tabs">
          {isReviewer && (
            <>
              <Tabs
                label="Work log lists"
                value={tab}
                onChange={setTab}
                tabs={[
                  ...(decides ? [{ key: 'queue' as const, label: `${t('Waiting on me', 'Zinazonisubiri')}${tab === 'queue' && logs.data ? ` (${logs.data.length})` : ''}` }] : []),
                  { key: 'all' as const, label: t('All visible logs', 'Zote ninazoweza kuona') },
                ]}
              />
              {canReviewPayroll && <Tabs label="Work type queue" value={workType} onChange={setWorkType} tabs={[
                { key: 'SERVICES', label: `${typeName('SERVICES')}${waitingCount('SERVICES') ? ` (${waitingCount('SERVICES')})` : ''}` },
                { key: 'PAYROLL', label: `${typeName('PAYROLL')}${waitingCount('PAYROLL') ? ` (${waitingCount('PAYROLL')})` : ''}` },
                { key: 'LEGACY', label: typeName('LEGACY') },
              ]} />}
            </>
          )}
        </div>
        <div className="review-toolbar-actions">
          <button type="button" className="btn btn-ghost" onClick={logs.reload} disabled={logs.loading}>
            <Icon name="refresh" size={16} /> {t('Refresh', 'Pakia upya')}
          </button>
          {(logs.data?.length ?? 0) > 0 && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate('print-batch', printBatchTarget(listFilters))}>
              {t(`Print all (${logs.data?.length})`, `Chapisha zote (${logs.data?.length})`)}
            </button>
          )}
          {isFinance && <button type="button" className="btn btn-primary" onClick={() => navigate('finance-monthly')}>{t('Monthly work report', 'Ripoti ya kazi ya mwezi')}</button>}
        </div>
      </header>

      {isFinance && <p className="notice notice-info review-note">{t('Payroll is report-only for Finance, by pay month (26th–25th).', 'Kwa Fedha, Mshahara ni ripoti tu, kwa mwezi wa malipo (tarehe 26–25).')}</p>}
      {viewsFacilityOnly && (
        <p className="notice notice-info review-note">{t('Read only. CTC In-Charge verifies these timesheets.', 'Kusoma tu. Mkuu wa CTC ndiye anayehakiki majedwali haya.')}</p>
      )}
      {(showScopeFilters || tab === 'all') && (
        <div className="filters review-filters" role="search" aria-label={t('Filter timesheets', 'Chuja majedwali')}>
          {(regions.data?.length ?? 0) > 1 && <Field label={t('Region', 'Mkoa')}>
            <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
              <option value="">{t('All my regions', 'Mikoa yangu yote')}</option>
              {(regions.data || []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </Field>}
          {(cadres.data?.length ?? 0) > 1 && <Field label={t('Cadre', 'Kada')}>
            <select value={cadre} onChange={(e) => setCadre(e.target.value)}>
              <option value="">{t('All my cadres', 'Kada zangu zote')}</option>
              {(cadres.data || []).map((c) => <option key={c.code} value={c.code}>{CADRE_NAMES[c.code] ? cadreName(c.code, lang) : c.name}</option>)}
            </select>
          </Field>}
          {tab === 'all' && <>
            <Field label={t('Work type', 'Aina ya kazi')}>
              <select value={visibleWorkType} onChange={(e) => setWorkType(e.target.value as typeof workType)}>
                <option value="SERVICES">{typeName('SERVICES')}</option>
                {canReviewPayroll && <option value="PAYROLL">{t('Payroll · approval workflow', 'Mshahara · mtiririko wa idhini')}</option>}
                <option value="LEGACY">{typeName('LEGACY')}</option>
              </select>
            </Field>
            <Field label={t('Status', 'Hali')}>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">{t('All', 'Zote')}</option>
                {WORKLOG_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusName(s)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Period', 'Kipindi')}>
              <select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                <option value="">{t('All', 'Vyote')}</option>
                {(periods.data || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.period_label || p.start_date}
                  </option>
                ))}
              </select>
            </Field>
          </>}
        </div>
      )}

      <AsyncState
        data={logs.data}
        error={logs.error}
        loading={logs.loading}
        empty={tab === 'queue' ? t('Nothing is waiting on you right now.', 'Hakuna kinachokusubiri kwa sasa.') : t('No timesheets match these filters.', 'Hakuna majedwali yanayolingana na vichujio hivi.')}
      >
        {(rows) => <LogTable rows={rows} queue={tab === 'queue'} sw={sw} onOpen={setOpenId} />}
      </AsyncState>

      {openId !== null && <WorkLogDrawer logId={openId} onClose={() => setOpenId(null)} onChanged={logs.reload} />}
    </div>
  );
}
