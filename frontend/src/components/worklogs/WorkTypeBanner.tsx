import React from 'react';
import { money, num, workHours } from '../../format';
import { WorkLogDetail } from '../../types';
import { Icon } from '../Icon';
import './work-type-banner.css';

interface Props {
  log: WorkLogDetail;
  sw: boolean;
  /** Regional Finance checks the timesheet first and sees the money only at the payment step. */
  showAmount?: boolean;
}

/** Days per service, from the entries: the main service of each day and any additional services. */
export function servicesDelivered(log: WorkLogDetail): { name: string; days: number }[] {
  const days = new Map<string, Set<string>>();
  const add = (name: string | null | undefined, date: string) => {
    if (!name) return;
    if (!days.has(name)) days.set(name, new Set());
    days.get(name)!.add(date);
  };
  log.entries.forEach((entry) => {
    const snapshot = (entry.activity_snapshot || {}) as { label_en?: string; label_sw?: string; additional_services?: { activity: { label_en: string } }[] };
    add(snapshot.label_en || entry.activity_key, entry.entry_date);
    (snapshot.additional_services || []).forEach((extra) => add(extra.activity?.label_en, entry.entry_date));
  });
  return Array.from(days.entries()).map(([name, dates]) => ({ name, days: dates.size })).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name));
}

/**
 * Payroll and Services timesheets are approved on the same screen, so each says plainly what it is, who pays it and
 * what it is worth: a salary paid by the CSO, or service days paid by FHI360 Central Finance.
 */
export function WorkTypeBanner({ log, sw, showAmount = true }: Props) {
  const payroll = log.work_type === 'PAYROLL';
  if (!payroll && log.work_type !== 'SERVICES') return null;
  const tr = (en: string, swText: string) => (sw ? swText : en);
  const facts: [string, React.ReactNode][] = [
    [tr('Days worked', 'Siku za kazi'), num(log.totals?.days ?? 0)],
    [tr('Hours', 'Masaa'), workHours(log.totals?.hours ?? 0)],
  ];
  if (payroll) {
    const pay = log.payroll_pay;
    facts.push([tr('Salary scale', 'Ngazi ya mshahara'), pay?.salary_scale || log.staff.salary_scale || <span className="wtb-missing">{tr('Not set', 'Haijawekwa')}</span>]);
    // Only Finance is sent the amount; reviewers approve the days worked, not the pay.
    if (pay?.amount_visible) {
      facts.push([tr('Monthly salary', 'Mshahara wa mwezi'), pay.monthly_salary ? money(pay.monthly_salary, pay.currency || 'TZS') : <span className="wtb-missing">{tr('Not set', 'Haijawekwa')}</span>]);
    }
  } else if (showAmount) {
    const claim = log.claims.find((row) => row.status !== 'CANCELLED');
    const amount = claim?.amount ?? log.financial_preview?.total;
    const currency = claim?.currency ?? log.financial_preview?.currency ?? 'TZS';
    facts.push([tr('Amount', 'Kiasi'), amount != null && amount !== '' ? money(amount, currency || 'TZS') : '—']);
  }
  const services = payroll ? [] : servicesDelivered(log);
  return (
    <section className={`wtb wtb-${payroll ? 'payroll' : 'services'}`} aria-label={payroll ? tr('Payroll timesheet', 'Jedwali la mshahara') : tr('Services timesheet', 'Jedwali la huduma')}>
      <div className="wtb-head">
        <span className="wtb-icon" aria-hidden="true"><Icon name={payroll ? 'wallet' : 'clipboard'} size={20} /></span>
        <div>
          <strong className="wtb-title">{payroll ? tr('PAYROLL TIMESHEET', 'JEDWALI LA MSHAHARA') : tr('SERVICES TIMESHEET', 'JEDWALI LA HUDUMA')}</strong>
          <p className="wtb-who">{payroll
            ? tr('Monthly salary, paid by the CSO to the bank once Regional Finance signs the Payroll report.',
              'Mshahara wa mwezi, hulipwa na CSO benki baada ya Fedha ya Mkoa kusaini ripoti ya Mshahara.')
            : tr('Paid per service day by FHI360 Central Finance to the mobile wallet.',
              'Hulipwa kwa kila siku ya huduma na Fedha Kuu FHI360 kwenye pochi ya simu.')}</p>
        </div>
      </div>
      <dl className="wtb-facts">
        {facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
      {services.length > 0 && (
        <div className="wtb-services">
          <span className="wtb-label">{tr('Services delivered', 'Huduma zilizotolewa')}</span>
          <ul>{services.map((row) => <li key={row.name}>{row.name} <span>· {sw ? `siku ${num(row.days)}` : `${num(row.days)} ${row.days === 1 ? 'day' : 'days'}`}</span></li>)}</ul>
        </div>
      )}
    </section>
  );
}
