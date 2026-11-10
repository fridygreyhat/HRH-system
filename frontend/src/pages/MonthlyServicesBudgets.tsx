import React, { useState } from 'react';
import { api, qs, saveBlob } from '../api';
import { useAuth } from '../AuthContext';
import { useApi } from '../hooks';
import { Alert, AsyncState, Drawer, Field, KpiStrip, PersonCell, StatusBadge } from '../components/ui';
import { dateOnly, dateTime, money, num, payMonth, payMonthDates, todayLocal } from '../format';
import './polish-finance.css';

interface MonthlyBudget {
  id: number; region_id: number; month: string; currency: string;
  allocated_amount: string; deducted_amount: string; remaining_amount: string; document_name: string;
}

interface BudgetDeduction {
  id: number; amount: string; deducted_at: string; restored_at: string | null; restricted: boolean;
  claim_id: number | null; claim_status: string | null; payment_status: string | null; proof_attached: boolean; provider: string | null;
  services: { date: string; activity: string; amount: string }[];
}

/** Totals per currency, e.g. "TZS 100,000". */
const totalOf = (rows: MonthlyBudget[], pick: (row: MonthlyBudget) => string) => {
  const totals = new Map<string, number>();
  rows.forEach((row) => totals.set(row.currency, (totals.get(row.currency) || 0) + Number(pick(row))));
  return Array.from(totals, ([currency, total]) => money(total, currency)).join(' + ') || '—';
};

function DeductionsDrawer({ budget, regionName, onClose, sw }: { budget: MonthlyBudget; regionName: string; onClose: () => void; sw: boolean }) {
  const rows = useApi<BudgetDeduction[]>(`/monthly-service-budgets/${budget.id}/deductions`);
  return <Drawer title={`${sw ? 'Makato' : 'Deductions'}: ${regionName}, ${budget.month}`} onClose={onClose} wide>
    <div className="stack">
      <KpiStrip items={[
        { label: sw ? 'Bajeti iliyoidhinishwa' : 'Approved budget', value: money(budget.allocated_amount, budget.currency), icon: 'wallet' },
        { label: sw ? 'Imekatwa' : 'Deducted', value: money(budget.deducted_amount, budget.currency), icon: 'receipt', tone: 'warn' },
        { label: sw ? 'Inapatikana' : 'Available', value: money(budget.remaining_amount, budget.currency), icon: 'check', tone: 'success' },
      ]} />
      <AsyncState data={rows.data} loading={rows.loading} error={rows.error} empty={sw ? 'Hakuna dai la mtoa huduma lililokatwa kutoka bajeti hii.' : 'No provider claims have been deducted from this budget.'}>
        {items => <div className="table-wrap"><table><thead><tr>
          <th>{sw ? 'Mtoa huduma' : 'Provider'}</th><th>{sw ? 'Huduma zilizodaiwa' : 'Services claimed'}</th><th className="num">{sw ? 'Kiasi' : 'Amount'}</th><th>{sw ? 'Imekatwa' : 'Deducted'}</th><th>{sw ? 'Hali' : 'Status'}</th>
        </tr></thead><tbody>{items.map(row => <tr key={row.id}>
          <td>{row.restricted ? <span className="muted">{sw ? 'Kada nyingine' : 'Another cadre'}</span> : <PersonCell name={row.provider} sub={`${sw ? 'Dai' : 'Claim'} #${row.claim_id}`} />}</td>
          <td className="fin-wrap">{row.restricted ? <span className="muted">{sw ? 'Nje ya kada unazokagua' : 'Outside your review cadres'}</span> : row.services.map(line =>
            <div key={`${line.date}-${line.activity}`} className="small"><span className="nowrap">{dateOnly(line.date)}</span>: {line.activity} ({money(line.amount, budget.currency)})</div>)}</td>
          <td className="num nowrap">{money(row.amount, budget.currency)}</td>
          <td className="nowrap small">{dateTime(row.deducted_at)}</td>
          <td>{row.restored_at ? <><span className="cell-main">{sw ? 'Imerudishwa' : 'Restored'}</span><span className="cell-sub">{dateTime(row.restored_at)}</span></>
            : row.restricted ? (sw ? 'Imekatwa' : 'Deducted') : <span className="fin-stack"><StatusBadge status={row.claim_status} kind="claim" bare />
              <StatusBadge status={row.payment_status} kind="payment" bare />
              <span className="cell-sub">{row.proof_attached ? (sw ? 'Uthibitisho umeambatishwa' : 'Proof attached') : (sw ? 'Bado hakuna uthibitisho' : 'No proof yet')}</span></span>}</td>
        </tr>)}</tbody></table></div>}
      </AsyncState>
    </div>
  </Drawer>;
}

export function MonthlyServicesBudgets() {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
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
  const regionName = (id: number) => regions.data?.find(r => r.id === id)?.name || `${sw ? 'Mkoa' : 'Region'} #${id}`;
  const upload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !region || !month) return;
    setBusy(true); setError(''); setNotice('');
    const form = new FormData();
    form.append('region_id', region); form.append('month', month);
    form.append('allocated_amount', amount); form.append('currency', currency); form.append('file', file);
    try {
      await api.upload('/monthly-service-budgets', form);
      setNotice(sw ? 'Bajeti ya mwezi ya Huduma ya mkoa imehifadhiwa.' : 'Monthly regional Services budget saved.');
      budgets.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : (sw ? 'Imeshindikana kuhifadhi bajeti ya mwezi.' : 'Could not save the monthly budget.'));
    } finally { setBusy(false); }
  };
  const download = async (row: MonthlyBudget) => {
    setBusy(true); setError('');
    try { saveBlob(await api.blob(`/monthly-service-budgets/${row.id}/document`, 'GET', row.document_name)); }
    catch (err) { setError(err instanceof Error ? err.message : (sw ? 'Imeshindikana kupakua hati.' : 'Could not download the document.')); }
    finally { setBusy(false); }
  };
  const rows = budgets.data || [];
  return <div className="stack-lg">
    <header className="page-header fin-title-only"><h1>{sw ? 'Bajeti za mwezi za Huduma' : 'Monthly Services budgets'}</h1></header>
    {rows.length > 0 && <KpiStrip label={sw ? 'Muhtasari wa bajeti' : 'Budgets at a glance'} items={[
      { label: sw ? 'Bajeti iliyoidhinishwa' : 'Approved budget', value: totalOf(rows, row => row.allocated_amount), icon: 'wallet', note: sw ? `Mikoa ${num(rows.length)}` : `${num(rows.length)} ${rows.length === 1 ? 'region' : 'regions'}` },
      { label: sw ? 'Imekatwa wakati wa kutuma' : 'Deducted on submission', value: totalOf(rows, row => row.deducted_amount), icon: 'receipt', tone: 'warn' },
      { label: sw ? 'Inapatikana' : 'Available', value: totalOf(rows, row => row.remaining_amount), icon: 'check', tone: 'success' },
    ]} />}
    <div className="fin-toolbar">
      <div className="filters">
        <Field label={sw ? 'Mwezi wa bajeti' : 'Budget month'} hint={payMonthDates(month)}><input type="month" required value={month} onChange={e => setMonth(e.target.value)} /></Field>
      </div>
      <p className="fin-footnote">{sw ? 'Madai ya Huduma hukatwa Fedha ya Mkoa inapoyatuma.' : 'Services claims are deducted when Regional Finance submits them.'}</p>
    </div>
    <Alert>{error || regions.error}</Alert><Alert kind="success">{notice}</Alert>
    <AsyncState data={budgets.data} loading={budgets.loading} error={budgets.error} empty={sw ? 'Hakuna bajeti ya Huduma iliyoidhinishwa kwa mwezi huu bado.' : 'No approved Services budgets have been entered for this month.'}>
      {items => <div className="table-wrap"><table><thead><tr>
        <th>{sw ? 'Mkoa' : 'Region'}</th><th className="num">{sw ? 'Bajeti iliyoidhinishwa' : 'Approved budget'}</th><th className="num">{sw ? 'Imekatwa wakati wa kutuma' : 'Deducted on submission'}</th><th className="num">{sw ? 'Inapatikana' : 'Available'}</th><th>{sw ? 'Makato' : 'Deductions'}</th><th>{sw ? 'Hati' : 'Document'}</th>
      </tr></thead><tbody>{items.map(row => <tr key={row.id}>
        <td><span className="cell-main">{regionName(row.region_id)}</span><span className="cell-sub">{row.month}</span></td>
        <td className="num nowrap">{money(row.allocated_amount, row.currency)}</td><td className="num nowrap">{money(row.deducted_amount, row.currency)}</td><td className="num nowrap"><strong>{money(row.remaining_amount, row.currency)}</strong></td>
        <td><button type="button" className="btn btn-secondary btn-sm" onClick={() => setViewing(row)}>{sw ? 'Angalia makato' : 'View deductions'}</button></td>
        <td><button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => download(row)}>{row.document_name}</button></td>
      </tr>)}</tbody></table></div>}
    </AsyncState>
    {canUpload && <form className="card stack" onSubmit={upload}>
      <div className="fin-section-head">
        <h3>{sw ? 'Weka au rekebisha bajeti iliyoidhinishwa' : 'Enter or revise an approved budget'}</h3>
        <span className="muted">{sw ? 'PDF, XLSX au CSV ya UTF-8, hadi MB 2. Kuhifadhi kunabadilisha jumla iliyopo.' : 'PDF, XLSX or UTF-8 CSV, maximum 2 MB. Saving replaces an existing total.'}</span>
      </div>
      <div className="grid-2">
        <Field label={sw ? 'Mkoa' : 'Region'}><select required value={region} onChange={e => setRegion(e.target.value)}>
          <option value="">{sw ? 'Chagua mkoa…' : 'Choose region…'}</option>{(regions.data || []).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select></Field>
        <Field label={sw ? 'Bajeti ya mwezi iliyoidhinishwa' : 'Approved monthly budget'}><input type="number" required min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></Field>
        <Field label={sw ? 'Sarafu' : 'Currency'}><input required pattern="[A-Z]{3}" maxLength={3} value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} /></Field>
        <Field label={sw ? 'Hati ya idhini' : 'Approval document'}><input type="file" required accept=".pdf,.xlsx,.csv" onChange={e => setFile(e.target.files?.[0] || null)} /></Field>
      </div>
      <div><button className="btn btn-primary" disabled={busy || !month}>{busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Hifadhi bajeti iliyoidhinishwa' : 'Save approved budget')}</button></div>
    </form>}
    {viewing && <DeductionsDrawer budget={viewing} regionName={regionName(viewing.region_id)} onClose={() => setViewing(null)} sw={sw} />}
  </div>;
}
