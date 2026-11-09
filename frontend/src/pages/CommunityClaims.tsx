import React, { useState } from 'react';
import { api, qs } from '../api';
import { useAuth } from '../AuthContext';
import { ClaimDrawer, ComponentsTable } from '../components/claims/ClaimDrawer';
import { Alert, AsyncState, Field, RouteBadge, StatusBadge } from '../components/ui';
import { dateTime, humanize, money } from '../format';
import { useAction, useApi } from '../hooks';
import { ClaimComponent, ClaimDetail, ClaimSummary, CommunityClaimOptions, CommunityClaimPreview } from '../types';

const UNIT_TYPE_HINTS_SW: Record<string, string> = { PER_DAY: 'kwa siku', PER_HOUR: 'kwa saa', PER_UNIT: 'kwa kipimo' };

function capturedUnitFields(components: ClaimComponent[], sw: boolean): { key: string; label: string; unit_type: string }[] {
  const fields = new Map<string, { key: string; label: string; unit_type: string }>();
  components.forEach((component) => {
    if (component.unit_type === 'PER_DAY') fields.set('days', { key: 'days', label: sw ? 'Siku za huduma' : 'Days of service', unit_type: component.unit_type });
    if (component.unit_type === 'PER_HOUR') fields.set('hours', { key: 'hours', label: sw ? 'Masaa ya huduma' : 'Hours of service', unit_type: component.unit_type });
    if (component.unit_type === 'PER_UNIT' && component.measure_key) {
      fields.set(component.measure_key, {
        key: component.measure_key,
        label: component.component_name || humanize(component.measure_key),
        unit_type: component.unit_type,
      });
    }
  });
  return Array.from(fields.values());
}

export function CommunityClaims() {
  const { hasRole, me, lang } = useAuth();
  const sw = lang === 'sw';
  const provider = hasRole('PROVIDER');
  const [periodId, setPeriodId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [units, setUnits] = useState<Record<string, string>>({});
  const [description, setDescription] = useState('');
  const [editing, setEditing] = useState<ClaimDetail | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<CommunityClaimPreview | null>(null);
  const options = useApi<CommunityClaimOptions>(provider && !editing ? `/community-claims/options${qs({ period_id: periodId })}` : null);
  const claims = useApi<ClaimSummary[]>(`/claims${qs({ work_type: 'COMMUNITY' })}`);
  const previewAction = useAction();
  const saveAction = useAction();
  const categories = editing ? [] : options.data?.categories || [];
  const selectedCategory = categories.find((c) => String(c.id) === categoryId);
  const editUnitFields = editing ? capturedUnitFields(editing.components || [], sw) : [];
  const unitFields = editing ? editUnitFields : selectedCategory?.unit_fields || [];

  const reload = () => claims.reload();
  const refresh = () => {
    claims.reload();
    options.reload();
  };
  const resetPreview = () => setPreview(null);
  const body = () => ({
    period_id: Number(periodId),
    category_id: Number(categoryId),
    declared_units: Object.fromEntries(unitFields.map((field) => [field.key, Number(units[field.key])])),
    description: description.trim() || null,
  });
  const previewClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await previewAction.run(() => api.post<CommunityClaimPreview>('/community-claims/preview', body()));
    if (result) setPreview(result);
  };
  const createClaim = async () => {
    const result = await saveAction.run(() => api.post<ClaimDetail>('/community-claims', body()));
    if (result) {
      setNotice(sw ? `Dai #${result.id} limehifadhiwa kama rasimu. Liwasilishe ukiwa tayari.` : `Claim #${result.id} saved as a draft. Submit it when you are ready.`);
      setPreview(null);
      setUnits({});
      setDescription('');
      reload();
      setOpenId(result.id);
    }
  };
  const loadForEdit = async (id: number) => {
    const detail = await saveAction.run(() => api.get<ClaimDetail>(`/claims/${id}`));
    if (!detail) return;
    setEditing(detail);
    setPeriodId(String(detail.period_id));
    setCategoryId(String(detail.category_id || ''));
    setUnits(Object.fromEntries(Object.entries(detail.declared_units || {}).map(([key, value]) => [key, String(value)])));
    setDescription(detail.description || detail.evidence_text || '');
    setPreview(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const updateClaim = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    const result = await saveAction.run(() => api.put<ClaimDetail>(`/community-claims/${editing.id}`, {
      declared_units: body().declared_units,
      description: body().description,
    }));
    if (result) {
      setNotice(sw ? `Rasimu #${result.id} imesasishwa. Viwango vilivyorekodiwa awali vinabaki.` : `Draft #${result.id} updated. Its captured rate snapshot is retained.`);
      setEditing(null);
      setPeriodId('');
      setCategoryId('');
      setUnits({});
      setDescription('');
      resetPreview();
      reload();
    }
  };
  const startNew = () => {
    setEditing(null);
    setPeriodId('');
    setCategoryId('');
    setUnits({});
    setDescription('');
    setPreview(null);
    saveAction.setError(null);
  };
  const unitFieldsComplete = unitFields.every((field) => units[field.key] !== undefined && units[field.key] !== '' && Number.isFinite(Number(units[field.key])) && Number(units[field.key]) >= 0);
  const canPreview = !!periodId && !!categoryId && unitFieldsComplete && !selectedCategory?.configuration_error;
  const hasUnitFields = unitFields.length > 0;

  return (
    <div className="stack-lg community-claims">
      <header className="page-header">
        <div>
          <p className="routing-eyebrow">{sw ? 'Njia C · malipo ya moja kwa moja ya jamii' : 'Route C · direct community payment'}</p>
          <h1>{provider ? (sw ? 'Madai yangu ya jamii' : 'My community claims') : (sw ? 'Madai ya jamii' : 'Community claims')}</h1>
          <p className="muted small">{sw ? 'Jumla ya kipindi: wasilisha mara moja, hakiki huduma kwa kujitegemea, kisha Fedha ya CSO inaidhinisha na kurekodi malipo ya nje na uthibitisho.' : 'A period aggregate: submit once, verify the service independently, then CSO Finance approves and records the external payment and proof.'}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={refresh} disabled={claims.loading || options.loading}>{sw ? 'Pakia upya' : 'Refresh'}</button>
      </header>

      {provider && (
        <section className="community-compose card" aria-labelledby="community-form-title">
          <div className="community-compose-heading">
            <span className="community-step">{sw ? '01 / ANDAA' : '01 / PREPARE'}</span>
            <div>
              <h2 id="community-form-title">{editing ? (sw ? `Hariri rasimu #${editing.id}` : `Edit draft #${editing.id}`) : (sw ? 'Andaa dai la kipindi' : 'Prepare a period claim')}</h2>
              <p className="muted small">{sw ? 'Weka jumla za kipindi zinazokokotolewa kwa viwango vya jamii vilivyowekwa. Mgao wa bajeti ya mkoa hauhitajiki, na ushahidi wa kila siku si sehemu ya aina hii ya dai.' : 'Enter period totals priced from configured community rates. No regional budget allocation is required, and daily evidence is not part of this claim type.'}</p>
            </div>
          </div>
          <Alert>{options.error || previewAction.error || saveAction.error}</Alert>
          <Alert kind="success">{notice}</Alert>
          {options.data && options.data.periods?.length === 0 && !periodId && (
            <div className="community-config-state"><strong>{sw ? 'Hakuna vipindi vya madai vilivyo wazi.' : 'No open claim periods are available.'}</strong><p>{sw ? 'Muombe msimamizi wa programu aweke kipindi cha malipo kinachostahili.' : 'Ask your programme administrator to configure an eligible pay period.'}</p></div>
          )}
          {editing && <p className="notice notice-info small">{sw ? 'Kipindi na kategoria vimefungwa. Kubadilisha vipimo hakubadilishi viwango vilivyorekodiwa awali.' : 'Period and category are locked. Changing units keeps the original captured rate snapshot.'}</p>}
          <form className="stack" onSubmit={editing ? updateClaim : previewClaim}>
            <div className="grid-2">
              {editing ? (
                <>
                  <Field label={sw ? 'Kipindi cha malipo' : 'Pay period'}><input readOnly value={editing.period_label} /></Field>
                  <Field label={sw ? 'Kategoria ya dai' : 'Claim category'}><input readOnly value={editing.category_name || (sw ? 'Kategoria' : 'Category')} /></Field>
                </>
              ) : (
                <>
                  <Field label={sw ? 'Kipindi cha malipo' : 'Pay period'}>
                    <select required disabled={options.loading} value={periodId} onChange={(event) => { setPeriodId(event.target.value); setCategoryId(''); setUnits({}); resetPreview(); }}>
                      <option value="">{options.loading ? (sw ? 'Inapakia vipindi…' : 'Loading periods…') : (sw ? 'Chagua kipindi' : 'Choose a period')}</option>
                      {(options.data?.periods || []).map((period) => <option key={period.id} value={period.id}>{period.period_label || `${period.start_date} – ${period.end_date}`}</option>)}
                    </select>
                  </Field>
                  <Field label={sw ? 'Kategoria ya dai' : 'Claim category'}>
                    <select required disabled={!periodId || options.loading} value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setUnits({}); resetPreview(); }}>
                      <option value="">{periodId ? (sw ? 'Chagua kategoria iliyowekwa' : 'Choose a configured category') : (sw ? 'Chagua kipindi kwanza' : 'Choose a period first')}</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.configuration_error ? (sw ? ' · mipangilio inahitajika' : ' · configuration required') : ''}</option>)}
                    </select>
                  </Field>
                </>
              )}
            </div>
            {!editing && periodId && !options.loading && categories.length === 0 && (
              <div className="community-config-state"><strong>{sw ? 'Hakuna kategoria za jamii zilizowekwa kwa kipindi hiki.' : 'No community categories are configured for this period.'}</strong><p>{sw ? 'Muombe msimamizi wa programu aweke kategoria na viwango vya jamii vinavyostahili.' : 'Ask your programme administrator to configure the eligible community categories and rates.'}</p></div>
            )}
            {selectedCategory?.configuration_error && <Alert kind="warn">{selectedCategory.configuration_error}</Alert>}
            {(editing || selectedCategory) && (
              <fieldset className="community-units">
                <legend>{sw ? 'Jumla za kipindi' : 'Period totals'} · {editing?.category_name || selectedCategory?.name}</legend>
                {hasUnitFields ? (
                  <div className="grid-2">
                    {unitFields.map((field) => (
                      <Field key={field.key} label={field.label} hint={(sw && UNIT_TYPE_HINTS_SW[field.unit_type]) || field.unit_type.replace(/_/g, ' ').toLowerCase()}>
                        <input type="number" min="0" step="any" required value={units[field.key] ?? ''} onChange={(event) => { setUnits((old) => ({ ...old, [field.key]: event.target.value })); resetPreview(); }} />
                      </Field>
                    ))}
                  </div>
                ) : <p className="muted small">{editing ? (sw ? 'Hakuna vipimo vinavyobadilika vilivyorekodiwa; vipengele vya kiasi maalum havibadiliki.' : 'No variable units were captured; fixed components remain unchanged.') : (sw ? 'Kategoria hii haina sehemu za vipimo zilizowekwa. Angalia kiasi kilichowekwa kabla ya kuhifadhi.' : 'This category has no configured unit fields. Preview the configured amount before saving.')}</p>}
              </fieldset>
            )}
            <Field label={sw ? 'Maelezo (si lazima)' : 'Description (optional)'} hint={sw ? 'Ongeza maelezo mafupi ikihitajika. Usiandike taarifa zinazomtambulisha mgonjwa.' : 'Add brief context if useful. Do not include patient-identifying details.'}>
              <textarea rows={2} maxLength={2000} value={description} onChange={(event) => { setDescription(event.target.value); resetPreview(); }} />
            </Field>
            {editing ? (
              <div className="row">
                <button className="btn btn-primary" disabled={saveAction.busy || !unitFieldsComplete}>{saveAction.busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Hifadhi mabadiliko ya rasimu' : 'Save draft changes')}</button>
                <button type="button" className="btn btn-ghost" onClick={startNew}>{sw ? 'Acha kuhariri' : 'Stop editing'}</button>
              </div>
            ) : (
              <button className="btn btn-primary" disabled={!canPreview || previewAction.busy}>{previewAction.busy ? (sw ? 'Inakokotoa…' : 'Calculating…') : (sw ? 'Angalia kiasi' : 'Preview amount')}</button>
            )}
          </form>
          {preview && !editing && (
            <div className="community-preview">
              <div className="community-preview-top">
                <div><span className="community-step">{sw ? '02 / KAGUA KABLA YA KUHIFADHI' : '02 / REVIEW BEFORE SAVE'}</span><strong className="community-total">{money(preview.amount, preview.currency)}</strong></div>
                <span className="community-preview-note">{sw ? 'Muhtasari tu · haijawasilishwa' : 'Preview only · not submitted'}</span>
              </div>
              <p className="muted small">{preview.payor_name || (sw ? 'Mlipaji hajabainishwa' : 'Payor not resolved')} · {preview.region_name || (sw ? 'Mkoa haujabainishwa' : 'Region not resolved')}</p>
              <ComponentsTable components={preview.components} currency={preview.currency} />
              <div className="row">
                <button type="button" className="btn btn-primary" onClick={createClaim} disabled={saveAction.busy}>{saveAction.busy ? (sw ? 'Inahifadhi…' : 'Saving…') : (sw ? 'Hifadhi kama rasimu' : 'Save as draft')}</button>
                <button type="button" className="btn btn-ghost" onClick={resetPreview}>{sw ? 'Rekebisha vipimo' : 'Adjust units'}</button>
              </div>
              <p className="muted small">{sw ? 'Kuhifadhi hakuwasilishi dai. Liwasilishe kando kutoka kwenye taarifa za dai ukiwa tayari.' : 'Saving does not submit the claim. Submit separately from the claim details when ready.'}</p>
            </div>
          )}
        </section>
      )}

      {!provider && <section className="community-flow card"><span className="community-step">{sw ? 'MAPITIO HURU · NJIA C' : 'INDEPENDENT REVIEW · ROUTE C'}</span><p><strong>{sw ? 'Mtoa huduma anawasilisha → mhakiki wa eneo husika anathibitisha → Fedha ya CSO iliyopangiwa inaidhinisha → malipo, uthibitisho na upatanisho.' : 'Provider submits → scoped verifier confirms → assigned CSO Finance approves → payment, proof and reconciliation.'}</strong> {sw ? 'Viwango vya jamii vilivyoidhinishwa ndivyo vinavyoamua kiasi; RM, Fedha ya Mkoa au mgao wa bajeti ya mkoa havihitajiki.' : 'Approved community rates determine the amount; no RM, Regional Finance or regional budget allocation is required.'}</p></section>}
      <section className="stack">
        <div className="community-list-heading"><div><span className="community-step">{sw ? 'DAFTARI LA MADAI' : 'CLAIM REGISTER'}</span><h2>{provider ? (sw ? 'Madai yako' : 'Your claims') : (sw ? 'Madai katika eneo lako' : 'Claims in your scope')}</h2></div><span className="muted small">{sw ? 'Idhini ya kazi na kurekodi malipo ni vitu tofauti.' : 'Work approval and payment recording remain separate.'}</span></div>
        <AsyncState data={claims.data} error={claims.error} loading={claims.loading} empty={sw ? 'Bado hakuna madai ya jamii yanayoonekana. Rasimu na mapitio yataonekana hapa yakipatikana.' : 'No community claims are visible yet. Drafts and reviews will appear here when available.'}>
          {(rows) => (
            <div className="table-wrap">
              <table className="community-table">
                <thead><tr><th>{sw ? 'Dai' : 'Claim'}</th><th>{sw ? 'Mtoa huduma' : 'Provider'}</th><th>{sw ? 'Kategoria · kipindi' : 'Category · period'}</th><th>{sw ? 'Mtiririko' : 'Workflow'}</th><th>{sw ? 'Malipo' : 'Payment'}</th><th className="num">{sw ? 'Kiasi' : 'Amount'}</th><th>{sw ? 'Imesasishwa' : 'Updated'}</th><th><span className="sr-only">{sw ? 'Hatua' : 'Actions'}</span></th></tr></thead>
                <tbody>{rows.map((claim) => (
                  <tr key={claim.id}>
                    <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpenId(claim.id)}>#{claim.id}</button></td>
                    <td>{claim.staff_name}</td>
                    <td>{claim.category_name || (sw ? 'Kategoria inasubiriwa' : 'Category pending')}<span className="routing-subline">{claim.period_label}</span></td>
                    <td><StatusBadge kind="claim" status={claim.status} bare /></td>
                    <td><RouteBadge route={claim.route_code} /><span className="routing-subline"><StatusBadge kind="payment" status={claim.payment_status} bare /></span></td>
                    <td className="num nowrap">{money(claim.amount, claim.currency)}</td>
                    <td className="nowrap small">{dateTime(claim.updated_at)}</td>
                    <td className="community-row-actions">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpenId(claim.id)}>{sw ? 'Kagua' : 'Review'}</button>
                      {provider && claim.created_by === me?.id && ['DRAFT', 'VALIDATION_NEEDED'].includes(claim.status) && <button type="button" className="btn btn-ghost btn-sm" onClick={() => loadForEdit(claim.id)}>{sw ? 'Hariri' : 'Edit'}</button>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </AsyncState>
      </section>
      {openId !== null && <ClaimDrawer claimId={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </div>
  );
}
