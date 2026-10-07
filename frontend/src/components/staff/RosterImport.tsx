import React, { useRef, useState } from 'react';
import { api } from '../../api';
import { useAction, useApi } from '../../hooks';
import { dateTime, humanize, num } from '../../format';
import { RosterImport as RosterImportRow } from '../../types';
import { Alert, AsyncState, Field, Section } from '../ui';
import { RowErrors } from '../budgets/TrackerSync';

interface Template {
  columns: string[];
  required: string[];
}

/** Registry tab remounts (and refetches) when the user switches back, so no refresh callback is needed. */
export function RosterImport() {
  const template = useApi<Template>('/staff/import-template');
  const history = useApi<RosterImportRow[]>('/staff/imports');
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('ROSTER_IMPORT');
  const [result, setResult] = useState<RosterImportRow | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const { busy, error, run } = useAction();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    form.append('enrollment_source', source);
    setResult(null);
    const res = await run(() => api.upload<RosterImportRow>('/staff/import', form));
    if (res) {
      setResult(res);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      history.reload();
    }
  };

  return (
    <div className="stack-lg">
      <Section title="Import an approved roster">
        <AsyncState data={template.data} error={template.error} loading={template.loading}>
          {(t) => (
            <div className="stack">
              <p className="small">
                CSV columns (* required):{' '}
                {t.columns.map((c, i) => (
                  <React.Fragment key={c}>
                    {i > 0 && ', '}
                    <code>{c}</code>
                    {t.required.includes(c) ? '*' : ''}
                  </React.Fragment>
                ))}
              </p>
              <pre className="json small">{t.columns.join(',')}</pre>
              <p className="muted small">
                <code>cadre</code> is the cadre code (e.g. CHW, HCP); region, district, ward, facility and organization use the exact names in the system;{' '}
                <code>start_date</code> is YYYY-MM-DD. A phone number that already exists records a rotation for that person instead of a new identity. Bad rows are
                skipped and reported.
              </p>
            </div>
          )}
        </AsyncState>
        <form className="stack" onSubmit={submit}>
          <div className="grid-2">
            <Field label="Roster CSV file">
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
            </Field>
            <Field label="Enrollment source">
              <select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="ROSTER_IMPORT">Roster import</option>
                <option value="ENGAGEMENT_LIST">Engagement list</option>
              </select>
            </Field>
          </div>
          <Alert>{error}</Alert>
          <div className="row">
            <button className="btn btn-primary" disabled={busy || !file}>
              {busy ? 'Importing…' : 'Import roster'}
            </button>
          </div>
        </form>
        {result && (
          <div className="stack">
            <Alert kind={result.error_count ? (result.created_count || result.updated_count ? 'warn' : 'error') : 'success'}>
              {result.filename}: {num(result.total_rows)} rows — {num(result.created_count)} created, {num(result.updated_count)} updated (rotated),{' '}
              {num(result.error_count)} with errors
              {result.total_rows - result.created_count - result.updated_count - result.error_count > 0 &&
                `, ${num(result.total_rows - result.created_count - result.updated_count - result.error_count)} unchanged`}
              .
            </Alert>
            {(result.errors || []).length > 0 && <RowErrors errors={result.errors || []} />}
          </div>
        )}
      </Section>

      <Section title="Import history">
        <AsyncState data={history.data} error={history.error} loading={history.loading} empty="No roster imports yet.">
          {(rows) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>File</th>
                    <th>Source</th>
                    <th className="num">Rows</th>
                    <th className="num">Created</th>
                    <th className="num">Updated</th>
                    <th className="num">Errors</th>
                    <th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const errs = r.errors || [];
                    return (
                      <React.Fragment key={r.id}>
                        <tr>
                          <td className="nowrap">{dateTime(r.created_at)}</td>
                          <td>{r.filename}</td>
                          <td>{humanize(r.enrollment_source)}</td>
                          <td className="num">{num(r.total_rows)}</td>
                          <td className="num">{num(r.created_count)}</td>
                          <td className="num">{num(r.updated_count)}</td>
                          <td className="num">{num(r.error_count)}</td>
                          <td>
                            {errs.length ? (
                              <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                                {open === r.id ? 'Hide errors' : `Show ${errs.length} error${errs.length === 1 ? '' : 's'}`}
                              </button>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        </tr>
                        {open === r.id && (
                          <tr>
                            <td colSpan={8}>
                              <RowErrors errors={errs} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AsyncState>
      </Section>
    </div>
  );
}
