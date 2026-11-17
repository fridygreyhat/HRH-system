import React from 'react';
import { qs } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateOnly, money, num } from '../../format';
import { useApi } from '../../hooks';
import { ChartCard, StackedBars } from '../charts';
import { Alert, AsyncState, Empty, KpiStrip } from '../ui';

interface Money {
  expected: string;
  paid: string;
  outstanding: string;
  overpaid: string;
  in_review: string;
}
interface Budget {
  allocated: string;
  used: string;
  remaining: string;
}
interface Group {
  key: string;
  label: string;
  payroll_expected: string;
  payroll_paid: string;
  services_expected: string;
  services_paid: string;
  outstanding: string;
  issues: number;
  budget_allocated?: string;
  budget_used?: string;
}
export interface AuditDashboardData {
  month: string;
  months: { month: string; payroll: Money; services: Money; budget: Budget; issues: number; reconciled: boolean }[];
  totals: { payroll: Money; services: Money; budget: Budget; issues: number; providers: number };
  by_region: Group[];
  by_cadre: Group[];
  by_funding: { source: string; expected: string; paid: string; in_review: string }[];
  signoff: { signed_by_name: string | null; signed_at: string; current: boolean } | null;
}

const n = (value: string | undefined | null) => Number(value || 0);
const short = (value: number) => money(String(value));

/** Months as "Oct 2026". */
export function monthLabel(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(year, number - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}

function MoneyTable({ rows, columns }: { rows: { key: string; label: string; values: number[] }[]; columns: string[] }) {
  return (
    <table>
      <thead>
        <tr>
          <th scope="col"> </th>
          {columns.map((column) => <th key={column} scope="col" className="num">{column}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <th scope="row">{row.label}</th>
            {row.values.map((value, index) => <td key={columns[index]} className="num">{short(value)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Salary, Services and budget at a glance for auditors: the month by region, cadre and funding source, and the trend. */
export function AuditDashboard({ month, regionId }: { month: string; regionId: string }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const tr = (en: string, swText: string) => (sw ? swText : en);
  const data = useApi<AuditDashboardData>(month ? `/finance/reconciliation/dashboard${qs({ month, months: 6, region_id: regionId })}` : null);
  const PAID = tr('Paid', 'Imelipwa');
  const DUE = tr('Still to pay', 'Bado kulipwa');
  const REVIEW = tr('In review', 'Bado kukaguliwa');
  const USED = tr('Used', 'Imetumika');
  const LEFT = tr('Remaining', 'Imebaki');

  return (
    <AsyncState data={data.data} error={data.error} loading={data.loading}>
      {(d) => {
        const salary = d.totals.payroll;
        const services = d.totals.services;
        const budget = d.totals.budget;
        const used = n(budget.allocated) ? Math.round((n(budget.used) / n(budget.allocated)) * 100) : 0;
        return (
          <div className="stack-lg">
            <KpiStrip
              label={tr('Salary, Services and budget this month', 'Mshahara, Huduma na bajeti mwezi huu')}
              items={[
                { label: tr('Salaries signed', 'Mishahara iliyosainiwa'), value: money(salary.expected), icon: 'wallet',
                  note: `${PAID} ${money(salary.paid)}` },
                { label: tr('Salaries still to pay', 'Mishahara bado kulipwa'), value: money(salary.outstanding), icon: 'clock',
                  tone: n(salary.outstanding) ? 'warn' : 'success' },
                { label: tr('Services approved', 'Huduma zilizoidhinishwa'), value: money(services.expected), icon: 'receipt',
                  note: `${PAID} ${money(services.paid)}` },
                { label: tr('Services still to pay', 'Huduma bado kulipwa'), value: money(services.outstanding), icon: 'clock',
                  tone: n(services.outstanding) ? 'warn' : 'success',
                  note: n(services.in_review) ? `${REVIEW} ${money(services.in_review)}` : undefined },
                { label: tr('Services budget used', 'Bajeti ya Huduma iliyotumika'), value: n(budget.allocated) ? `${used}%` : '—', icon: 'pie',
                  tone: used > 90 ? 'danger' : used > 75 ? 'warn' : 'info',
                  note: n(budget.allocated) ? `${money(budget.used)} / ${money(budget.allocated)}` : tr('No budget set', 'Hakuna bajeti') },
                { label: tr('Issues to follow up', 'Masuala ya kufuatilia'), value: num(d.totals.issues), icon: 'alert',
                  tone: d.totals.issues ? 'warn' : 'success' },
              ]}
            />
            {d.signoff ? (
              <Alert kind={d.signoff.current ? 'success' : 'warn'}>
                {tr(`Reconciled by ${d.signoff.signed_by_name} on ${dateOnly(d.signoff.signed_at)}`,
                  `Imethibitishwa na ${d.signoff.signed_by_name} tarehe ${dateOnly(d.signoff.signed_at)}`)}
                {!d.signoff.current && tr('; the figures have changed since.', '; takwimu zimebadilika tangu hapo.')}
              </Alert>
            ) : <p className="muted small">{tr('This month is not reconciled yet. See the Reconciliation tab.', 'Mwezi huu bado haujathibitishwa. Angalia kichupo cha Ulinganisho.')}</p>}

            <div className="grid-charts">
              <ChartCard
                title={tr('Salaries by month', 'Mishahara kwa mwezi')}
                subtitle={tr('Signed salary: paid and still to pay', 'Mshahara uliosainiwa: uliolipwa na unaosubiri')}
                table={<MoneyTable columns={[PAID, DUE]} rows={d.months.map((m) => ({ key: m.month, label: monthLabel(m.month), values: [n(m.payroll.paid), n(m.payroll.outstanding)] }))} />}
              >
                <StackedBars
                  format={short}
                  categories={[{ key: 'paid', label: PAID }, { key: 'due', label: DUE }]}
                  rows={d.months.map((m) => ({
                    key: m.month, label: monthLabel(m.month), tipLabel: monthLabel(m.month),
                    caption: m.reconciled ? tr('Reconciled', 'Imethibitishwa') : undefined,
                    segments: [{ key: 'paid', label: PAID, value: n(m.payroll.paid) }, { key: 'due', label: DUE, value: n(m.payroll.outstanding) }],
                  }))}
                />
              </ChartCard>
              <ChartCard
                title={tr('Services by month', 'Huduma kwa mwezi')}
                subtitle={tr('Approved claims: paid, still to pay, and still in review', 'Madai: yaliyolipwa, yanayosubiri, na yanayokaguliwa')}
                table={<MoneyTable columns={[PAID, DUE, REVIEW]} rows={d.months.map((m) => ({ key: m.month, label: monthLabel(m.month), values: [n(m.services.paid), n(m.services.outstanding), n(m.services.in_review)] }))} />}
              >
                <StackedBars
                  format={short}
                  categories={[{ key: 'paid', label: PAID }, { key: 'due', label: DUE }, { key: 'review', label: REVIEW }]}
                  rows={d.months.map((m) => ({
                    key: m.month, label: monthLabel(m.month), tipLabel: monthLabel(m.month),
                    segments: [{ key: 'paid', label: PAID, value: n(m.services.paid) }, { key: 'due', label: DUE, value: n(m.services.outstanding) },
                      { key: 'review', label: REVIEW, value: n(m.services.in_review) }],
                  }))}
                />
              </ChartCard>
              <ChartCard
                title={tr('Services budget by month', 'Bajeti ya Huduma kwa mwezi')}
                subtitle={tr('Monthly regional budget: used and remaining', 'Bajeti ya mkoa kwa mwezi: iliyotumika na iliyobaki')}
                table={<MoneyTable columns={[USED, LEFT]} rows={d.months.map((m) => ({ key: m.month, label: monthLabel(m.month), values: [n(m.budget.used), n(m.budget.remaining)] }))} />}
              >
                {d.months.some((m) => n(m.budget.allocated)) ? (
                  <StackedBars
                    format={short}
                    categories={[{ key: 'used', label: USED }, { key: 'left', label: LEFT }]}
                    rows={d.months.map((m) => ({
                      key: m.month, label: monthLabel(m.month), tipLabel: monthLabel(m.month),
                      segments: [{ key: 'used', label: USED, value: n(m.budget.used) }, { key: 'left', label: LEFT, value: n(m.budget.remaining) }],
                    }))}
                  />
                ) : <Empty>{tr('No monthly Services budget is set for these months.', 'Hakuna bajeti ya Huduma kwa miezi hii.')}</Empty>}
              </ChartCard>
              <ChartCard
                title={tr('By region this month', 'Kwa mkoa mwezi huu')}
                subtitle={tr('Salaries and Services paid, and what is still to pay', 'Mishahara na Huduma zilizolipwa, na zinazosubiri')}
                table={<MoneyTable columns={[tr('Salaries paid', 'Mishahara'), tr('Services paid', 'Huduma'), DUE, tr('Budget', 'Bajeti')]}
                  rows={d.by_region.map((g) => ({ key: g.key, label: g.label, values: [n(g.payroll_paid), n(g.services_paid), n(g.outstanding), n(g.budget_allocated)] }))} />}
              >
                <StackedBars
                  format={short}
                  categories={[{ key: 'salary', label: tr('Salaries paid', 'Mishahara iliyolipwa') }, { key: 'services', label: tr('Services paid', 'Huduma zilizolipwa') }, { key: 'due', label: DUE }]}
                  rows={d.by_region.map((g) => ({
                    key: g.key, label: g.label, tipLabel: g.label,
                    caption: n(g.budget_allocated) ? `${tr('Budget', 'Bajeti')} ${money(g.budget_allocated)}` : undefined,
                    segments: [{ key: 'salary', label: tr('Salaries paid', 'Mishahara'), value: n(g.payroll_paid) },
                      { key: 'services', label: tr('Services paid', 'Huduma'), value: n(g.services_paid) }, { key: 'due', label: DUE, value: n(g.outstanding) }],
                  }))}
                />
              </ChartCard>
              <ChartCard
                title={tr('By cadre this month', 'Kwa kada mwezi huu')}
                subtitle={tr('CHW, Data Clerk and HCP', 'CHW, Karani wa takwimu na HCP')}
                table={<MoneyTable columns={[tr('Salaries signed', 'Mishahara'), tr('Services approved', 'Huduma'), PAID, DUE]}
                  rows={d.by_cadre.map((g) => ({ key: g.key, label: g.label, values: [n(g.payroll_expected), n(g.services_expected), n(g.payroll_paid) + n(g.services_paid), n(g.outstanding)] }))} />}
              >
                {d.by_cadre.length ? (
                  <StackedBars
                    format={short}
                    categories={[{ key: 'salary', label: tr('Salaries paid', 'Mishahara iliyolipwa') }, { key: 'services', label: tr('Services paid', 'Huduma zilizolipwa') }, { key: 'due', label: DUE }]}
                    rows={d.by_cadre.map((g) => ({
                      key: g.key, label: g.label, tipLabel: g.label,
                      caption: g.issues ? `${num(g.issues)} ${tr('issues', 'masuala')}` : undefined,
                      segments: [{ key: 'salary', label: tr('Salaries paid', 'Mishahara'), value: n(g.payroll_paid) },
                        { key: 'services', label: tr('Services paid', 'Huduma'), value: n(g.services_paid) }, { key: 'due', label: DUE, value: n(g.outstanding) }],
                    }))}
                  />
                ) : <Empty>{tr('Nothing approved or paid this month.', 'Hakuna kilichoidhinishwa au kulipwa mwezi huu.')}</Empty>}
              </ChartCard>
              <ChartCard
                title={tr('Services by funding source', 'Huduma kwa chanzo cha fedha')}
                subtitle={tr('PnP, Supply Chain, EpiC, AFGHS and others', 'PnP, Supply Chain, EpiC, AFGHS na vingine')}
                table={<MoneyTable columns={[PAID, DUE, REVIEW]} rows={d.by_funding.map((f) => ({ key: f.source, label: f.source, values: [n(f.paid), Math.max(n(f.expected) - n(f.paid), 0), n(f.in_review)] }))} />}
              >
                {d.by_funding.length ? (
                  <StackedBars
                    format={short}
                    categories={[{ key: 'paid', label: PAID }, { key: 'due', label: DUE }, { key: 'review', label: REVIEW }]}
                    rows={d.by_funding.map((f) => ({
                      key: f.source, label: f.source, tipLabel: f.source,
                      segments: [{ key: 'paid', label: PAID, value: n(f.paid) }, { key: 'due', label: DUE, value: Math.max(n(f.expected) - n(f.paid), 0) },
                        { key: 'review', label: REVIEW, value: n(f.in_review) }],
                    }))}
                  />
                ) : <Empty>{tr('No Services claims this month.', 'Hakuna madai ya Huduma mwezi huu.')}</Empty>}
              </ChartCard>
            </div>
          </div>
        );
      }}
    </AsyncState>
  );
}
