import React, { useState } from 'react';
import { api, qs } from '../api';
import { Alert, AsyncState, Empty, Field, ReasonDialog, Section, pageLang } from '../components/ui';
import { dateOnly, todayLocal, weekday } from '../format';
import { useAction, useApi } from '../hooks';
import { PublicHoliday } from '../types';

/** Fixed holidays come from the system. Eid, Maulid and one-off days are announced, so an administrator enters them. */
export function PublicHolidays() {
  const sw = pageLang() === 'sw';
  const [year, setYear] = useState(todayLocal().slice(0, 4));
  const holidays = useApi<PublicHoliday[]>(/^\d{4}$/.test(year) ? `/public-holidays${qs({ year })}` : null);
  const [date, setDate] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameSw, setNameSw] = useState('');
  const [removing, setRemoving] = useState<PublicHoliday | null>(null);
  const save = useAction();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const saved = await save.run(() => api.post('/public-holidays', { holiday_date: date, name_en: nameEn.trim(), name_sw: nameSw.trim() }));
    if (saved !== undefined) {
      setDate('');
      setNameEn('');
      setNameSw('');
      holidays.reload();
    }
  };

  const remove = async () => {
    await api.del(`/public-holidays/${removing?.id}`);
    setRemoving(null);
    holidays.reload();
  };

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>{sw ? 'Sikukuu za kitaifa' : 'Public holidays'}</h1>
        </div>
      </div>
      <Section title={sw ? 'Ongeza sikukuu' : 'Add a holiday'}>
        <p className="muted small">{sw ? 'Sikukuu za tarehe maalum na Pasaka zimo tayari. Ongeza Idd, Maulid na sikukuu za mara moja zinapotangazwa.' : 'Fixed holidays and Easter are included. Add Eid, Maulid and one-off holidays when announced.'}</p>
        <Alert>{save.error}</Alert>
        <form className="stack" onSubmit={submit}>
          <div className="grid-3">
            <Field label={sw ? 'Tarehe' : 'Date'}>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </Field>
            <Field label={sw ? 'Jina kwa Kiingereza' : 'Name in English'}>
              <input value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={100} required />
            </Field>
            <Field label={sw ? 'Jina kwa Kiswahili' : 'Name in Swahili'}>
              <input value={nameSw} onChange={(event) => setNameSw(event.target.value)} maxLength={100} required />
            </Field>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={save.busy}>{save.busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Ongeza sikukuu' : 'Add holiday')}</button>
          </div>
        </form>
      </Section>
      <Section
        title={sw ? 'Sikukuu kwa mwaka' : 'Holidays by year'}
        actions={<Field label={sw ? 'Mwaka' : 'Year'}>
          <input type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} style={{ width: '7rem' }} />
        </Field>}
      >
        <AsyncState data={holidays.data} error={holidays.error} loading={holidays.loading}>
          {(rows) => (rows.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">{sw ? 'Tarehe' : 'Date'}</th>
                    <th scope="col">{sw ? 'Sikukuu' : 'Holiday'}</th>
                    <th scope="col">{sw ? 'Chanzo' : 'Source'}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.date}-${row.name_en}`}>
                      <td><span className="cell-main">{dateOnly(row.date)}</span><span className="cell-sub">{weekday(row.date, sw ? 'sw' : 'en')}</span></td>
                      <td><span className="cell-main">{sw ? row.name_sw : row.name_en}</span><span className="cell-sub">{sw ? row.name_en : row.name_sw}</span></td>
                      <td>
                        {row.id === null ? <span className="muted">{sw ? 'Kila mwaka' : 'Every year'}</span> : (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRemoving(row)}>{sw ? 'Ondoa' : 'Remove'}</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>{sw ? 'Chagua mwaka kati ya 2000 na 2100.' : 'Choose a year between 2000 and 2100.'}</Empty>)}
        </AsyncState>
      </Section>
      {removing && (
        <ReasonDialog
          title={sw ? `Ondoa ${removing.name_sw || removing.name_en}?` : `Remove ${removing.name_en}?`}
          description={sw
            ? `Haitaonekana tena tarehe ${dateOnly(removing.date)} kwenye kalenda, majedwali ya muda au mafaili ya mishahara.`
            : `It will no longer show on ${dateOnly(removing.date)} in calendars, timesheets or salary files.`}
          required={false}
          confirmLabel={sw ? 'Ondoa sikukuu' : 'Remove holiday'}
          danger
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
