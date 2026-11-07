import React, { useState } from 'react';
import { api, qs } from '../api';
import { Alert, AsyncState, Empty, Field, ReasonDialog, Section } from '../components/ui';
import { dateOnly, todayLocal, weekday } from '../format';
import { useAction, useApi } from '../hooks';
import { PublicHoliday } from '../types';

/** Fixed holidays come from the system. Eid, Maulid and one-off days are announced, so an administrator enters them. */
export function PublicHolidays() {
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
          <h1>Public holidays</h1>
          <p className="muted">These appear on provider calendars, printed timesheets and salary files. They do not change hours, salaries or who can record work.</p>
        </div>
      </div>
      <Section title="Add a holiday">
        <p className="muted small">Tanzania's fixed holidays, Good Friday and Easter Monday are already included. Add Eid al-Fitr, Eid al-Adha and Maulid once the date is announced, and any one-off holiday the government declares.</p>
        <Alert>{save.error}</Alert>
        <form className="stack" onSubmit={submit}>
          <div className="grid-3">
            <Field label="Date">
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </Field>
            <Field label="Name in English">
              <input value={nameEn} onChange={(event) => setNameEn(event.target.value)} maxLength={100} required />
            </Field>
            <Field label="Name in Swahili">
              <input value={nameSw} onChange={(event) => setNameSw(event.target.value)} maxLength={100} required />
            </Field>
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={save.busy}>{save.busy ? 'Saving…' : 'Add holiday'}</button>
          </div>
        </form>
      </Section>
      <Section title="Holidays by year">
        <Field label="Year">
          <input type="number" min="2000" max="2100" value={year} onChange={(event) => setYear(event.target.value)} />
        </Field>
        <AsyncState data={holidays.data} error={holidays.error} loading={holidays.loading}>
          {(rows) => (rows.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Day</th>
                    <th scope="col">Holiday</th>
                    <th scope="col">Swahili</th>
                    <th scope="col">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.date}-${row.name_en}`}>
                      <td className="nowrap">{dateOnly(row.date)}</td>
                      <td>{weekday(row.date)}</td>
                      <td>{row.name_en}</td>
                      <td>{row.name_sw}</td>
                      <td>
                        {row.id === null ? <span className="muted">Every year</span> : (
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRemoving(row)}>Remove</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>Choose a year between 2000 and 2100.</Empty>)}
        </AsyncState>
      </Section>
      {removing && (
        <ReasonDialog
          title={`Remove ${removing.name_en}?`}
          description={`It will no longer show on ${dateOnly(removing.date)} in calendars, timesheets or salary files.`}
          required={false}
          confirmLabel="Remove holiday"
          danger
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
