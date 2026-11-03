import React, { useState } from 'react';
import { api, qs, saveBlob } from '../api';
import { useAuth } from '../AuthContext';
import { useApi } from '../hooks';
import { Alert, AsyncState, Field } from '../components/ui';
import { money, todayLocal } from '../format';

interface MonthlyBudget {
  id: number; region_id: number; month: string; currency: string;
  allocated_amount: string; deducted_amount: string; remaining_amount: string; document_name: string;
}

export function MonthlyServicesBudgets() {
  const { hasRole } = useAuth();
  const canUpload = hasRole('REGIONAL_FINANCE', 'SUPER_ADMIN');
  const [month, setMonth] = useState(todayLocal().slice(0, 7));
  const [region, setRegion] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('TZS');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const regions = useApi<{ id: number; name: string }[]>('/finance/regions');
  const budgets = useApi<MonthlyBudget[]>(`/monthly-service-budgets${qs({ month })}`);
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
      <p className="muted">Regional Finance uploads a budget for each calendar month and region. Payroll is not included.</p>
    </div></header>
    <section className="card stack">
      <p>The payable Services amount is deducted immediately when Regional Finance submits to Central Finance.
        Recording payment does not deduct again. Cancelling an unpaid claim restores its deduction.
        Dates worked determine the budget month, even when one claim spans multiple months.</p>
      <Field label="Budget month"><input type="month" required value={month} onChange={e => setMonth(e.target.value)} /></Field>
    </section>
    <Alert>{error || regions.error}</Alert><Alert kind="success">{notice}</Alert>
    {canUpload && <form className="card stack" onSubmit={upload}>
      <h2>Upload or revise a monthly budget</h2>
      <div className="grid-2">
        <Field label="Region"><select required value={region} onChange={e => setRegion(e.target.value)}>
          <option value="">Choose region…</option>{(regions.data || []).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></Field>
        <Field label="Total monthly budget"><input type="number" required min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label="Currency"><input required pattern="[A-Z]{3}" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} /></Field>
        <Field label="Supporting budget document"><input type="file" required accept=".pdf,.xlsx,.csv" onChange={e => setFile(e.target.files?.[0] || null)} /></Field>
      </div>
      <p className="muted small">Enter the total shown in the document; the file is retained as supporting documentation, not automatically imported. PDF, XLSX or UTF-8 CSV, maximum 2 MB.
        Uploading for an existing region/month/currency replaces its total, not adds to it. The total cannot be lower than existing deductions.</p>
      <button className="btn btn-primary" disabled={busy || !month}>{busy ? 'Saving…' : 'Save monthly budget'}</button>
    </form>}
    <AsyncState data={budgets.data} loading={budgets.loading} error={budgets.error} empty="No monthly Services budgets have been uploaded.">
      {rows => <div className="table-wrap"><table><thead><tr>
        <th>Region</th><th>Month</th><th>Uploaded budget</th><th>Deducted on submission</th><th>Available</th><th>Document</th>
      </tr></thead><tbody>{rows.map(row => <tr key={row.id}>
        <td>{regions.data?.find(r => r.id === row.region_id)?.name || `Region #${row.region_id}`}</td><td>{row.month}</td>
        <td>{money(row.allocated_amount, row.currency)}</td><td>{money(row.deducted_amount, row.currency)}</td><td>{money(row.remaining_amount, row.currency)}</td>
        <td><button type="button" className="btn btn-secondary" disabled={busy} onClick={() => download(row)}>{row.document_name}</button></td>
      </tr>)}</tbody></table></div>}
    </AsyncState>
  </div>;
}
