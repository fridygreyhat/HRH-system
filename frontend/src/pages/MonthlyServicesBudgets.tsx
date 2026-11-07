import React, { useState } from 'react';
import { api, qs, saveBlob } from '../api';
import { useAuth } from '../AuthContext';
import { useApi } from '../hooks';
import { Alert, AsyncState, Drawer, Field, StatusBadge } from '../components/ui';
import { dateOnly, dateTime, money, payMonth, payMonthDates, todayLocal } from '../format';

interface MonthlyBudget {
  id: number; region_id: number; month: string; currency: string;
  allocated_amount: string; deducted_amount: string; remaining_amount: string; document_name: string;
}

interface BudgetDeduction {
  id: number; amount: string; deducted_at: string; restored_at: string | null; restricted: boolean;
  claim_id: number | null; claim_status: string | null; payment_status: string | null; proof_attached: boolean; provider: string | null;
  services: { date: string; activity: string; amount: string }[];
}

function DeductionsDrawer({ budget, regionName, onClose }: { budget: MonthlyBudget; regionName: string; onClose: () => void }) {
  const rows = useApi<BudgetDeduction[]>(`/monthly-service-budgets/${budget.id}/deductions`);
  return <Drawer title={`Deductions: ${regionName}, ${budget.month}`} onClose={onClose} wide>
    <div className="stack">
      <p>{money(budget.deducted_amount, budget.currency)} deducted from {money(budget.allocated_amount, budget.currency)} approved. {money(budget.remaining_amount, budget.currency)} available.</p>
      <AsyncState data={rows.data} loading={rows.loading} error={rows.error} empty="No provider claims have been deducted from this budget.">
        {items => <div className="table-wrap"><table><thead><tr>
          <th>Provider</th><th>Services claimed</th><th>Amount</th><th>Deducted</th><th>Status</th>
        </tr></thead><tbody>{items.map(row => <tr key={row.id}>
          <td>{row.restricted ? <span className="muted">Another cadre</span> : <>{row.provider}<div className="muted small">Claim #{row.claim_id}</div></>}</td>
          <td>{row.restricted ? <span className="muted">Outside your review cadres</span> : row.services.map(line =>
            <div key={`${line.date}-${line.activity}`}>{dateOnly(line.date)}: {line.activity} ({money(line.amount, budget.currency)})</div>)}</td>
          <td>{money(row.amount, budget.currency)}</td>
          <td>{dateTime(row.deducted_at)}</td>
          <td>{row.restored_at ? <>Restored<div className="muted small">{dateTime(row.restored_at)}</div></>
            : row.restricted ? 'Deducted' : <><StatusBadge status={row.claim_status} kind="claim" bare />
              <div><StatusBadge status={row.payment_status} kind="payment" bare /></div>
              <div className="muted small">{row.proof_attached ? 'Proof attached' : 'No proof yet'}</div></>}</td>
        </tr>)}</tbody></table></div>}
      </AsyncState>
    </div>
  </Drawer>;
}

export function MonthlyServicesBudgets() {
  const { hasRole } = useAuth();
  const canUpload = hasRole('REGIONAL_FINANCE', 'SUPER_ADMIN');
  const [month, setMonth] = useState(payMonth(todayLocal()));
  const [region, setRegion] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('TZS');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewing, setViewing] = useState<MonthlyBudget | null>(null);
  const regions = useApi<{ id: number; name: string }[]>('/finance/regions');
  const budgets = useApi<MonthlyBudget[]>(`/monthly-service-budgets${qs({ month })}`);
  const regionName = (id: number) => regions.data?.find(r => r.id === id)?.name || `Region #${id}`;
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !region || !month) return;
    setBusy(true); setError(''); setNotice('');
    const form = new FormData();
    form.append('region_id', region); form.append('month', month);
    form.append('allocated_amount', amount); form.append('currency', currency); form.append('file', file);
    try {
      await api.upload('/monthly-service-budgets', form);
      setNotice('Monthly regional Services budget saved.');
      budgets.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the monthly budget.');
    } finally { setBusy(false); }
  };
  const download = async (row: MonthlyBudget) => {
    setBusy(true); setError('');
    try { saveBlob(await api.blob(`/monthly-service-budgets/${row.id}/document`, 'GET', row.document_name)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not download the document.'); }
    finally { setBusy(false); }
  };
  return <div className="stack-lg">
    <header className="page-header"><div><h1>Monthly Services budgets</h1>
      <p className="muted">Regional Finance enters the approved budget for each pay month (26th to 25th) and region. Provider Services claims reduce it. Payroll is not included.</p>
    </div></header>
    <section className="card stack">
      <p>The payable Services amount is deducted immediately when Regional Finance submits to Central Finance.
        Central Finance attaches proof of payment to confirm it was paid, which does not deduct again. Cancelling an unpaid claim restores its deduction.
        Dates worked determine the budget month, even when one claim spans multiple months.</p>
      <Field label="Budget month" hint={payMonthDates(month)}><input type="month" required value={month} onChange={e => setMonth(e.target.value)} /></Field>
    </section>
    <Alert>{error || regions.error}</Alert><Alert kind="success">{notice}</Alert>
    {canUpload && <form className="card stack" onSubmit={upload}>
      <h2>Enter or revise an approved budget</h2>
      <div className="grid-2">
        <Field label="Region"><select required value={region} onChange={e => setRegion(e.target.value)}>
          <option value="">Choose region…</option>{(regions.data || []).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></Field>
        <Field label="Approved monthly budget"><input type="number" required min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label="Currency"><input required pattern="[A-Z]{3}" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} /></Field>
        <Field label="Approval document"><input type="file" required accept=".pdf,.xlsx,.csv" onChange={e => setFile(e.target.files?.[0] || null)} /></Field>
      </div>
      <p className="muted small">Enter the approved total shown in the document; the file is retained as supporting documentation, not automatically imported. PDF, XLSX or UTF-8 CSV, maximum 2 MB.
        Saving for an existing region/month/currency replaces its total, not adds to it. The total cannot be lower than existing deductions.</p>
      <button className="btn btn-primary" disabled={busy || !month}>{busy ? 'Saving…' : 'Save approved budget'}</button>
    </form>}
    <AsyncState data={budgets.data} loading={budgets.loading} error={budgets.error} empty="No approved Services budgets have been entered for this month.">
      {rows => <div className="table-wrap"><table><thead><tr>
        <th>Region</th><th>Month</th><th>Approved budget</th><th>Deducted on submission</th><th>Available</th><th>Deductions</th><th>Document</th>
      </tr></thead><tbody>{rows.map(row => <tr key={row.id}>
        <td>{regionName(row.region_id)}</td><td>{row.month}</td>
        <td>{money(row.allocated_amount, row.currency)}</td><td>{money(row.deducted_amount, row.currency)}</td><td>{money(row.remaining_amount, row.currency)}</td>
        <td><button type="button" className="btn btn-secondary" onClick={() => setViewing(row)}>View deductions</button></td>
        <td><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => download(row)}>{row.document_name}</button></td>
      </tr>)}</tbody></table></div>}
    </AsyncState>
    {viewing && <DeductionsDrawer budget={viewing} regionName={regionName(viewing.region_id)} onClose={() => setViewing(null)} />}
  </div>;
}
