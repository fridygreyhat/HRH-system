import React, { useState } from 'react';
import { qs } from '../../api';
import { useAuth } from '../../AuthContext';
import { money, num, payMonth, todayLocal } from '../../format';
import { useApi } from '../../hooks';
import { ChartCard, StackedBars } from '../charts';
import { AsyncState, Empty, Field, KpiStrip } from '../ui';
import { monthLabel } from './AuditDashboard';

export interface Cell {
  salary_expected: string;
  salary_paid: string;
  services_expected: string;
  services_paid: string;
  services_in_review: string;
  outstanding: string;
  issues: number;
  budget_allocated: string;
  budget_used: string;
}
export interface CentralData {
  start: string;
  end: string;
  months: (Cell & { month: string; reconciled: boolean })[];
  by_region: { region: string; total: Cell; months: (Cell & { month: string })[] }[];
  by_cadre: (Cell & { cadre: string })[];
  totals: Cell & { months_reconciled: number; month_count: number };
}

type Measure = 'total' | 'salary' | 'services' | 'outstanding';

const n = (value: string | undefined | null) => Number(value || 0);
const short = (value: number) => money(String(value));

/** Months back from a month, e.g. ("2026-10", 11) -> "2025-11". */
export function monthsBefore(month: string, count: number): string {
  const [year, number] = month.split('-').map(Number);
  const index = year * 12 + (number - 1) - count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The figure shown in each cell of the region-by-month table. */
export function measureOf(cell: Cell, measure: Measure): number {
  if (measure === 'salary') return n(cell.salary_paid);
  if (measure === 'services') return n(cell.services_paid);
  if (measure === 'outstanding') return n(cell.outstanding);
  return n(cell.salary_paid) + n(cell.services_paid);
}

/** Everything in one place: salaries and Services paid in every region, month by month. */
export function CentralDashboard({ regionId }: { regionId: string }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const tr = (en: string, swText: string) => (sw ? swText : en);
  const thisMonth = payMonth(todayLocal());
  const [end, setEnd] = useState(thisMonth);
  const [start, setStart] = useState(() => monthsBefore(thisMonth, 11));
  const [measure, setMeasure] = useState<Measure>('total');
  const data = useApi<CentralData>(start && end ? `/finance/reconciliation/overview${qs({ start, end, region_id: regionId })}` : null);
  const SALARY = tr('Salaries paid', 'Mishahara iliyolipwa');
  const SERVICES = tr('Services paid', 'Huduma zilizolipwa');
  const DUE = tr('Still to pay', 'Bado kulipwa');
  const MEASURES: Record<Measure, string> = {
    total: tr('Total paid (salaries + Services)', 'Jumla iliyolipwa (mishahara + Huduma)'),
    salary: SALARY, services: SERVICES, outstanding: DUE,
  };
  const segments = (cell: Cell) => [
    { key: 'salary', label: SALARY, value: n(cell.salary_paid) },
    { key: 'services', label: SERVICES, value: n(cell.services_paid) },
    { key: 'due', label: DUE, value: n(cell.outstanding) },
  ];
  const categories = [{ key: 'salary', label: SALARY }, { key: 'services', label: SERVICES }, { key: 'due', label: DUE }];

  return (
    <div className="stack-lg">
      <div className="filters">
        <Field label={tr('From', 'Kuanzia')}>
          <input type="month" value={start} max={end} onChange={(event) => setStart(event.target.value)} />
        </Field>
        <Field label={tr('To', 'Hadi')}>
          <input type="month" value={end} min={start} onChange={(event) => setEnd(event.target.value)} />
        </Field>
      </div>
      <AsyncState data={data.data} error={data.error} loading={data.loading}>
        {(d) => {
          const t = d.totals;
          const paid = n(t.salary_paid) + n(t.services_paid);
          const budgetUsed = n(t.budget_allocated) ? Math.round((n(t.budget_used) / n(t.budget_allocated)) * 100) : 0;
          const rows = d.by_region;
          return (
            <div className="stack-lg">
              <KpiStrip
                label={tr('All regions, all months', 'Mikoa yote, miezi yote')}
                items={[
                  { label: tr('Total paid', 'Jumla iliyolipwa'), value: money(String(paid)), icon: 'wallet', tone: 'success',
                    note: `${monthLabel(d.start)} – ${monthLabel(d.end)}` },
                  { label: SALARY, value: money(t.salary_paid), icon: 'users', note: `${tr('Signed', 'Iliyosainiwa')} ${money(t.salary_expected)}` },
                  { label: SERVICES, value: money(t.services_paid), icon: 'receipt', note: `${tr('Approved', 'Imeidhinishwa')} ${money(t.services_expected)}` },
                  { label: DUE, value: money(t.outstanding), icon: 'clock', tone: n(t.outstanding) ? 'warn' : 'success',
                    note: n(t.services_in_review) ? `${tr('In review', 'Bado kukaguliwa')} ${money(t.services_in_review)}` : undefined },
                  { label: tr('Services budget used', 'Bajeti ya Huduma iliyotumika'), value: n(t.budget_allocated) ? `${budgetUsed}%` : '—', icon: 'pie',
                    tone: budgetUsed > 90 ? 'danger' : budgetUsed > 75 ? 'warn' : 'info', note: n(t.budget_allocated) ? `${money(t.budget_used)} / ${money(t.budget_allocated)}` : undefined },
                  { label: tr('Months reconciled', 'Miezi iliyothibitishwa'), value: `${num(t.months_reconciled)} / ${num(t.month_count)}`, icon: 'check',
                    tone: t.months_reconciled === t.month_count ? 'success' : 'info', note: `${num(t.issues)} ${tr('issues', 'masuala')}` },
                ]}
              />
              <div className="grid-charts">
                <ChartCard
                  title={tr('Paid every month', 'Malipo kila mwezi')}
                  subtitle={tr('Salaries and Services paid, and what is still to pay', 'Mishahara na Huduma zilizolipwa, na zinazosubiri')}
                  table={(
                    <table>
                      <thead><tr><th scope="col">{tr('Month', 'Mwezi')}</th><th scope="col" className="num">{SALARY}</th><th scope="col" className="num">{SERVICES}</th><th scope="col" className="num">{DUE}</th></tr></thead>
                      <tbody>{d.months.map((m) => (
                        <tr key={m.month}><th scope="row">{monthLabel(m.month)}</th><td className="num">{money(m.salary_paid)}</td><td className="num">{money(m.services_paid)}</td><td className="num">{money(m.outstanding)}</td></tr>
                      ))}</tbody>
                    </table>
                  )}
                >
                  <StackedBars format={short} categories={categories}
                    rows={d.months.map((m) => ({ key: m.month, label: monthLabel(m.month), tipLabel: monthLabel(m.month),
                      caption: m.reconciled ? tr('Reconciled', 'Imethibitishwa') : undefined, segments: segments(m) }))} />
                </ChartCard>
                <ChartCard
                  title={tr('Paid in each region', 'Malipo kwa kila mkoa')}
                  subtitle={`${monthLabel(d.start)} – ${monthLabel(d.end)}`}
                  table={(
                    <table>
                      <thead><tr><th scope="col">{tr('Region', 'Mkoa')}</th><th scope="col" className="num">{SALARY}</th><th scope="col" className="num">{SERVICES}</th><th scope="col" className="num">{DUE}</th><th scope="col" className="num">{tr('Budget', 'Bajeti')}</th></tr></thead>
                      <tbody>{rows.map((r) => (
                        <tr key={r.region}><th scope="row">{r.region}</th><td className="num">{money(r.total.salary_paid)}</td><td className="num">{money(r.total.services_paid)}</td><td className="num">{money(r.total.outstanding)}</td><td className="num">{money(r.total.budget_allocated)}</td></tr>
                      ))}</tbody>
                    </table>
                  )}
                >
                  {rows.length ? (
                    <StackedBars format={short} categories={categories}
                      rows={rows.map((r) => ({ key: r.region, label: r.region, tipLabel: r.region,
                        caption: n(r.total.budget_allocated) ? `${tr('Budget', 'Bajeti')} ${money(r.total.budget_allocated)}` : undefined,
                        segments: segments(r.total) }))} />
                  ) : <Empty>{tr('Nothing approved, paid or budgeted in these months.', 'Hakuna kilichoidhinishwa, kulipwa au kupangiwa bajeti.')}</Empty>}
                </ChartCard>
                <ChartCard
                  title={tr('Paid to each cadre', 'Malipo kwa kila kada')}
                  subtitle={`${monthLabel(d.start)} – ${monthLabel(d.end)}`}
                  table={(
                    <table>
                      <thead><tr><th scope="col">{tr('Cadre', 'Kada')}</th><th scope="col" className="num">{SALARY}</th><th scope="col" className="num">{SERVICES}</th><th scope="col" className="num">{DUE}</th></tr></thead>
                      <tbody>{d.by_cadre.map((c) => (
                        <tr key={c.cadre}><th scope="row">{c.cadre}</th><td className="num">{money(c.salary_paid)}</td><td className="num">{money(c.services_paid)}</td><td className="num">{money(c.outstanding)}</td></tr>
                      ))}</tbody>
                    </table>
                  )}
                >
                  {d.by_cadre.length ? (
                    <StackedBars format={short} categories={categories}
                      rows={d.by_cadre.map((c) => ({ key: c.cadre, label: c.cadre, tipLabel: c.cadre, segments: segments(c) }))} />
                  ) : <Empty>{tr('No salaries or Services in these months.', 'Hakuna mishahara wala Huduma katika miezi hii.')}</Empty>}
                </ChartCard>
              </div>
              <section className="card stack" aria-label={tr('Every region, month by month', 'Kila mkoa, mwezi kwa mwezi')}>
                <div className="row">
                  <h3>{tr('Every region, month by month', 'Kila mkoa, mwezi kwa mwezi')}</h3>
                  <Field label={tr('Show', 'Onyesha')}>
                    <select value={measure} onChange={(event) => setMeasure(event.target.value as Measure)}>
                      {(Object.keys(MEASURES) as Measure[]).map((key) => <option key={key} value={key}>{MEASURES[key]}</option>)}
                    </select>
                  </Field>
                </div>
                {rows.length ? (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th scope="col">{tr('Region', 'Mkoa')}</th>
                          {d.months.map((m) => <th key={m.month} scope="col" className="num nowrap">{monthLabel(m.month)}</th>)}
                          <th scope="col" className="num">{tr('Total', 'Jumla')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.region}>
                            <th scope="row">{r.region}</th>
                            {r.months.map((m) => <td key={m.month} className="num nowrap">{measureOf(m, measure) ? money(String(measureOf(m, measure))) : '—'}</td>)}
                            <td className="num nowrap"><strong>{money(String(measureOf(r.total, measure)))}</strong></td>
                          </tr>
                        ))}
                        <tr>
                          <th scope="row">{tr('All regions', 'Mikoa yote')}</th>
                          {d.months.map((m) => <td key={m.month} className="num nowrap"><strong>{money(String(measureOf(m, measure)))}</strong></td>)}
                          <td className="num nowrap"><strong>{money(String(measureOf(t, measure)))}</strong></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : <Empty>{tr('Nothing approved, paid or budgeted in these months.', 'Hakuna kilichoidhinishwa, kulipwa au kupangiwa bajeti.')}</Empty>}
              </section>
            </div>
          );
        }}
      </AsyncState>
    </div>
  );
}
