import React, { useMemo, useState } from 'react';
import { api, qs, saveBlob } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateOnly, money, num, payMonth, payMonthDates, previousMonth, todayLocal, workHours } from '../../format';
import { useAction, useApi } from '../../hooks';
import { Alert, AsyncState, Empty, Field, KpiStrip, Section } from '../ui';
import { PaymentForm, PaymentFormView } from '../finance/PaymentFormView';

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
/** The server's payment checks and work settings, in Swahili for the screen (files stay as the server writes them). */
const CHECK_SW: Record<string, string> = {
  'Bank details missing': 'Taarifa za benki hazipo',
  'Salary amount missing': 'Kiasi cha mshahara hakipo',
  'Not signed by provider': 'Mtoa huduma hajasaini',
};
const SETTING_SW: Record<string, string> = { Facility: 'Kituo', Community: 'Jamii' };
const PAGE_SIZE = 20;

/** A first month can flag most providers, so name a few here; the list below marks every one. */
function nameList(names: string[], sw = false): string {
  const shown = names.slice(0, NAMES_SHOWN).join(', ');
  if (names.length <= NAMES_SHOWN) return shown;
  return sw
    ? `${shown} na wengine ${num(names.length - NAMES_SHOWN)}, wote wamewekewa alama kwenye orodha hapa chini`
    : `${shown} and ${num(names.length - NAMES_SHOWN)} more, all marked in the list below`;
}

/** Salaries are worked out after a pay month closes, so start on the one before today's. */
const lastMonth = (): string => previousMonth(payMonth(todayLocal()));

/** Who is in the file, so a CSO can check one person without downloading. Bank details stay in the file only. */
function ProviderList({ rows, sw }: { rows: ProviderRow[]; sw: boolean }) {
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
      <div className="fin-toolbar">
        <div className="filters">
          <Field label={sw ? 'Tafuta mtoa huduma' : 'Find a provider'}>
            <input
              type="search"
              value={search}
              placeholder={sw ? 'Jina, kada, kituo, eneo la jamii au mkoa' : 'Name, cadre, facility, community area or region'}
              onChange={(event) => { setSearch(event.target.value); setPage(0); }}
            />
          </Field>
          <label className="check-line small">
            <input type="checkbox" checked={problemsOnly} onChange={(event) => { setProblemsOnly(event.target.checked); setPage(0); }} />
            <span>{sw ? 'Onyesha wanaohitaji hatua tu' : 'Show only providers that need attention'}</span>
          </label>
        </div>
      </div>
      {shown.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">{sw ? 'Mtoa huduma' : 'Provider'}</th>
                <th scope="col">{sw ? 'Mahali pa kazi' : 'Placement'}</th>
                <th scope="col">{sw ? 'Mkoa' : 'Region'}</th>
                <th scope="col" className="num">{sw ? 'Siku zilizosainiwa' : 'Days signed'}</th>
                <th scope="col" className="num">{sw ? 'Mshahara wa mwezi' : 'Monthly salary'}</th>
                <th scope="col">{sw ? 'Ukaguzi' : 'Check'}</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(first, first + PAGE_SIZE).map((row) => (
                <tr key={`${row.staff_id}-${row.cadre_name}-${row.region_name}-${row.facility_name}-${row.community_area_name}`}>
                  <td>
                    <span className="cell-main">{row.provider_name}</span>
                    <span className="cell-sub">{row.cadre_name}</span>
                  </td>
                  <td>
                    <span className="cell-main">{row.community_area_name || row.facility_name}</span>
                    <span className="cell-sub">
                      {(sw && SETTING_SW[row.work_setting]) || row.work_setting}
                      {row.community_area_name && row.facility_name && row.facility_name !== '—' ? ` · ${row.facility_name}` : ''}
                    </span>
                  </td>
                  <td className="nowrap">{row.region_name}</td>
                  <td className="num">{num(row.days_signed)}</td>
                  <td className="num nowrap">{row.monthly_salary ? money(row.monthly_salary) : '—'}</td>
                  <td>{row.checks.length ? <span className="badge badge-warn">{row.checks.map((check) => (sw && CHECK_SW[check]) || check).join('; ')}</span> : <span className="badge badge-success">{sw ? 'Sawa' : 'OK'}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>{sw ? 'Hakuna mtoa huduma anayelingana.' : 'No providers match.'}</Empty>
      )}
      <div className="row fin-pager">
        <span className="muted small" aria-live="polite">
          {shown.length ? `${num(first + 1)}–${num(Math.min(first + PAGE_SIZE, shown.length))} ${sw ? 'kati ya' : 'of'} ${num(shown.length)}` : '0'} {sw ? `zinaonyeshwa · ${num(rows.length)} kwenye faili` : `shown · ${num(rows.length)} in the file`}
        </span>
        {pages > 1 && (
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage(current - 1)} disabled={current === 0}>{sw ? 'Iliyotangulia' : 'Previous'}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPage(current + 1)} disabled={current >= pages - 1}>{sw ? 'Inayofuata' : 'Next'}</button>
          </>
        )}
      </div>
    </div>
  );
}

export function SalaryTimesheets({ csoId, noCso = false }: { csoId: string; noCso?: boolean }) {
  const { lang } = useAuth();
  const sw = lang === 'sw';
  const [month, setMonth] = useState(lastMonth);
  const [regionId, setRegionId] = useState('');
  const [setting, setSetting] = useState('');
  const [preparing, setPreparing] = useState<'csv' | 'pdf' | 'form-pdf' | 'form-xlsx' | null>(null);
  const query = { cso_id: csoId, month, region_id: regionId, setting };
  const summary = useApi<SalaryTimesheetSummary>(csoId && month ? `/cso-finance/salary-timesheets${qs(query)}` : null);
  const download = useAction();
  const [showForm, setShowForm] = useState(false);
  const form = useApi<PaymentForm>(showForm && csoId && month ? `/cso-finance/payment-form${qs(query)}` : null);
  const title = sw ? 'Majedwali ya mshahara' : 'Salary timesheets';

  const save = async (format: 'csv' | 'pdf' | 'form-pdf' | 'form-xlsx') => {
    setPreparing(format);
    const file = await download.run(() => (format.startsWith('form-')
      ? api.blob(`/cso-finance/payment-form/export${qs({ ...query, format: format.slice(5) })}`, 'GET', `payroll-payment-form-${month}.${format.slice(5)}`)
      : api.blob(`/cso-finance/salary-timesheets/export${qs({ ...query, format })}`, 'GET', `salary-timesheets-${month}.${format}`)));
    setPreparing(null);
    if (file) saveBlob(file);
  };

  if (noCso) {
    return (
      <Section title={title}>
        <Empty>{sw ? 'Hakuna CSO iliyounganishwa na akaunti hii. Muombe msimamizi aiunganishe.' : 'No CSO is linked to this account. Ask an administrator to link one.'}</Empty>
      </Section>
    );
  }

  const settingName = (name: string) => (sw && SETTING_SW[name]) || name;

  return (
    <Section title={title} actions={<span className="muted small">{sw ? 'Kupakua hakumlipi mtu wala hakubadilishi rekodi yoyote.' : 'Downloading does not pay anyone or change any record.'}</span>}>
      <div className="fin-toolbar">
        <div className="filters">
          <Field label={sw ? 'Mwezi wa kazi' : 'Month worked'} hint={payMonthDates(month)}>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </Field>
          {summary.data && summary.data.regions.length > 1 && (
            <Field label={sw ? 'Mkoa' : 'Region'}>
              <select value={regionId} onChange={(event) => setRegionId(event.target.value)}>
                <option value="">{sw ? 'Mikoa yangu yote' : 'All my regions'}</option>
                {summary.data.regions.map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
              </select>
            </Field>
          )}
          <Field label={sw ? 'Watoa huduma' : 'Providers'}>
            <select value={setting} onChange={(event) => setSetting(event.target.value)}>
              <option value="">{sw ? 'Kituo na jamii' : 'Facility and community'}</option>
              <option value="Facility">{sw ? 'Kituo tu' : 'Facility only'}</option>
              <option value="Community">{sw ? 'Jamii tu' : 'Community only'}</option>
            </select>
          </Field>
        </div>
        {summary.data && (
          <div className="fin-actions">
            <button type="button" className="btn btn-primary" onClick={() => save('pdf')} disabled={download.busy || !summary.data.totals.providers}>
              {preparing === 'pdf' ? (sw ? 'Inaandaa PDF…' : 'Preparing PDF…') : (sw ? 'Majedwali + fomu ya malipo (PDF)' : 'Timesheets + payment form (PDF)')}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => save('csv')} disabled={download.busy || !summary.data.totals.providers}>
              {preparing === 'csv' ? (sw ? 'Inaandaa CSV…' : 'Preparing CSV…') : (sw ? 'Pakua CSV' : 'Download CSV')}
            </button>
          </div>
        )}
      </div>
      <AsyncState data={summary.data} error={summary.error} loading={summary.loading}>
        {(data) => (
          <div className="stack">
            {data.totals.providers ? (
              <>
                <KpiStrip
                  label={sw ? 'Jumla za majedwali ya mshahara' : 'Salary timesheet totals'}
                  items={[
                    { label: sw ? 'Watoa huduma' : 'Providers', value: num(data.totals.providers), icon: 'users' },
                    { label: sw ? 'Siku zilizosainiwa' : 'Days signed', value: num(data.totals.days_signed), icon: 'calendar', tone: 'info' },
                    { label: sw ? 'Masaa ya kazi' : 'Hours worked', value: workHours(data.totals.hours), icon: 'clock', tone: 'info' },
                    { label: sw ? 'Jumla ya mshahara' : 'Total salary', value: money(data.totals.salary), icon: 'wallet', tone: 'success' },
                  ]}
                />
                <section className="cso-payment-form stack" aria-label={sw ? 'Fomu ya malipo ya mshahara' : 'Payroll payment form'}>
                  <div className="row">
                    <h3>{sw ? 'Fomu ya malipo' : 'Payment form'}</h3>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => save('form-pdf')} disabled={download.busy}>
                      {preparing === 'form-pdf' ? (sw ? 'Inaandaa PDF…' : 'Preparing PDF…') : (sw ? 'Fomu ya malipo (PDF)' : 'Payment form (PDF)')}
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => save('form-xlsx')} disabled={download.busy}>
                      {preparing === 'form-xlsx' ? (sw ? 'Inaandaa Excel…' : 'Preparing Excel…') : (sw ? 'Fomu ya malipo (Excel)' : 'Payment form (Excel)')}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" aria-expanded={showForm} onClick={() => setShowForm(!showForm)}>
                      {showForm ? (sw ? 'Ficha fomu' : 'Hide payment form') : (sw ? 'Onyesha fomu' : 'Show payment form')}
                    </button>
                  </div>
                  {showForm && (form.error
                    ? <Alert kind="warn">{form.error}</Alert>
                    : form.data ? <PaymentFormView form={form.data} sw={sw} /> : <p className="muted">{sw ? 'Inapakia…' : 'Loading…'}</p>)}
                  {showForm && form.data && <p className="fin-footnote">{sw
                    ? 'Skrini inaonyesha tarakimu nne za mwisho za akaunti. Namba kamili zipo kwenye PDF na Excel.'
                    : 'The screen shows the last four digits of each account. The full numbers are in the PDF and Excel files.'}</p>}
                </section>
                <p className="fin-footnote">
                  {data.settings.map((row) => (sw
                    ? `${settingName(row.name)}: watoa huduma ${num(row.providers)}, ${money(row.salary)}`
                    : `${row.name}: ${num(row.providers)} ${row.providers === 1 ? 'provider' : 'providers'}, ${money(row.salary)}`)).join(' · ')}
                </p>
              </>
            ) : (
              <Empty>{setting
                ? (sw ? `Hakuna watoa huduma wa ${settingName(setting).toLocaleLowerCase()} kwenye majedwali yaliyosainiwa ya mwezi huu.` : `No ${setting.toLocaleLowerCase()} providers in the signed timesheets for this month.`)
                : (sw ? 'Bado hakuna majedwali yaliyosainiwa kwa mwezi huu.' : 'No signed timesheets for this month yet.')}</Empty>
            )}
            {data.regions.some((region) => region.included && region.signed) && (
              <ul className="fin-signed-list">
                {data.regions.filter((region) => region.included && region.signed).map((region) => (
                  <li key={region.id}>
                    <span className="badge badge-success">{sw ? 'Imesainiwa' : 'Signed'}</span>
                    <span>
                      <strong>{region.name}:</strong> {sw
                        ? `imesainiwa na ${region.approved_by_name} tarehe ${dateOnly(region.approved_at)} · watoa huduma ${num(region.providers)}`
                        : `signed by ${region.approved_by_name} on ${dateOnly(region.approved_at)} · ${num(region.providers)} providers`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.regions.filter((region) => region.included && !region.signed).map((region) => (
              <Alert key={region.id} kind="warn">
                <strong>{region.name}:</strong> {sw ? 'Fedha ya Mkoa bado haijasaini ripoti ya Mshahara, kwa hiyo majedwali yake hayamo kwenye faili.' : 'Regional Finance has not signed the Payroll report yet, so its timesheets are not in the file.'}
              </Alert>
            ))}
            {data.regions.filter((region) => region.included && region.providers_without_cso > 0).map((region) => (
              <Alert key={region.id} kind="warn">
                <strong>{region.name}:</strong> {sw
                  ? `watoa huduma ${num(region.providers_without_cso)} waliosaini hawana CSO kwenye kituo chao, kwa hiyo hawamo kwenye faili hili. Weka CSO, kisha thibitisha tena idhini.`
                  : `${num(region.providers_without_cso)} signed ${region.providers_without_cso === 1 ? 'provider has' : 'providers have'} no CSO on their placement, so they are not in this file. Set the CSO, then re-confirm the sign-off.`}
              </Alert>
            ))}
            {data.missing_salary.length > 0 && (
              <Alert kind="warn">
                <strong>{sw ? 'Hakuna kiasi cha mshahara' : 'No salary amount'} ({num(data.missing_salary.length)}):</strong> {nameList(data.missing_salary, sw)}. {sw ? 'Hakimo kwenye jumla; muombe Fedha Kuu akiweke.' : 'Not in the total; ask Central Finance to set it.'}
              </Alert>
            )}
            {data.missing_bank.length > 0 && (
              <Alert kind="warn">
                <strong>{sw ? 'Taarifa za benki hazipo' : 'Bank details missing'} ({num(data.missing_bank.length)}):</strong> {nameList(data.missing_bank, sw)}. {sw ? 'Pata taarifa zao kabla ya kulipa.' : 'Get their details before paying.'}
              </Alert>
            )}
            {data.not_signed.length > 0 && (
              <Alert kind="warn">
                <strong>{sw ? 'Mtoa huduma hajasaini' : 'Not signed by the provider'} ({num(data.not_signed.length)}):</strong> {nameList(data.not_signed, sw)}. {sw ? 'Hakuna mshahara unaoonyeshwa kwao.' : 'No salary is shown for them.'}
              </Alert>
            )}
            {data.holidays.length > 0 && (
              <p className="fin-footnote">{sw ? 'Sikukuu za umma mwezi huu' : 'Public holidays in this month'}: {data.holidays.map((day) => `${dateOnly(day.date)} ${day.name_en}`).join(' · ')}</p>
            )}
            <Alert>{download.error}</Alert>
            {data.providers.length > 0 && <ProviderList key={`${month}-${regionId}-${setting}`} rows={data.providers} sw={sw} />}
            <p className="fin-footnote">{sw
              ? 'PDF: ukurasa mmoja wa jedwali kwa kila mtoa huduma (mahudhurio na jumla za shughuli za mwezi), kisha fomu ya malipo mwishoni. CSV: mstari mmoja kwa kila mtoa huduma wenye mshahara, taarifa za benki na masaa ya kila siku. Hifadhi faili hizi kwa siri, na fungua safu ya namba ya akaunti kama maandishi ili lahajedwali zisibadilishe namba.'
              : 'PDF: one timesheet page per provider (attendance and the month\'s activity totals), then the payment form as the last pages. CSV: one row per provider with salary, bank details and hours for each day. Keep these files private, and open the bank account column as text so spreadsheets do not change the numbers.'}</p>
          </div>
        )}
      </AsyncState>
    </Section>
  );
}
