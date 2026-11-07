import React, { useMemo, useState } from 'react';
import { api, qs, saveBlob } from '../../api';
import { dateOnly, money, num, payMonth, payMonthDates, previousMonth, todayLocal, workHours } from '../../format';
import { useAction, useApi } from '../../hooks';
import { Alert, AsyncState, Empty, Field, Section, StatTile } from '../ui';

interface RegionStatus {
  id: number;
  name: string;
  signed: boolean;
  included: boolean;
  approved_by_name: string | null;
  approved_at: string | null;
  providers: number;
  providers_without_cso: number;
}
interface ProviderRow {
  staff_id: number;
  provider_name: string;
  cadre_name: string;
  facility_name: string;
  community_area_name: string | null;
  work_setting: string;
  region_name: string;
  days_signed: number;
  monthly_salary: string | null;
  checks: string[];
}
interface SalaryTimesheetSummary {
  regions: RegionStatus[];
  providers: ProviderRow[];
  settings: { name: string; providers: number; salary: string }[];
  holidays: { date: string; name_en: string }[];
  missing_bank: string[];
  missing_salary: string[];
  not_signed: string[];
  totals: { providers: number; days_signed: number; hours: string; salary: string };
}

const NAMES_SHOWN = 10;
const PAGE_SIZE = 20;

/** A first month can flag most providers, so name a few here; the list below marks every one. */
function nameList(names: string[]): string {
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  return names.length > NAMES_SHOWN ? `${shown} and ${num(names.length - NAMES_SHOWN)} more, all marked in the list below` : shown;
}

/** Salaries are worked out after a pay month closes, so start on the one before today's. */
const lastMonth = (): string => previousMonth(payMonth(todayLocal()));

/** Who is in the file, so a CSO can check one person without downloading. Bank details stay in the file only. */
function ProviderList({ rows }: { rows: ProviderRow[] }) {
  const [search, setSearch] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [page, setPage] = useState(0);
  const shown = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return rows.filter((row) => (!problemsOnly || row.checks.length > 0)
      && (!term || [row.provider_name, row.cadre_name, row.facility_name, row.community_area_name ?? '', row.region_name].some((value) => value.toLocaleLowerCase().includes(term))));
  }, [rows, search, problemsOnly]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const first = current * PAGE_SIZE;

  return (
    <div className="stack">
      <div className="grid-2">
        <Field label="Find a provider">
          <input
            type="search"
            value={search}
            placeholder="Name, cadre, facility, community area or region"
            onChange={(event) => { setSearch(event.target.value); setPage(0); }}
          />
        </Field>
        <label className="row">
          <input type="checkbox" checked={problemsOnly} onChange={(event) => { setProblemsOnly(event.target.checked); setPage(0); }} />
          <span>Show only providers that need attention</span>
        </label>
      </div>
      {shown.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Region</th>
                <th scope="col">Setting</th>
                <th scope="col">Facility</th>
                <th scope="col">Community area</th>
                <th scope="col">Cadre</th>
                <th scope="col" className="num">Days signed</th>
                <th scope="col" className="num">Monthly salary</th>
                <th scope="col">Check</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(first, first + PAGE_SIZE).map((row) => (
                <tr key={`${row.staff_id}-${row.cadre_name}-${row.region_name}-${row.facility_name}-${row.community_area_name}`}>
                  <td>{row.provider_name}</td>
                  <td>{row.region_name}</td>
                  <td>{row.work_setting}</td>
                  <td>{row.facility_name}</td>
                  <td>{row.community_area_name || '—'}</td>
                  <td>{row.cadre_name}</td>
                  <td className="num">{num(row.days_signed)}</td>
                  <td className="num nowrap">{row.monthly_salary ? money(row.monthly_salary) : '—'}</td>
                  <td>{row.checks.length ? <span className="badge badge-warn">{row.checks.join('; ')}</span> : <span className="muted">OK</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>No providers match.</Empty>
      )}
      <div className="row">
        <span className="muted small" aria-live="polite">
          {shown.length ? `${num(first + 1)}–${num(Math.min(first + PAGE_SIZE, shown.length))} of ${num(shown.length)}` : '0'} shown · {num(rows.length)} in the file
        </span>
        {pages > 1 && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage(current - 1)} disabled={current === 0}>Previous</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>Next</button>
          </>
        )}
      </div>
    </div>
  );
}

export function SalaryTimesheets({ csoId, noCso = false }: { csoId: string; noCso?: boolean }) {
  const [month, setMonth] = useState(lastMonth);
  const [regionId, setRegionId] = useState('');
  const [setting, setSetting] = useState('');
  const [preparing, setPreparing] = useState<'csv' | 'pdf' | null>(null);
  const query = { cso_id: csoId, month, region_id: regionId, setting };
  const summary = useApi<SalaryTimesheetSummary>(csoId && month ? `/cso-finance/salary-timesheets${qs(query)}` : null);
  const download = useAction();

  const save = async (format: 'csv' | 'pdf') => {
    setPreparing(format);
    const file = await download.run(() =>
      api.blob(`/cso-finance/salary-timesheets/export${qs({ ...query, format })}`, 'GET', `salary-timesheets-${month}.${format}`),
    );
    setPreparing(null);
    if (file) saveBlob(file);
  };

  if (noCso) {
    return (
      <Section title="Salary timesheets">
        <Empty>No CSO is linked to this account, so there are no timesheets to show. An administrator must add the CSO under Organizations, link it to its regions, and assign it to the CSO Finance user.</Empty>
      </Section>
    );
  }

  return (
    <Section title="Salary timesheets">
      <p className="muted">
        Download the Payroll timesheets Regional Finance has signed for your regions, for facility and community providers, with each provider's monthly salary, bank details and days signed. This creates a file only: it does not pay anyone or change any record.
      </p>
      <div className="grid-2">
        <Field label="Month worked" hint={payMonthDates(month)}>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </Field>
        {summary.data && summary.data.regions.length > 1 && (
          <Field label="Region">
            <select value={regionId} onChange={(event) => setRegionId(event.target.value)}>
              <option value="">All my regions</option>
              {summary.data.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="Providers">
          <select value={setting} onChange={(event) => setSetting(event.target.value)}>
            <option value="">Facility and community</option>
            <option value="Facility">Facility only</option>
            <option value="Community">Community only</option>
          </select>
        </Field>
      </div>
      <AsyncState data={summary.data} error={summary.error} loading={summary.loading}>
        {(data) => (
          <div className="stack">
            {data.regions.filter((region) => region.included).map((region) => (
              region.signed ? (
                <p key={region.id} className="notice notice-info small">
                  <strong>{region.name}:</strong> signed by {region.approved_by_name} on {dateOnly(region.approved_at)} · {num(region.providers)} providers
                </p>
              ) : (
                <Alert key={region.id} kind="warn">
                  <strong>{region.name}:</strong> not signed yet, so its timesheets are not in the file. Regional Finance must sign this month's Payroll report first.
                </Alert>
              )
            ))}
            {data.regions.filter((region) => region.included && region.providers_without_cso > 0).map((region) => (
              <Alert key={region.id} kind="warn">
                <strong>{region.name}:</strong> {num(region.providers_without_cso)} signed {region.providers_without_cso === 1 ? 'provider has' : 'providers have'} no CSO on their placement, so they are not in this file. An administrator must set the CSO on the placement, then Regional Finance must confirm the sign-off again.
              </Alert>
            ))}
            {data.missing_salary.length > 0 && (
              <Alert kind="warn">
                <strong>No salary amount ({num(data.missing_salary.length)}):</strong> {nameList(data.missing_salary)}. They stay in the file without an amount and are not in the total. Ask Central Finance to set the amount for their salary scale.
              </Alert>
            )}
            {data.missing_bank.length > 0 && (
              <Alert kind="warn">
                <strong>Bank details missing ({num(data.missing_bank.length)}):</strong> {nameList(data.missing_bank)}. They stay in the file, marked as missing. Get their details before paying.
              </Alert>
            )}
            {data.not_signed.length > 0 && (
              <Alert kind="warn">
                <strong>Not signed by the provider ({num(data.not_signed.length)}):</strong> {nameList(data.not_signed)}. No salary is shown for them.
              </Alert>
            )}
            {data.totals.providers ? (
              <>
                <div className="grid-4">
                  <StatTile label="Providers" value={num(data.totals.providers)} />
                  <StatTile label="Days signed" value={num(data.totals.days_signed)} />
                  <StatTile label="Hours worked" value={workHours(data.totals.hours)} />
                  <StatTile label="Total salary" value={money(data.totals.salary)} />
                </div>
                <p className="muted small">
                  {data.settings.map((row) => `${row.name}: ${num(row.providers)} ${row.providers === 1 ? 'provider' : 'providers'}, ${money(row.salary)}`).join(' · ')}
                </p>
              </>
            ) : (
              <Empty>{setting ? `No ${setting.toLocaleLowerCase()} providers in the signed timesheets for this month.` : 'No signed timesheets for this month yet.'}</Empty>
            )}
            {data.holidays.length > 0 && (
              <p className="muted small">Public holidays in this month: {data.holidays.map((day) => `${dateOnly(day.date)} ${day.name_en}`).join(' · ')}</p>
            )}
            <Alert>{download.error}</Alert>
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => save('pdf')} disabled={download.busy || !data.totals.providers}>
                {preparing === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => save('csv')} disabled={download.busy || !data.totals.providers}>
                {preparing === 'csv' ? 'Preparing CSV…' : 'Download CSV'}
              </button>
            </div>
            <p className="muted small">PDF: a summary, then one timesheet page per provider, for filing. CSV: one row per provider with salary, bank details and hours for each day. Keep these files private, and open the bank account column as text so spreadsheets do not change the numbers.</p>
            {data.providers.length > 0 && <ProviderList key={`${month}-${regionId}-${setting}`} rows={data.providers} />}
          </div>
        )}
      </AsyncState>
    </Section>
  );
}
