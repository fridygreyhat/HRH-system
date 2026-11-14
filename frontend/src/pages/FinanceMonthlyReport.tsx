import React, { useEffect, useMemo, useState } from 'react';
import { api, qs, saveBlob } from '../api';
import { useAuth } from '../AuthContext';
import { Alert, AsyncState, Field, KpiStrip, Modal } from '../components/ui';
import { todayLocal, num, payMonth, payMonthDates, previousMonth, workHours } from '../format';
import { useApi } from '../hooks';
import { Named } from '../types';
import { SignoffItem, signoffTarget } from '../signoffs';
import './finance-monthly-report.css';
import './polish-finance.css';

type WorkType = 'PAYROLL' | 'SERVICES';
interface IndicatorTotal {
  key: string;
  label: string;
  total: string;
}
interface MonthlyProvider {
  staff_id: number;
  provider_name: string;
  cadre_code: string;
  cadre_name: string;
  facility_name: string;
  region_name: string;
  days: number;
  hours: string;
  indicators: IndicatorTotal[];
}
interface MonthlyCadre {
  code: string;
  name: string;
  provider_count: number;
  days: number;
  hours: string;
  indicators: IndicatorTotal[];
}
interface MonthlySummary {
  month: string;
  work_type: WorkType;
  totals: { providers: number; days: number; hours: string; logs: number };
  providers: MonthlyProvider[];
  cadres: MonthlyCadre[];
}
interface Approval {
  id: number;
  month: string;
  region_id: number;
  region_name: string;
  work_type: WorkType;
  approved_at: string;
  approved_by_name: string;
}
interface MonthlyReportResponse {
  state: 'NOT_APPROVED' | 'APPROVED';
  approval: Approval | null;
  can_approve: boolean;
  stale: boolean;
  digest: string | null;
  report: MonthlySummary;
  /** Swahili indicator names, sent beside the report so the signed digest is unchanged. */
  labels_sw?: Record<string, string>;
}

/** Report wording in the reader's language: indicator and cadre names from the server stay English unless a Swahili name is known. */
interface Words {
  sw: boolean;
  indicator: (indicator: IndicatorTotal) => string;
  cadre: (cadre: { code: string; name: string }) => string;
}

const CADRE_SW: Record<string, string> = {
  CHW: 'Mhudumu wa Afya Ngazi ya Jamii',
  HCP: 'Mtoa Huduma za Afya',
  DATA_CLERK: 'Karani wa Takwimu',
};

const monthName = (month: string, sw = false) => {
  const date = new Date(`${month}-01T00:00:00`);
  return Number.isNaN(date.getTime()) ? month : new Intl.DateTimeFormat(sw ? 'sw' : 'en', { month: 'long', year: 'numeric' }).format(date);
};

const PAGE_SIZE = 10;

function parseTarget(target?: string) {
  const match = /^(\d{4}-\d{2}):(PAYROLL|SERVICES):(\d+)$/.exec(target || '');
  return match ? { month: match[1], workType: match[2] as WorkType, regionId: match[3] } : null;
}

/** Payroll and Services are signed separately, and only the signed Payroll report reaches the CSO. */
function SignoffChecklist({ items, selected, onOpen, sw }: {
  items: SignoffItem[]; selected: string; onOpen: (item: SignoffItem) => void; sw: boolean;
}) {
  const waiting = items.filter((item) => item.state !== 'SIGNED');
  return (
    <section className={`card signoff-checklist${waiting.length ? ' has-waiting' : ''}`} aria-labelledby="signoff-checklist-heading">
      <div className="section-title">
        <h2 id="signoff-checklist-heading">{sw ? 'Ripoti za kusaini' : 'Reports to sign'}</h2>
        <span className={`badge ${waiting.length ? 'badge-warn' : 'badge-success'}`}>
          {waiting.length ? (sw ? `${num(waiting.length)} zinasubiri` : `${num(waiting.length)} waiting`) : (sw ? 'Zote zimesainiwa' : 'All signed')}
        </span>
      </div>
      <p className="muted small">
        {sw
          ? 'Saini Mshahara na Huduma kando kwa kila mkoa. CSO inapokea majedwali ya mishahara pale tu ripoti ya Mshahara inaposainiwa.'
          : 'Sign Payroll and Services separately for each region. The CSO receives the salary timesheets only once the Payroll report is signed.'}
      </p>
      <ul className="signoff-list">
        {items.map((item) => {
          const key = signoffTarget(item);
          const payroll = item.work_type === 'PAYROLL';
          const state = item.state === 'SIGNED'
            ? (sw ? `Imesainiwa na ${item.approved_by_name}` : `Signed by ${item.approved_by_name}`)
            : item.state === 'CHANGED' ? (sw ? 'Imebadilika: saini tena' : 'Changed: sign again') : (sw ? 'Haijasainiwa' : 'Not signed');
          return (
            <li key={key} className={`signoff-item is-${item.state.toLowerCase()}${key === selected ? ' is-selected' : ''}`}>
              <button type="button" onClick={() => onOpen(item)} aria-current={key === selected ? 'true' : undefined}>
                <span className="signoff-item-text">
                  <strong>{monthName(item.month, sw)} · {payroll ? (sw ? 'Mshahara' : 'Payroll') : (sw ? 'Huduma' : 'Services')} · {item.region_name}</strong>
                  <span className="muted small">
                    {sw ? `Watoa huduma ${num(item.providers)}` : `${num(item.providers)} ${item.providers === 1 ? 'provider' : 'providers'}`}
                    {' · '}
                    {payroll ? (sw ? 'inaenda kwa CSO' : 'goes to the CSO') : (sw ? 'inaenda Fedha Kuu FHI360' : 'goes to FHI360 Finance')}
                  </span>
                </span>
                <span className={`badge ${item.state === 'SIGNED' ? 'badge-success' : 'badge-warn'}`}>{state}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function IndicatorList({ indicators, words }: { indicators: IndicatorTotal[]; words: Words }) {
  if (!indicators.length) return <span className="muted">{words.sw ? 'Hakuna viashiria vilivyorekodiwa' : 'No indicators recorded'}</span>;
  return (
    <dl className="finance-indicators">
      {indicators.map((indicator) => (
        <div key={indicator.key}>
          <dt>{words.indicator(indicator)}</dt>
          <dd>{num(indicator.total)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ProviderGroup({
  cadre,
  providers,
  words,
}: {
  cadre: MonthlyCadre;
  providers: MonthlyProvider[];
  words: Words;
}) {
  const { sw } = words;
  const name = words.cadre(cadre);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    if (!term) return providers;
    return providers.filter((provider) =>
      [provider.provider_name, provider.facility_name, provider.region_name]
        .some((value) => value.toLocaleLowerCase().includes(term)),
    );
  }, [providers, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const groupId = `providers-${cadre.code.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

  return (
    <section className="finance-provider-group" aria-labelledby={`${groupId}-heading`}>
      <header className="finance-provider-group-heading">
        <div>
          <p className="finance-overview-kicker">{cadre.code}</p>
          <h3 id={`${groupId}-heading`}>{name}</h3>
          <p className="finance-group-total-note">
            {sw
              ? `Watoa huduma ${num(cadre.provider_count)} · siku ${num(cadre.days)} · masaa ${workHours(cadre.hours)}`
              : `${num(cadre.provider_count)} providers · ${num(cadre.days)} days · ${workHours(cadre.hours)} hours`}
            <span>{sw ? 'Jumla za kada hazibadiliki unapotafuta kwenye orodha hii.' : 'Cadre totals stay fixed when this list is searched.'}</span>
          </p>
        </div>
        <div className="finance-group-indicators">
          <span className="finance-group-label">{sw ? 'Jumla ya viashiria' : 'Aggregate indicators'}</span>
          <IndicatorList indicators={cadre.indicators} words={words} />
        </div>
      </header>
      <div className="finance-provider-tools">
        <label htmlFor={`${groupId}-search`}>{sw ? 'Tafuta mtoa huduma au kituo' : 'Find a provider or placement'}</label>
        <input
          id={`${groupId}-search`}
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(0); }}
          placeholder={sw ? 'Jina, kituo au mkoa' : 'Name, facility or region'}
          aria-controls={`${groupId}-list`}
        />
        <span className="finance-provider-count" aria-live="polite">
          {filtered.length ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} ${sw ? 'kati ya' : 'of'} ${filtered.length}` : '0'} {sw ? `zinaonyeshwa · ${num(cadre.provider_count)} kwenye kada` : `shown · ${num(cadre.provider_count)} in cadre`}
        </span>
      </div>
      {shown.length ? (
        <ul className="finance-provider-list" id={`${groupId}-list`}>
          {shown.map((provider) => (
            <li key={`${provider.staff_id}-${provider.cadre_code}-${provider.facility_name}-${provider.region_name}`}>
              <div className="finance-provider-identity">
                <strong>{provider.provider_name}</strong>
                <span>{provider.facility_name || (sw ? 'Kituo hakijatajwa' : 'Facility not specified')} <i aria-hidden="true">·</i> {provider.region_name || (sw ? 'Mkoa haujatajwa' : 'Region not specified')}</span>
              </div>
              <div className="finance-provider-metrics">
                <span><small>{sw ? 'Siku' : 'Days'}</small><strong>{num(provider.days)}</strong></span>
                <span><small>{sw ? 'Masaa' : 'Hours'}</small><strong>{workHours(provider.hours)}</strong></span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="finance-provider-no-results" role="status">{sw ? `Hakuna mtoa huduma anayelingana na “${query}” kwenye kada hii.` : `No providers match “${query}” in this cadre.`}</p>
      )}
      {filtered.length > PAGE_SIZE && (
        <nav className="finance-pagination" aria-label={sw ? `Kurasa za watoa huduma: ${name}` : `${name} provider pages`}>
          <span>{sw ? `Ukurasa ${currentPage + 1} kati ya ${pageCount}` : `Page ${currentPage + 1} of ${pageCount}`}</span>
          <div>
            <button type="button" className="btn btn-secondary" onClick={() => setPage(Math.max(0, currentPage - 1))} disabled={currentPage === 0} aria-label={sw ? `Watoa huduma waliotangulia: ${name}` : `Previous ${name} providers`}>{sw ? 'Iliyotangulia' : 'Previous'}</button>
            <button type="button" className="btn btn-secondary" onClick={() => setPage(Math.min(pageCount - 1, currentPage + 1))} disabled={currentPage >= pageCount - 1} aria-label={sw ? `Watoa huduma wanaofuata: ${name}` : `Next ${name} providers`}>{sw ? 'Inayofuata' : 'Next'}</button>
          </div>
        </nav>
      )}
    </section>
  );
}

export function FinanceMonthlyReport({ initial }: { initial?: string } = {}) {
  const opened = parseTarget(initial);
  // Finance signs a month after it ends on the 25th, so open on the last finished month, as batch print does.
  const [month, setMonth] = useState(() => opened?.month || previousMonth(payMonth(todayLocal())));
  const [workType, setWorkType] = useState<WorkType>(opened?.workType || 'PAYROLL');
  const [regionId, setRegionId] = useState(opened?.regionId || '');
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewReviewed, setPreviewReviewed] = useState(false);
  const [actionError, setActionError] = useState('');
  const [approving, setApproving] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'pdf' | null>(null);
  const regions = useApi<Named[]>('/finance/regions');
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const isCsoOnly = hasRole('CSO_FINANCE') && !hasRole('REGIONAL_FINANCE', 'FHI360_FINANCE', 'SUPER_ADMIN');
  // The CSO receives Payroll only: Services are paid by FHI360 Central Finance.
  useEffect(() => { if (isCsoOnly && workType !== 'PAYROLL') setWorkType('PAYROLL'); }, [isCsoOnly, workType]);
  const signoffs = useApi<SignoffItem[]>(hasRole('REGIONAL_FINANCE') ? '/finance/monthly-report/status' : null);
  const openSignoff = (item: SignoffItem) => {
    setMonth(item.month); setWorkType(item.work_type); setRegionId(String(item.region_id));
  };
  const reportState = useApi<MonthlyReportResponse>(`/finance/monthly-report${qs({ month, region_id: regionId, work_type: workType })}`);
  const summary = {
    data: reportState.data?.report ?? null,
    error: reportState.error,
    loading: reportState.loading,
    reload: reportState.reload,
  };
  const providers = useMemo(() => summary.data?.providers || [], [summary.data]);
  const labelsSw = reportState.data?.labels_sw;
  const words = useMemo<Words>(() => ({
    sw,
    indicator: (indicator) => (sw && labelsSw?.[indicator.key]) || indicator.label,
    cadre: (cadre) => (sw && CADRE_SW[cadre.code]) || cadre.name,
  }), [sw, labelsSw]);
  const workTypeName = workType === 'PAYROLL' ? (sw ? 'Mshahara' : 'Payroll') : (sw ? 'Huduma' : 'Services');
  useEffect(() => { setReviewConfirmed(false); setActionError(''); }, [month, workType, regionId]);
  useEffect(() => {
    setPreviewOpen(false); setPreviewReviewed(false); setReviewConfirmed(false);
  }, [month, workType, regionId, reportState.data?.digest]);
  useEffect(() => {
    if (!regionId && regions.data?.length === 1) setRegionId(String(regions.data[0].id));
  }, [regionId, regions.data]);
  const providerGroups = useMemo(() => {
    const cadres = summary.data?.cadres || [];
    const byCode = new Map(cadres.map((cadre) => [cadre.code, cadre]));
    providers.forEach((provider) => {
      if (!byCode.has(provider.cadre_code)) {
        byCode.set(provider.cadre_code, {
          code: provider.cadre_code,
          name: provider.cadre_name,
          provider_count: providers.filter((item) => item.cadre_code === provider.cadre_code).length,
          days: 0,
          hours: '0',
          indicators: [],
        });
      }
    });
    return Array.from(byCode.values()).map((cadre) => ({
      cadre,
      providers: providers.filter((provider) => provider.cadre_code === cadre.code),
    }));
  }, [summary.data, providers]);

  const download = async (format: 'csv' | 'pdf') => {
    setExporting(format);
    setActionError('');
    try {
      const path = `/finance/monthly-report/export${qs({ month, region_id: regionId, work_type: workType, format })}`;
      saveBlob(await api.blob(path, 'GET', `monthly-report-${month}.${format}`));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : (sw ? 'Ripoti haikuweza kupakuliwa. Jaribu tena.' : 'The report could not be downloaded. Try again.'));
    } finally {
      setExporting(null);
    }
  };

  const approve = async () => {
    if (!regionId || !reportState.data?.digest || !reviewConfirmed || !previewReviewed) return;
    setApproving(true);
    setActionError('');
    try {
      await api.post<MonthlyReportResponse>('/finance/monthly-report/approve', {
        month, region_id: Number(regionId), work_type: workType,
        review_confirmed: true, expected_digest: reportState.data.digest,
      });
      reportState.reload();
      signoffs.reload();
      setReviewConfirmed(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : (sw ? 'Uidhinishaji haukukamilika.' : 'The sign-off could not be completed.');
      setActionError(message);
      if ((error as { status?: number; requiresRefresh?: boolean }).status === 409 || (error as { requiresRefresh?: boolean }).requiresRefresh) {
        reportState.reload();
      }
    } finally {
      setApproving(false);
    }
  };
  const canSignOff = !isCsoOnly && reportState.data?.can_approve;
  const approval = reportState.data?.approval;
  const approvedDate = approval?.approved_at ? new Date(approval.approved_at) : null;

  return (
    <div className="stack-lg finance-monthly">
      <div className="fin-toolbar">
        <h1>{sw ? 'Ripoti ya kazi ya mwezi' : 'Monthly work report'}</h1>
        <div className="filters finance-monthly-filters" role="search" aria-label={sw ? 'Chuja ripoti ya mwezi' : 'Filter monthly report'}>
          <Field label={sw ? 'Mwezi wa malipo' : 'Pay month'} hint={payMonthDates(month)}>
            <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label="Pay month" />
          </Field>
          <Field label={sw ? 'Aina ya kazi' : 'Work type'} hint={isCsoOnly ? (sw ? 'Huduma hulipwa na Fedha Kuu FHI360' : 'Services are paid by FHI360 Central Finance') : undefined}>
            {isCsoOnly ? (
              <select value="PAYROLL" disabled aria-label="Work type">
                <option value="PAYROLL">{sw ? 'Mshahara · kazi iliyoidhinishwa' : 'Payroll · approved work'}</option>
              </select>
            ) : (
              <select value={workType} onChange={(event) => setWorkType(event.target.value as WorkType)} aria-label="Work type">
                <option value="PAYROLL">{sw ? 'Mshahara · kazi iliyoidhinishwa' : 'Payroll · approved work'}</option>
                <option value="SERVICES">{sw ? 'Huduma · mwonekano wa jumla' : 'Services · aggregate view'}</option>
              </select>
            )}
          </Field>
          <Field label={sw ? 'Mkoa' : 'Region'}>
            <select value={regionId} onChange={(event) => setRegionId(event.target.value)} aria-label="Region">
              <option value="">{sw ? 'Mikoa yote niliyopangiwa' : 'All regions in my scope'}</option>
              {(regions.data || []).map((region) => <option key={region.id} value={region.id}>{region.name}</option>)}
            </select>
          </Field>
        </div>
        <div className="fin-actions finance-report-actions">
          <button type="button" className="btn btn-ghost" onClick={() => { summary.reload(); regions.reload(); }} disabled={summary.loading}>{sw ? 'Pakia ripoti upya' : 'Refresh report'}</button>
          <button type="button" className="btn btn-secondary" onClick={() => download('csv')} disabled={!!exporting}>{exporting === 'csv' ? (sw ? 'Inaandaa CSV…' : 'Preparing CSV…') : (sw ? 'Pakua CSV' : 'Download CSV')}</button>
          <button type="button" className="btn btn-secondary" onClick={() => download('pdf')} disabled={!!exporting}>{exporting === 'pdf' ? (sw ? 'Inaandaa PDF…' : 'Preparing PDF…') : (sw ? 'Pakua PDF' : 'Download PDF')}</button>
        </div>
      </div>
      {signoffs.data && signoffs.data.length > 0 && (
        <SignoffChecklist items={signoffs.data} selected={signoffTarget({ month, work_type: workType, region_id: Number(regionId) })} onOpen={openSignoff} sw={sw} />
      )}
      {regions.error && <Alert kind="warn">{sw ? 'Orodha ya mikoa haikupakia. Inaonyesha wigo wako ulioidhinishwa.' : 'Region options could not be loaded. Showing your authorized scope.'} {regions.error}</Alert>}

      {reportState.data && (
        <section className={`finance-signoff ${approval ? 'is-approved' : ''}`} aria-labelledby="finance-signoff-heading">
          <div className="finance-signoff-copy">
            <p className="finance-overview-kicker">{sw ? 'Hali ya hati ya mkoa' : 'Regional document status'}</p>
            <h2 id="finance-signoff-heading">{approval ? (sw ? 'Ripoti imeidhinishwa' : 'Approved report') : (sw ? 'Bado haijaidhinishwa' : 'Not yet approved')}</h2>
            {approval ? (
              <p>{sw ? 'Imesainiwa na' : 'Signed by'} <strong>{approval.approved_by_name}</strong> {sw ? 'kwa' : 'for'} {approval.region_name} · {approvedDate && !Number.isNaN(approvedDate.getTime()) ? approvedDate.toLocaleString(sw ? 'sw' : undefined) : approval.approved_at}
                {workType === 'PAYROLL' && !isCsoOnly && <> · <strong>{sw ? 'Imetumwa kwa CSO' : 'Sent to the CSO'}</strong></>}</p>
            ) : isCsoOnly ? (
              <p>{workType === 'PAYROLL'
                ? (sw ? `Fedha ya Mkoa bado haijasaini ripoti ya Mshahara ya ${monthName(month, sw)}. Majedwali ya mishahara yataonekana hapa na kwenye Malipo ya CSO mara tu itakaposainiwa.` : `Regional Finance has not signed the ${monthName(month)} Payroll report yet. The salary timesheets appear here and in CSO payments as soon as it is signed.`)
                : (sw ? `Fedha ya Mkoa bado haijasaini ripoti ya Huduma ya ${monthName(month, sw)}.` : `Regional Finance has not signed the ${monthName(month)} Services report yet.`)}</p>
            ) : (
              <p>{regionId
                ? (sw ? `Pitia ripoti ya ${workTypeName.toLowerCase()} ya ${monthName(month, sw)} kwa mkoa uliochaguliwa kabla ya kusaini.` : `Review the ${monthName(month)} ${workType.toLowerCase()} report for the selected region before signing.`)
                : (sw ? 'Chagua mkoa mmoja ili kusaini.' : 'Choose one region to sign off.')}</p>
            )}
            {reportState.data.stale && <p className="finance-stale-note" role="status">{sw ? 'Kuna kazi mpya au iliyobadilika baada ya uidhinishaji. Pakia upya na upitie tena.' : 'New or changed work since this sign-off. Refresh and review again.'}</p>}
            {isCsoOnly && <p className="finance-readonly-note">{sw ? 'Mwonekano wa kusoma tu.' : 'Read-only documentation view.'}</p>}
          </div>
          {canSignOff && (
            <div className="finance-signoff-control">
              <button type="button" className="btn btn-secondary" disabled={!regionId || reportState.loading} onClick={() => setPreviewOpen(true)}>{sw ? 'Pitia nakala ya kuchapisha ya idhini' : 'Review approval print preview'}</button>
              <label className="finance-confirm-check">
                <input type="checkbox" checked={reviewConfirmed} disabled={!previewReviewed} onChange={(event) => setReviewConfirmed(event.target.checked)} />
                <span>{sw ? 'Nimepitia ripoti hii ya mkoa na ninaithibitisha kama hati iliyosainiwa.' : 'I reviewed this regional report and confirm it as a document sign-off.'}</span>
              </label>
              <button type="button" className="btn btn-primary" onClick={approve} disabled={!regionId || !previewReviewed || !reviewConfirmed || approving || reportState.loading}>
                {approving ? (sw ? 'Inasaini…' : 'Signing off…') : workType === 'PAYROLL'
                  ? (approval ? (sw ? 'Saini tena na utume kwa CSO' : 'Sign again and send to CSO') : (sw ? 'Saini na utume kwa CSO' : 'Sign and send to CSO'))
                  : approval ? (sw ? 'Thibitisha uidhinishaji uliosasishwa' : 'Confirm updated sign-off') : (sw ? 'Saini ripoti' : 'Sign off report')}
              </button>
            </div>
          )}
          {!isCsoOnly && approval && !canSignOff && <p className="finance-readonly-note">{sw ? 'Ripoti hii iliyoidhinishwa inaonyeshwa kwa kumbukumbu.' : 'This approved report is shown for reference.'}</p>}
        </section>
      )}
      {actionError && <Alert kind="warn">{actionError}</Alert>}
      {previewOpen && summary.data && <Modal title={sw ? 'Ripoti ya mkoa · nakala ya kuchapisha ya idhini' : 'Regional report · approval print preview'} onClose={() => setPreviewOpen(false)}>
        <article className="paper regional-approval-preview">
          <h1>{monthName(month, sw)} · {workTypeName} · {regions.data?.find(region => String(region.id) === regionId)?.name}</h1>
          <p>{sw
            ? `Watoa huduma ${num(summary.data.totals.providers)} · siku za kazi ${num(summary.data.totals.days)} · masaa ${workHours(summary.data.totals.hours)}`
            : `${num(summary.data.totals.providers)} providers · ${num(summary.data.totals.days)} work days · ${workHours(summary.data.totals.hours)} hours`}</p>
          {providerGroups.map(({ cadre, providers: rows }) => <section key={cadre.code}>
            <h2>{words.cadre(cadre)}</h2>
            <p>{sw ? `Siku ${num(cadre.days)} · masaa ${workHours(cadre.hours)}` : `${num(cadre.days)} days · ${workHours(cadre.hours)} hours`}</p>
            <IndicatorList indicators={cadre.indicators} words={words} />
            <table>
              <thead><tr><th>{sw ? 'Mtoa huduma' : 'Provider'}</th><th>{sw ? 'Kituo' : 'Facility'}</th><th>{sw ? 'Siku' : 'Days'}</th><th>{sw ? 'Masaa' : 'Hours'}</th><th>{sw ? 'Viashiria' : 'Indicators'}</th></tr></thead>
              <tbody>{rows.map(provider => <tr key={provider.staff_id}>
                <td>{provider.provider_name}</td><td>{provider.facility_name}</td><td>{num(provider.days)}</td><td>{workHours(provider.hours)}</td>
                <td><IndicatorList indicators={provider.indicators} words={words} /></td>
              </tr>)}</tbody>
            </table>
          </section>)}
        </article>
        <div className="row">
          <button className="btn btn-secondary" onClick={() => download('pdf')} disabled={!!exporting}>{sw ? 'Pakua PDF ya kuchapisha' : 'Download printable PDF'}</button>
          <button className="btn btn-primary" onClick={() => { setPreviewReviewed(true); setPreviewOpen(false); }}>{sw ? 'Nimepitia nakala hii' : 'I have reviewed this preview'}</button>
        </div>
      </Modal>}

      {summary.error ? (
        <div className="stack">
          <Alert>{summary.error}</Alert>
          <div><button type="button" className="btn btn-secondary" onClick={summary.reload}>{sw ? 'Jaribu tena' : 'Try again'}</button></div>
        </div>
      ) : (
        <AsyncState
          data={summary.data}
          error={null}
          loading={summary.loading}
          isEmpty={(data) => data.providers.length === 0}
          empty={<div className="finance-monthly-empty"><span className="finance-empty-month">{month}</span><div>
            <strong>{sw ? 'Hakuna kazi iliyoidhinishwa mwezi huu' : 'No approved work in this month'}</strong>
            <p>{sw ? 'Jaribu mwezi au mkoa mwingine.' : 'Try another month or region.'}</p>
          </div></div>}
        >
          {(data) => (
            <div className="stack-lg" aria-live="polite">
              <div className="stack">
                <div className="section-title">
                  <h2>{monthName(data.month, sw)}</h2>
                  <span>{data.work_type === 'PAYROLL' ? (sw ? 'Kazi ya mshahara iliyoidhinishwa' : 'Approved payroll work') : (sw ? 'Shughuli za huduma' : 'Services activity')}</span>
                </div>
                <KpiStrip
                  label={sw ? `Jumla za ripoti ya ${monthName(data.month, sw)}` : `${monthName(data.month)} report totals`}
                  items={[
                    { label: sw ? 'Watoa huduma' : 'Providers', value: num(data.totals.providers), icon: 'users' },
                    { label: sw ? 'Jumla ya masaa' : 'Total hours', value: workHours(data.totals.hours), icon: 'clock', tone: 'info' },
                    { label: sw ? 'Siku za kazi' : 'Work days', value: num(data.totals.days), icon: 'calendar', tone: 'info' },
                    { label: sw ? 'Majedwali yaliyoidhinishwa' : 'Approved logs', value: num(data.totals.logs), icon: 'check', tone: 'success' },
                  ]}
                />
              </div>

              <section className="finance-cadre-section" aria-labelledby="cadre-totals-heading">
                <div className="finance-section-heading">
                  <div><h2 id="cadre-totals-heading">{sw ? 'Jumla kwa kada' : 'Cadre totals'}</h2></div>
                  <span>{sw ? `Kada ${data.cadres.length} kwenye wigo` : `${data.cadres.length} cadres in scope`}</span>
                </div>
                <div className="table-wrap finance-report-table-wrap">
                  <table className="finance-report-table finance-cadre-table">
                    <thead><tr><th>{sw ? 'Kada' : 'Cadre'}</th><th className="num">{sw ? 'Watoa huduma' : 'Providers'}</th><th className="num">{sw ? 'Siku' : 'Days'}</th><th className="num">{sw ? 'Masaa' : 'Hours'}</th><th>{sw ? 'Jumla ya viashiria' : 'Aggregate indicators'}</th></tr></thead>
                    <tbody>{data.cadres.map((cadre) => (
                      <tr key={cadre.code}>
                        <th scope="row"><strong>{words.cadre(cadre)}</strong><span className="finance-subline">{cadre.code}</span></th>
                        <td className="num">{num(cadre.provider_count)}</td>
                        <td className="num">{num(cadre.days)}</td>
                        <td className="num finance-hours">{workHours(cadre.hours)}</td>
                        <td><IndicatorList indicators={cadre.indicators} words={words} /></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>

              <section className="finance-provider-section" aria-labelledby="provider-totals-heading">
                <div className="finance-section-heading">
                  <div><h2 id="provider-totals-heading">{sw ? 'Watoa huduma kwa kada' : 'Providers by cadre'}</h2></div>
                  <span>{sw ? `Kada ${providerGroups.length} · watoa huduma ${num(data.totals.providers)}` : `${providerGroups.length} cadres · ${num(data.totals.providers)} providers`}</span>
                </div>
                <div className="finance-provider-groups">
                  {providerGroups.map(({ cadre, providers: cadreProviders }) => (
                    <ProviderGroup key={`${month}-${workType}-${cadre.code}`} cadre={cadre} providers={cadreProviders} words={words} />
                  ))}
                </div>
              </section>
            </div>
          )}
        </AsyncState>
      )}
    </div>
  );
}
