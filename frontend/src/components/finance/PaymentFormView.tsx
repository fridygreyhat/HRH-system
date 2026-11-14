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

function cells(form: PaymentForm, row: PaymentFormRow, sw: boolean): React.ReactNode[] {
  const missing = <span className="pf-missing">{sw ? 'Haipo' : 'Missing'}</span>;
  if (form.kind === 'SERVICES') {
    // The Services summary: one row per person, all services added together.
    return [row.sn, row.name, row.cadre || '', row.region, row.facility, num(row.days), formAmount(row.total), row.mobile || missing];
  }
  const salary = row.checks?.includes(OTHER_ROW) ? (sw ? 'Kwenye mstari mwingine' : 'On other row') : formAmount(row.salary) || missing;
  return [row.sn, row.name, row.cadre || '', row.region, row.facility, salary, num(row.days), formAmount(row.total),
    row.bank_name || missing, row.bank_account_number || missing];
}

const NUMERIC = new Set(['S/N', 'No. of days', 'No. of days filled', 'Monthly salary', 'Subtotal', 'Total amount']);

/** The EpiC / FHI360 payment form on screen, laid out as Finance prints and signs it. */
export function PaymentFormView({ form, sw }: { form: PaymentForm; sw: boolean }) {
  const totalAt = form.columns.indexOf('Total amount');
  const totals = Object.entries(form.totals);
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
      <div className="table-wrap">
        <table className="pf-table">
          <thead>
            <tr>{form.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
          </thead>
          <tbody>
            {form.rows.map((row) => (
              <tr key={`${row.sn}-${row.name}`}>
                {cells(form, row, sw).map((value, index) => (
                  <td key={form.columns[index]} className={NUMERIC.has(form.columns[index]) ? 'num' : undefined}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {form.columns.map((column, index) => (
                <td key={column} className={index === totalAt ? 'num' : undefined}>
                  {index === 1 ? 'TOTAL' : index === totalAt
                    ? (totals.length === 1 ? formAmount(totals[0][1]) : totals.map(([currency, total]) => `${currency} ${formAmount(total)}`).join('; ') || '0')
                    : ''}
                </td>
              ))}
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
