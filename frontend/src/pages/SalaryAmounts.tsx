import React, { useState } from 'react';
import { api, qs } from '../api';
import { Alert, AsyncState, Empty, Field, Section, pageLang } from '../components/ui';
import { money, num, payMonth, todayLocal } from '../format';
import { useAction, useApi } from '../hooks';

export interface PayPart {
  key: string;
  name: string;
  amount: string;
}

interface ScaleAmount {
  scale: string;
  providers: number;
  monthly_amount: string | null;
  history: { start_month: string; monthly_amount: string }[];
  /** The parts of the amount: the CHW package's stipend, transport and communication. */
  components?: PayPart[] | null;
  is_chw_package?: boolean;
}

const CHW_PARTS: { key: string; en: string; sw: string }[] = [
  { key: 'stipend', en: 'Monthly stipend', sw: 'Posho ya mwezi' },
  { key: 'transport', en: 'Transport', sw: 'Usafiri' },
  { key: 'communication', en: 'Communication', sw: 'Mawasiliano' },
];

/** "100,000 + 30,000 + 20,000" style breakdown of an amount made of parts. */
export function partsText(parts: PayPart[] | null | undefined): string {
  return (parts || []).map((part) => `${part.name} ${money(part.amount)}`).join(' + ');
}

/** Every CHW is paid this package, whatever salary scale is on their record. */
function ChwPackage({ current, month, sw, onSaved }: { current: ScaleAmount | undefined; month: string; sw: boolean; onSaved: (text: string) => void }) {
  const amountOf = (key: string) => current?.components?.find((part) => part.key === key)?.amount || '';
  const [parts, setParts] = useState<Record<string, string>>(() => Object.fromEntries(CHW_PARTS.map((p) => [p.key, amountOf(p.key)])));
  const [startMonth, setStartMonth] = useState(month);
  const save = useAction();
  const total = CHW_PARTS.reduce((sum, p) => sum + (Number(parts[p.key]) || 0), 0);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = await save.run(() => api.put('/salary-amounts', { scale: 'CHW', start_month: startMonth, components: parts }));
    if (saved !== undefined) onSaved(sw ? `Kifurushi cha CHW kimehifadhiwa kuanzia ${startMonth}.` : `Saved the CHW package from ${startMonth}.`);
  };
  return (
    <Section title={sw ? 'Malipo ya mshahara ya CHW' : 'CHW Payroll package'}>
      <form className="stack" onSubmit={submit}>
        <p className="muted small">
          {sw ? 'Kila CHW analipwa kifurushi hiki kila mwezi, bila kujali ngazi ya mshahara kwenye kumbukumbu yake.'
            : 'Every CHW is paid this package each month, whatever salary scale is on their record.'}
          {current?.monthly_amount && ` ${sw ? 'Sasa' : 'Now'}: ${money(current.monthly_amount)} = ${partsText(current.components)}.`}
        </p>
        <div className="grid-3">
          {CHW_PARTS.map((part) => (
            <Field key={part.key} label={`${sw ? part.sw : part.en} (TZS)`}>
              <input type="number" min="0" step="0.01" value={parts[part.key]} required
                onChange={(event) => setParts({ ...parts, [part.key]: event.target.value })} />
            </Field>
          ))}
          <Field label={sw ? 'Inaanza mwezi' : 'Applies from'}>
            <input type="month" value={startMonth} onChange={(event) => setStartMonth(event.target.value)} required />
          </Field>
        </div>
        <p><strong>{sw ? 'Jumla kwa mwezi' : 'Monthly total'}: {money(String(total))}</strong></p>
        <Alert>{save.error}</Alert>
        <div><button type="submit" className="btn btn-primary" disabled={save.busy || total <= 0}>{save.busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Hifadhi kifurushi' : 'Save CHW package')}</button></div>
      </form>
    </Section>
  );
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
                {(scales.data || []).filter((row) => !row.is_chw_package).map((row) => <option key={row.scale} value={row.scale} />)}
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
      {scales.data && (
        <ChwPackage key={scales.data.find((row) => row.is_chw_package)?.monthly_amount || 'none'}
          current={scales.data.find((row) => row.is_chw_package)} month={thisMonth} sw={sw}
          onSaved={(text) => { setNotice(text); scales.reload(); }} />
      )}
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
                      <td>
                        <strong className="nowrap">{row.is_chw_package ? (sw ? 'Kifurushi cha CHW' : 'CHW package') : row.scale}</strong>
                        {row.is_chw_package && <span className="cell-sub">{sw ? 'CHW wote' : 'All CHWs'}</span>}
                      </td>
                      <td className="num">{num(row.providers)}</td>
                      <td className="num nowrap">
                        {row.monthly_amount ? money(row.monthly_amount) : <span className="badge badge-warn">{sw ? 'Hakuna kiasi' : 'No amount'}</span>}
                        {row.components && <span className="cell-sub">{partsText(row.components)}</span>}
                      </td>
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
