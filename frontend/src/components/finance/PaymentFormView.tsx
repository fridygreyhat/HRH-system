import React from 'react';
import { num } from '../../format';
import './payment-form.css';

export interface PaymentFormRow {
  sn: number;
  name: string;
  cadre?: string;
  region: string;
  facility: string;
  days: number;
  subtotal: string | null;
  total: string | null;
  currency: string;
  /** Services */
  services?: string;
  /** What the person was paid for: each service with its paid days, one per line. */
  summary?: string;
  /** The same as [service, days] pairs, most days first. */
  summary_lines?: [string, number][];
  mobile?: string;
  /** Payroll */
  salary?: string | null;
  bank_name?: string;
  bank_account_number?: string;
  bank_branch?: string;
  checks?: string[];
}

export interface PaymentForm {
  kind: 'SERVICES' | 'PAYROLL';
  month: string;
  activity: string;
  venue: string;
  columns: string[];
  rows: PaymentFormRow[];
  totals: Record<string, string>;
  /** Services: routed claims Central Finance has not approved yet. They are not on the form. */
  awaiting_central_review?: { claims: number; amount: string };
}

const OTHER_ROW = "Salary is on this provider's other row";

/** Whole shillings as on the paper form, e.g. 150,000. */
export const formAmount = (value: string | null | undefined) => {
  if (value === null || value === undefined || value === '') return '';
  const amount = Number(value);
  return Number.isNaN(amount) ? value : amount.toLocaleString('en-US', { maximumFractionDigits: 2 });
};

/** Each service on its own line with its days at the right, so a long list stays easy to add up. */
export function ServicesSummary({ row }: { row: PaymentFormRow }) {
  const lines = row.summary_lines;
  if (!lines || !lines.length) return <>{row.summary || '—'}</>;
  return (
    <ul className="services-summary">
      {lines.map(([service, days]) => (
        <li key={service}><span>{service}</span><span className="num">{num(days)} {days === 1 ? 'day' : 'days'}</span></li>
      ))}
    </ul>
  );
}

function cells(form: PaymentForm, row: PaymentFormRow, sw: boolean): React.ReactNode[] {
  const missing = <span className="pf-missing">{sw ? 'Haipo' : 'Missing'}</span>;
  if (form.kind === 'SERVICES') {
    // The Services summary: one row per person, all services added together.
    return [row.sn, row.name, row.cadre || '', row.region, row.facility, num(row.days), <ServicesSummary row={row} />, formAmount(row.total), row.mobile || missing];
  }
  const salary = row.checks?.includes(OTHER_ROW) ? (sw ? 'Kwenye mstari mwingine' : 'On other row') : formAmount(row.salary) || missing;
  return [row.sn, row.name, row.cadre || '', row.region, row.facility, salary, num(row.days), formAmount(row.total),
    row.bank_name || missing, row.bank_account_number || missing];
}

/** Rows by region and facility, in the order they come (the form is sorted by region, facility and name). */
export function facilityGroups(rows: PaymentFormRow[]): { region: string; facility: string; rows: PaymentFormRow[] }[] {
  const groups = new Map<string, { region: string; facility: string; rows: PaymentFormRow[] }>();
  rows.forEach((row) => {
    const key = `${row.region}\u0000${row.facility}`;
    if (!groups.has(key)) groups.set(key, { region: row.region, facility: row.facility, rows: [] });
    groups.get(key)!.rows.push(row);
  });
  return Array.from(groups.values());
}

const sumDays = (rows: PaymentFormRow[]) => rows.reduce((total, row) => total + Number(row.days || 0), 0);
const sumAmount = (rows: PaymentFormRow[]) => rows.reduce((total, row) => total + Number(row.total || 0), 0);
const people = (count: number, sw: boolean) => (sw ? `watu ${num(count)}` : `${num(count)} ${count === 1 ? 'person' : 'people'}`);

const NUMERIC = new Set(['S/N', 'No. of days', 'No. of days filled', 'Monthly salary', 'Subtotal', 'Total amount']);

/** The EpiC / FHI360 payment form on screen, laid out as Finance prints and signs it. */
export function PaymentFormView({ form, sw }: { form: PaymentForm; sw: boolean }) {
  const totalAt = form.columns.indexOf('Total amount');
  const daysAt = form.columns.findIndex((column) => column === 'No. of days' || column === 'No. of days filled');
  const facilityAt = form.columns.indexOf('Health facility');
  const totals = Object.entries(form.totals);
  const groups = facilityGroups(form.rows);
  const several = groups.length > 1;
  // A subtotal (or the total): its label across the name to facility columns, then its days and amount.
  const sumCells = (label: string, days: number, amount: React.ReactNode) => [
    <td key="sn" />,
    <th key="label" scope="row" colSpan={facilityAt}>{label}</th>,
    ...form.columns.slice(facilityAt + 1).map((column, offset) => {
      const index = facilityAt + 1 + offset;
      return <td key={column} className={index === daysAt || index === totalAt ? 'num' : undefined}>
        {index === daysAt ? num(days) : index === totalAt ? amount : ''}</td>;
    }),
  ];
  return (
    <article className={`paper payment-form is-${form.kind.toLowerCase()}`} aria-label={sw ? 'Fomu ya malipo' : 'Payment form'}>
      <header className="pf-head">
        <strong className="pf-project">EpiC PROJECT</strong>
        <span className="pf-logos">
          <img src={`${process.env.PUBLIC_URL || ''}/brand/usa-mark.png`} alt="United States of America" />
          <img src={`${process.env.PUBLIC_URL || ''}/brand/fhi360-logo.png`} alt="FHI 360" />
        </span>
      </header>
      <h2 className="pf-title">PAYMENT FORM</h2>
      <div className="pf-activity"><span>ACTIVITY:</span><strong>{form.activity}</strong></div>
      <p className="pf-venue">Venue: {form.venue || '—'}</p>
      {several && (
        <div className="table-wrap">
          <table className="pf-table pf-summary" aria-label={sw ? 'Muhtasari kwa kituo' : 'Summary by health facility'}>
            <caption>{sw ? 'Muhtasari kwa kituo cha afya' : 'Summary by health facility'}</caption>
            <thead><tr>{(sw ? ['Mkoa', 'Kituo', 'Watu', 'Siku', 'Jumla'] : ['Region', 'Health facility', 'People', 'Days', 'Total amount'])
              .map((title) => <th key={title} scope="col">{title}</th>)}</tr></thead>
            <tbody>
              {groups.map((group) => (
                <tr key={`${group.region}-${group.facility}`}>
                  <td>{group.region}</td><td>{group.facility}</td><td className="num">{num(group.rows.length)}</td>
                  <td className="num">{num(sumDays(group.rows))}</td><td className="num">{formAmount(String(sumAmount(group.rows)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="table-wrap">
        <table className="pf-table">
          <thead>
            <tr>{form.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
          </thead>
          {groups.map((group) => (
            <tbody key={`${group.region}-${group.facility}`}>
              {group.rows.map((row) => (
                <tr key={`${row.sn}-${row.name}`}>
                  {cells(form, row, sw).map((value, index) => (
                    <td key={form.columns[index]} className={NUMERIC.has(form.columns[index]) ? 'num' : undefined}>{value}</td>
                  ))}
                </tr>
              ))}
              {several && (
                <tr className="pf-subtotal">
                  {sumCells(`${sw ? 'Jumla ndogo' : 'Subtotal'}: ${group.facility || '—'}, ${group.region} (${people(group.rows.length, sw)})`,
                    sumDays(group.rows), formAmount(String(sumAmount(group.rows))))}
                </tr>
              )}
            </tbody>
          ))}
          <tfoot>
            <tr>
              {sumCells(`TOTAL (${people(form.rows.length, sw)})`, sumDays(form.rows),
                totals.length === 1 ? formAmount(totals[0][1]) : totals.map(([currency, total]) => `${currency} ${formAmount(total)}`).join('; ') || '0')}
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="pf-note">
        {form.kind === 'SERVICES'
          ? (sw ? 'Kuidhinishwa si malipo. Jumla ni huduma zote za mtu kwa kipindi hiki.' : "Approved does not mean paid. Total amount is all of the person's services for the period.")
          : (sw ? 'Kuidhinishwa si malipo. Jumla ni mshahara wa mwezi.' : 'Approved does not mean paid. Total amount is the monthly salary.')}
      </p>
    </article>
  );
}
