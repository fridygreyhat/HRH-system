import React, { useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { humanize, money, routeLabel } from '../../format';
import { useAction, useApi } from '../../hooks';
import { ClaimCategory, ClaimDetail, ClaimPreview, EligibleWorkLog, PayPeriod, RateRule, StaffSummary } from '../../types';
import { Alert, Drawer, Field, RouteBadge, Tabs } from '../ui';
import { ComponentsTable } from './ClaimDrawer';
import { RegionalFinanceNextSteps } from './RegionalFinanceNextSteps';

type Mode = 'worklog' | 'community';

const PERIOD_STATUS_LABELS_SW: Record<string, string> = { OPEN: 'Wazi', CLOSED: 'Kimefungwa', ARCHIVED: 'Kimehifadhiwa' };

interface PaymentRouteRow {
  id: number;
  code: string;
  name: string;
}

/** The units a claim without a work log must declare, derived from the category's ACTIVE rate rules. */
function declaredKeys(rules: RateRule[], categoryId: number, sw: boolean): { key: string; label: string }[] {
  const keys = new Map<string, string>();
  rules
    .filter((r) => r.category_id === categoryId && r.status === 'ACTIVE')
    .forEach((r) => {
      if (r.unit_type === 'PER_DAY') keys.set('days', sw ? 'Siku za huduma' : 'Days of service');
      else if (r.unit_type === 'PER_HOUR') keys.set('hours', sw ? 'Masaa ya huduma' : 'Hours of service');
      else if (r.unit_type === 'PER_UNIT' && r.measure_key) keys.set(r.measure_key, `${r.component_name} (${humanize(r.measure_key)})`);
    });
  return Array.from(keys, ([key, text]) => ({ key, label: text }));
}

/**
 * Prepare a claim. The server preview (route, payor, executor, components, exceptions) is always shown
 * before the claim is created.
 */
export function CreateClaim(props: { onClose: () => void; onCreated: (claim: ClaimDetail) => void }) {
  const { hasRole, lang } = useAuth();
  if (hasRole('REGIONAL_FINANCE') && !hasRole('SUPER_ADMIN')) {
    return (
      <Drawer title={lang === 'sw' ? 'Fedha ya Mkoa' : 'Regional Finance'} onClose={props.onClose}>
        <RegionalFinanceNextSteps />
      </Drawer>
    );
  }
  return <LegacyCreateClaim {...props} />;
}

function LegacyCreateClaim({ onClose, onCreated }: { onClose: () => void; onCreated: (claim: ClaimDetail) => void }) {
  const { hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const [mode, setMode] = useState<Mode>('worklog');
  const categories = useApi<ClaimCategory[]>('/admin/claim-categories');
  const routes = useApi<PaymentRouteRow[]>('/admin/payment-routes');
  const eligible = useApi<EligibleWorkLog[]>(mode === 'worklog' ? '/claims/eligible-worklogs' : null);
  const staff = useApi<StaffSummary[]>(mode === 'community' ? '/staff?status=ACTIVE' : null);
  const periods = useApi<PayPeriod[]>(mode === 'community' ? '/admin/pay-periods' : null);
  const rules = useApi<RateRule[]>(mode === 'community' ? '/admin/rate-rules' : null);

  const [workLogId, setWorkLogId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [periodId, setPeriodId] = useState('');
  const [evidence, setEvidence] = useState('');
  const [units, setUnits] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  const previewAction = useAction();
  const createAction = useAction();

  const routeCode = (c: ClaimCategory) => routes.data?.find((r) => r.id === c.route_id)?.code || null;
  const active = (categories.data || []).filter((c) => c.is_active);
  const log = eligible.data?.find((l) => String(l.id) === workLogId);
  const categoryOptions =
    mode === 'worklog' ? active.filter((c) => !log || !log.claimed_category_ids.includes(c.id)) : active.filter((c) => !c.requires_work_log);
  const unitFields = useMemo(() => (categoryId && rules.data ? declaredKeys(rules.data, Number(categoryId), sw) : []), [categoryId, rules.data, sw]);

  const reset = () => setPreview(null);
  const body = () =>
    mode === 'worklog'
      ? { category_id: Number(categoryId), work_log_id: Number(workLogId) }
      : {
          category_id: Number(categoryId),
          staff_id: Number(staffId),
          period_id: Number(periodId),
          evidence_text: evidence.trim(),
          declared_units: Object.fromEntries(
            unitFields.filter((f) => units[f.key] !== undefined && units[f.key] !== '').map((f) => [f.key, Number(units[f.key])]),
          ),
        };

  const ready =
    !!categoryId && (mode === 'worklog' ? !!workLogId : !!staffId && !!periodId && evidence.trim().length >= 3 && unitFields.every((f) => units[f.key] !== undefined && units[f.key] !== ''));

  const runPreview = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await previewAction.run(() => api.post<ClaimPreview>('/claims/preview', body()));
    if (result) setPreview(result);
  };
  const create = async () => {
    const result = await createAction.run(() => api.post<ClaimDetail>('/claims', body()));
    if (result) onCreated(result);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setCategoryId('');
    setPreview(null);
    previewAction.setError(null);
    createAction.setError(null);
  };

  const currency = preview?.components[0]?.currency || 'TZS';
  const loadError = categories.error || routes.error || eligible.error || staff.error || periods.error || rules.error;

  return (
    <Drawer title={sw ? 'Andaa dai' : 'Prepare a claim'} onClose={onClose} wide>
      <div className="stack-lg">
        <Tabs
          label={sw ? 'Chanzo cha dai' : 'Claim source'}
          value={mode}
          onChange={switchMode}
          tabs={[
            { key: 'worklog', label: sw ? 'Kutoka kumbukumbu ya kazi iliyoidhinishwa' : 'From an approved work log' },
            { key: 'community', label: sw ? 'Dai la jamii (bila kumbukumbu ya kazi)' : 'Community claim (no work log)' },
          ]}
        />
        <Alert>{loadError}</Alert>
        <form className="stack" onSubmit={runPreview}>
          {mode === 'worklog' ? (
            <div className="grid-2">
              <Field label={sw ? 'Kumbukumbu ya kazi iliyoidhinishwa' : 'Approved work log'} hint={sw ? 'Kumbukumbu za kazi ZILIZOIDHINISHWA unazoweza kuona ndizo pekee zinazoorodheshwa.' : 'Only APPROVED work logs you can see are listed.'}>
                <select
                  required
                  value={workLogId}
                  onChange={(e) => {
                    setWorkLogId(e.target.value);
                    setCategoryId('');
                    reset();
                  }}
                >
                  <option value="">{eligible.loading ? (sw ? 'Inapakia…' : 'Loading…') : (sw ? 'Chagua kumbukumbu ya kazi' : 'Choose a work log')}</option>
                  {(eligible.data || []).map((l) => (
                    <option key={l.id} value={l.id}>
                      #{l.id} · {l.staff_name} · {l.period_label}
                      {l.claimed_category_ids.length ? (sw ? ` (tayari kuna madai ${l.claimed_category_ids.length})` : ` (${l.claimed_category_ids.length} claim(s) already)`) : ''}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={sw ? 'Kategoria ya dai' : 'Claim category'} hint={sw ? 'Kategoria ambazo tayari zimedaiwa kwa kumbukumbu hii zimefichwa.' : 'Categories already claimed for this work log are hidden.'}>
                <select
                  required
                  value={categoryId}
                  disabled={!workLogId}
                  onChange={(e) => {
                    setCategoryId(e.target.value);
                    reset();
                  }}
                >
                  <option value="">{sw ? 'Chagua kategoria' : 'Choose a category'}</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} {routeCode(c) ? `(${routeLabel(routeCode(c), lang)})` : (sw ? '(hakuna njia ya malipo iliyowekwa)' : '(no payment route configured)')}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : (
            <>
              <div className="grid-2">
                <Field label={sw ? 'Kategoria ya dai' : 'Claim category'} hint={sw ? 'Kategoria zisizohitaji kumbukumbu ya kazi ya HRH pekee.' : 'Only categories that do not require an HRH work log.'}>
                  <select
                    required
                    value={categoryId}
                    onChange={(e) => {
                      setCategoryId(e.target.value);
                      setUnits({});
                      reset();
                    }}
                  >
                    <option value="">{sw ? 'Chagua kategoria' : 'Choose a category'}</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {routeCode(c) ? `(${routeLabel(routeCode(c), lang)})` : (sw ? '(hakuna njia ya malipo iliyowekwa)' : '(no payment route configured)')}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={sw ? 'Mtumishi' : 'Staff member'}>
                  <select
                    required
                    value={staffId}
                    onChange={(e) => {
                      setStaffId(e.target.value);
                      reset();
                    }}
                  >
                    <option value="">{staff.loading ? (sw ? 'Inapakia…' : 'Loading…') : (sw ? 'Chagua mtumishi' : 'Choose a staff member')}</option>
                    {(staff.data || []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.legal_name} · {s.cadre}
                        {s.current_assignment?.community_area ? ` · ${s.current_assignment.community_area}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={sw ? 'Kipindi' : 'Period'}>
                  <select
                    required
                    value={periodId}
                    onChange={(e) => {
                      setPeriodId(e.target.value);
                      reset();
                    }}
                  >
                    <option value="">{sw ? 'Chagua kipindi' : 'Choose a period'}</option>
                    {(periods.data || []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.period_label || `${p.start_date} – ${p.end_date}`} ({(sw && PERIOD_STATUS_LABELS_SW[p.status]) || humanize(p.status)})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label={sw ? 'Ushahidi wa huduma (lazima)' : 'Evidence of the service (required)'}>
                <textarea
                  rows={3}
                  required
                  minLength={3}
                  maxLength={2000}
                  value={evidence}
                  onChange={(e) => {
                    setEvidence(e.target.value);
                    reset();
                  }}
                />
              </Field>
              <p className="notice small">{sw ? 'Usiandike majina ya wagonjwa, namba za utambulisho, namba za simu au taarifa zinazomtambulisha mteja.' : 'Do not enter patient names, ID numbers, phone numbers or identifiable case details.'}</p>
              {categoryId && (
                <fieldset>
                  <legend>{sw ? 'Vipimo vilivyotangazwa' : 'Declared units'}</legend>
                  {rules.loading && <p className="muted">{sw ? 'Inapakia kanuni za viwango…' : 'Loading rate rules…'}</p>}
                  {!rules.loading && unitFields.length === 0 && (
                    <p className="muted small">{sw ? 'Kanuni za viwango zinazotumika za kategoria hii hazihitaji vipimo vilivyotangazwa (viasi maalum tu), au hakuna kanuni inayotumika.' : "This category's active rate rules need no declared units (fixed amounts only), or no rule is active."}</p>
                  )}
                  <div className="grid-3">
                    {unitFields.map((f) => (
                      <Field key={f.key} label={f.label}>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          required
                          value={units[f.key] ?? ''}
                          onChange={(e) => {
                            setUnits({ ...units, [f.key]: e.target.value });
                            reset();
                          }}
                        />
                      </Field>
                    ))}
                  </div>
                </fieldset>
              )}
            </>
          )}
          <Alert>{previewAction.error}</Alert>
          <div className="row">
            <button className="btn btn-secondary" disabled={!ready || previewAction.busy}>
              {previewAction.busy ? (sw ? 'Inakokotoa…' : 'Calculating…') : (sw ? 'Angalia ukokotoaji' : 'Preview calculation')}
            </button>
          </div>
        </form>

        {preview && (
          <section className="card stack" aria-live="polite">
            <h3>{sw ? 'Muhtasari – bado hakuna kilichoundwa' : 'Preview – nothing has been created yet'}</h3>
            <div className="badges">
              <RouteBadge route={preview.route_code} />
            </div>
            <dl className="facts">
              <div>
                <dt>{sw ? 'Mlipaji' : 'Payor'}</dt>
                <dd>{preview.payor_name || '—'}</dd>
              </div>
              <div>
                <dt>{sw ? 'Mtekelezaji (analipa)' : 'Executor (pays)'}</dt>
                <dd>{preview.executor_name || '—'}</dd>
              </div>
              <div>
                <dt>{sw ? 'Kifungu cha bajeti' : 'Budget line'}</dt>
                <dd>{preview.budget_line_id ? `#${preview.budget_line_id}` : (sw ? 'Hakijapatikana' : 'Not found')}</dd>
              </div>
              <div>
                <dt>{sw ? 'Jumla' : 'Total'}</dt>
                <dd>{money(preview.amount, currency)}</dd>
              </div>
            </dl>
            <ComponentsTable components={preview.components} currency={currency} />
            {preview.exceptions.length > 0 && (
              <div className="alert alert-warn" role="status">
                <strong>{sw ? 'Dosari:' : 'Exceptions:'}</strong> {sw ? 'dai linaweza kuundwa lakini litahitaji uhakiki kabla ya kuwasilishwa.' : 'the claim can be created but will need validation before it can be submitted.'}
                <ul>
                  {preview.exceptions.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview.route_code === 'C' && hasRole('FHI360_FINANCE') && !hasRole('CSO_FINANCE') && (
              <Alert kind="info">{sw ? 'Malipo ya jamii ya CSO yanaandaliwa na watumishi wa fedha wa CSO husika.' : "CSO community payments are prepared by the assigned CSO's finance staff."}</Alert>
            )}
            {preview.route_code && preview.route_code !== 'C' && !hasRole('FHI360_FINANCE') && (
              <Alert kind="info">{sw ? `Madai ya ${routeLabel(preview.route_code, lang)} yanaandaliwa na Fedha ya FHI360.` : `${routeLabel(preview.route_code)} claims are prepared by FHI360 Finance.`}</Alert>
            )}
            <Alert>{createAction.error}</Alert>
            <div className="row">
              <button className="btn btn-primary" disabled={createAction.busy} onClick={create}>
                {createAction.busy ? (sw ? 'Inaunda…' : 'Creating…') : (sw ? 'Unda dai' : 'Create claim')}
              </button>
              <button className="btn btn-ghost" onClick={onClose} disabled={createAction.busy}>
                {sw ? 'Ghairi' : 'Cancel'}
              </button>
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}
