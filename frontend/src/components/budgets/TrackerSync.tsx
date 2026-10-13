import React, { useEffect, useRef, useState } from 'react';
import { api, qs, saveBlob } from '../../api';
import { useAction, useApi } from '../../hooks';
import { dateTime, humanize, num } from '../../format';
import { BudgetSyncLog } from '../../types';
import { Alert, AsyncState, Field, Section, StatusBadge } from '../ui';

export const TRACKER_COLUMNS = ['code', 'name', 'category', 'period_start', 'region', 'allocated_amount', 'external_ref'];
const REQUIRED = new Set(['code', 'name', 'category', 'period_start', 'allocated_amount']);

export function RowErrors({ errors }: { errors: { line: number; error: string }[] }) {
  if (!errors.length) return <p className="muted small">No row errors.</p>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th className="num">File line</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {errors.map((e, i) => (
            <tr key={`${e.line}-${i}`}>
              <td className="num">{e.line}</td>
              <td>{e.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** FHI360 finance: tracker CSV import and export. */
export function TrackerPanel({ periodId, onChanged }: { periodId: string; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<BudgetSyncLog | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const imp = useAction();
  const exp = useAction();
  const tpl = useAction();

  const downloadTemplate = async () => {
    const file = await tpl.run(() => api.blob('/budgets/tracker/template', 'GET', 'fhi360-tracker-import-template.csv'));
    if (file) saveBlob(file);
  };

  const doImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setResult(null);
    const log = await imp.run(() => api.upload<BudgetSyncLog>('/budgets/tracker/import', form));
    if (log) {
      setResult(log);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      onChanged();
    }
  };

  const doExport = async () => {
    const scope = periodId ? 'the selected period' : 'all periods';
    if (!window.confirm(`Export FHI360 lines for ${scope}? Exported lines are marked “Exported” until they are reconciled.`)) return;
    setExported(null);
    const file = await exp.run(() => api.blob(`/budgets/tracker/export${qs({ period_id: periodId })}`, 'POST', 'fhi360-tracker-export.csv'));
    if (file) {
      saveBlob(file);
      setExported(file.filename);
      onChanged();
    }
  };

  const errors = result?.log_data?.errors || [];

  return (
    <Section title="FHI360 HQ tracker files">
      <div className="grid-2">
        <form className="stack" onSubmit={doImport}>
          <h4>Import allocations</h4>
          <p className="muted small">
            Upload a CSV exported from the HQ tracker. Columns:{' '}
            {TRACKER_COLUMNS.map((c, i) => (
              <React.Fragment key={c}>
                {i > 0 && ', '}
                <code>{c}</code>
                {REQUIRED.has(c) ? '*' : ''}
              </React.Fragment>
            ))}
            . * required. <code>category</code> and <code>region</code> use the exact names in the system; <code>period_start</code> is YYYY-MM-DD.
          </p>
          <pre className="json small">{TRACKER_COLUMNS.join(',')}</pre>
          <div className="row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={downloadTemplate} disabled={tpl.busy}>
              {tpl.busy ? 'Preparing…' : 'Download template'}
            </button>
            <span className="muted small">Pre-filled with each FHI360 category and open pay period. Fill in allocated_amount, then import.</span>
          </div>
          <Alert>{tpl.error}</Alert>
          <Field label="Tracker CSV file">
            <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
          </Field>
          <Alert>{imp.error}</Alert>
          <div className="row">
            <button className="btn btn-primary" disabled={imp.busy || !file}>
              {imp.busy ? 'Importing…' : 'Import file'}
            </button>
          </div>
        </form>
        <div className="stack">
          <h4>Export commitments and expenditure</h4>
          <p className="muted small">
            Downloads a CSV of FHI360 lines {periodId ? 'for the selected period' : 'for all periods'} to upload to the HQ tracker. Use the period filter above
            to narrow it.
          </p>
          <Alert>{exp.error}</Alert>
          <Alert kind="success">{exported && `Downloaded ${exported}.`}</Alert>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={doExport} disabled={exp.busy}>
              {exp.busy ? 'Exporting…' : 'Export CSV'}
            </button>
          </div>
        </div>
      </div>
      {result && (
        <div className="stack">
          <Alert kind={result.sync_status === 'SUCCESS' ? 'success' : result.sync_status === 'PARTIAL' ? 'warn' : 'error'}>
            Import {humanize(result.sync_status).toLowerCase()}: {num(result.records_processed)} rows processed, {num(result.success_count)} imported,{' '}
            {num(result.error_count)} with errors.
          </Alert>
          {errors.length > 0 && <RowErrors errors={errors} />}
        </div>
      )}
    </Section>
  );
}

function logDetails(log: BudgetSyncLog): string | null {
  const data = log.log_data;
  if (!data) return null;
  const rest = Object.entries(data).filter(([k]) => k !== 'errors');
  if (!rest.length) return null;
  return rest.map(([k, v]) => `${humanize(k)}: ${typeof v === 'string' || typeof v === 'number' ? v : JSON.stringify(v)}`).join(' · ');
}

/** Sync history: imports, exports and reconciliations. */
export function SyncLogs({ refreshKey }: { refreshKey: number }) {
  const { data, error, loading, reload } = useApi<BudgetSyncLog[]>('/budgets/sync-logs');
  const [open, setOpen] = useState<number | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [refreshKey, reload]);
  return (
    <Section title="Tracker sync log">
      <AsyncState data={data} error={error} loading={loading} empty="No tracker imports, exports or reconciliations yet.">
        {(logs) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Type</th>
                  <th>File</th>
                  <th>Status</th>
                  <th className="num">Processed</th>
                  <th className="num">Succeeded</th>
                  <th className="num">Errors</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const errs = log.log_data?.errors || [];
                  const details = logDetails(log);
                  return (
                    <React.Fragment key={log.id}>
                      <tr>
                        <td className="nowrap">{dateTime(log.started_at)}</td>
                        <td>{humanize(log.sync_type)}</td>
                        <td>{log.filename || '—'}</td>
                        <td>
                          <StatusBadge status={log.sync_status} />
                        </td>
                        <td className="num">{num(log.records_processed)}</td>
                        <td className="num">{num(log.success_count)}</td>
                        <td className="num">{num(log.error_count)}</td>
                        <td>
                          {details && <div className="small muted">{details}</div>}
                          {errs.length > 0 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              aria-expanded={open === log.id}
                              onClick={() => setOpen(open === log.id ? null : log.id)}
                            >
                              {open === log.id ? 'Hide errors' : `Show ${errs.length} error${errs.length === 1 ? '' : 's'}`}
                            </button>
                          )}
                          {!details && !errs.length && <span className="muted">—</span>}
                        </td>
                      </tr>
                      {open === log.id && (
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
  );
}
