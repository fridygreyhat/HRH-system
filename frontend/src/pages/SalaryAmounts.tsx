import React, { useState } from 'react';
import { api, qs } from '../api';
import { Alert, AsyncState, Empty, Field, Section } from '../components/ui';
import { money, num, payMonth, todayLocal } from '../format';
import { useAction, useApi } from '../hooks';

interface ScaleAmount {
  scale: string;
  providers: number;
  monthly_amount: string | null;
  history: { start_month: string; monthly_amount: string }[];
}

export function SalaryAmounts() {
  const thisMonth = payMonth(todayLocal());
  const scales = useApi<ScaleAmount[]>(`/salary-amounts${qs({ month: thisMonth })}`);
  const [scale, setScale] = useState('');
  const [startMonth, setStartMonth] = useState(thisMonth);
  const [amount, setAmount] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const save = useAction();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setNotice(null);
    const name = scale.trim();
    const saved = await save.run(() => api.put('/salary-amounts', { scale: name, start_month: startMonth, monthly_amount: amount }));
    if (saved !== undefined) {
      setNotice(`Saved ${name} from ${startMonth}.`);
      setScale('');
      setAmount('');
      scales.reload();
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Salary amounts</h1>
          <p className="muted">Set the full monthly salary for each salary scale. CSOs see it in their salary timesheet files.</p>
        </div>
      </div>
      <Alert kind="success">{notice}</Alert>
      <Section title="Set an amount">
        <p className="muted small">An amount applies from its start month until a later one replaces it. Saving the same scale and month again corrects that amount. Every change is recorded in the audit trail.</p>
        <form className="stack" onSubmit={submit}>
          <div className="grid-3">
            <Field label="Salary scale" hint="Type it exactly as it appears on staff records.">
              <input list="salary-scale-options" value={scale} onChange={(event) => setScale(event.target.value)} maxLength={50} required />
              <datalist id="salary-scale-options">
                {(scales.data || []).map((row) => <option key={row.scale} value={row.scale} />)}
              </datalist>
            </Field>
            <Field label="Applies from">
              <input type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} required />
            </Field>
            <Field label="Monthly salary (TZS)">
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
            </Field>
          </div>
          <Alert>{save.error}</Alert>
          <div><button type="submit" className="btn btn-primary" disabled={save.busy}>{save.busy ? 'Saving…' : 'Save amount'}</button></div>
        </form>
      </Section>
      <Section title="Salary scales">
        <AsyncState data={scales.data} error={scales.error} loading={scales.loading}>
          {(rows) => rows.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Salary scale</th>
                    <th scope="col" className="num">Active providers</th>
                    <th scope="col" className="num">Monthly salary now</th>
                    <th scope="col">History</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.scale}>
                      <td>{row.scale}</td>
                      <td className="num">{num(row.providers)}</td>
                      <td className="num nowrap">{row.monthly_amount ? money(row.monthly_amount) : <span className="badge badge-warn">No amount</span>}</td>
                      <td className="small">{row.history.map((item) => `${item.start_month}: ${money(item.monthly_amount)}`).join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No salary scales yet. Type a scale above to set its amount. Scales on staff records also appear here.</Empty>}
        </AsyncState>
      </Section>
    </div>
  );
}
