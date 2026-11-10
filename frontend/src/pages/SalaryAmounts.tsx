import React, { useState } from 'react';
import { api, qs } from '../api';
import { Alert, AsyncState, Empty, Field, Section, pageLang } from '../components/ui';
import { money, num, payMonth, todayLocal } from '../format';
import { useAction, useApi } from '../hooks';

interface ScaleAmount {
  scale: string;
  providers: number;
  monthly_amount: string | null;
  history: { start_month: string; monthly_amount: string }[];
}

export function SalaryAmounts() {
  const sw = pageLang() === 'sw';
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
      setNotice(sw ? `${name} imehifadhiwa kuanzia ${startMonth}.` : `Saved ${name} from ${startMonth}.`);
      setScale('');
      setAmount('');
      scales.reload();
    }
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>{sw ? 'Viasi vya mshahara' : 'Salary amounts'}</h1>
        </div>
      </div>
      <Alert kind="success">{notice}</Alert>
      <Section title={sw ? 'Weka kiasi' : 'Set an amount'}>
        <form className="stack" onSubmit={submit}>
          <div className="grid-3">
            <Field label={sw ? 'Ngazi ya mshahara' : 'Salary scale'} hint={sw ? 'Lazima ilingane kabisa na kumbukumbu za watumishi.' : 'Must match staff records exactly.'}>
              <input list="salary-scale-options" value={scale} onChange={(event) => setScale(event.target.value)} maxLength={50} required />
              <datalist id="salary-scale-options">
                {(scales.data || []).map((row) => <option key={row.scale} value={row.scale} />)}
              </datalist>
            </Field>
            <Field label={sw ? 'Inaanza mwezi' : 'Applies from'} hint={sw ? 'Inatumika hadi kiasi kipya kiwekwe.' : 'Applies until a new amount replaces it.'}>
              <input type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} required />
            </Field>
            <Field label={sw ? 'Mshahara wa mwezi (TZS)' : 'Monthly salary (TZS)'}>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
            </Field>
          </div>
          <Alert>{save.error}</Alert>
          <div><button type="submit" className="btn btn-primary" disabled={save.busy}>{save.busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Hifadhi kiasi' : 'Save amount')}</button></div>
        </form>
      </Section>
      <Section title={sw ? 'Ngazi za mshahara' : 'Salary scales'}>
        <AsyncState data={scales.data} error={scales.error} loading={scales.loading}>
          {(rows) => rows.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{sw ? 'Ngazi ya mshahara' : 'Salary scale'}</th>
                    <th scope="col" className="num">{sw ? 'Watoa huduma hai' : 'Active providers'}</th>
                    <th scope="col" className="num">{sw ? 'Mshahara wa mwezi sasa' : 'Monthly salary now'}</th>
                    <th scope="col">{sw ? 'Historia' : 'History'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.scale}>
                      <td><strong className="nowrap">{row.scale}</strong></td>
                      <td className="num">{num(row.providers)}</td>
                      <td className="num nowrap">{row.monthly_amount ? money(row.monthly_amount) : <span className="badge badge-warn">{sw ? 'Hakuna kiasi' : 'No amount'}</span>}</td>
                      <td className="small">{row.history.map((item) => `${item.start_month}: ${money(item.monthly_amount)}`).join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>{sw ? 'Bado hakuna ngazi za mshahara. Andika ngazi hapo juu.' : 'No salary scales yet. Type a scale above.'}</Empty>}
        </AsyncState>
      </Section>
    </div>
  );
}
