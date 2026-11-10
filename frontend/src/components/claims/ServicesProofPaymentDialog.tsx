import React, { useMemo, useState } from 'react';
import { api } from '../../api';
import { money, todayLocal } from '../../format';
import { useAction, useApi } from '../../hooks';
import { PaymentManifest } from '../../types';
import { Alert, Field, Modal, pageLang } from '../ui';
import { buildServicesProofBeneficiaries, canSelectServicesManifest, servicesProofAmount } from './servicesProofPayment';

export const MAX_SERVICE_PROOF_BYTES = 10 * 1024 * 1024;
export const SERVICE_PROOF_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];

export interface ServicesProofPaymentResult {
  paid_claim_ids: number[];
  paid_count: number;
}

export function ServicesProofPaymentDialog({
  manifests,
  onClose,
  onDone,
}: {
  /** Omit for the finance queue; provide the claim manifest for a claim-drawer action. */
  manifests?: PaymentManifest[];
  onClose: () => void;
  onDone: (result: ServicesProofPaymentResult) => void;
}) {
  const sw = pageLang() === 'sw';
  const eligible = useApi<PaymentManifest[]>(manifests === undefined ? '/claims/services/proof-payment/eligible' : null);
  const rows = manifests ?? eligible.data ?? [];
  const [selected, setSelected] = useState<number[]>(() => manifests?.filter((m) => m.can_record_with_proof).map((m) => m.claim_id) || []);
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(todayLocal());
  const [method, setMethod] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.claim_id)), [rows, selected]);
  const currency = selectedRows[0]?.currency;
  const total = servicesProofAmount(selectedRows);
  const mismatch = selectedRows.some((row) => row.currency !== currency);
  const canSubmit = !!file && !fileError && selectedRows.length > 0 && selectedRows.length <= 25 &&
    !mismatch && reference.trim().length >= 1 && reference.trim().length <= 200 && !!paymentDate && confirmed;

  const missing = [
    !selectedRows.length && (sw ? 'chagua angalau dai moja' : 'select at least one claim'),
    !reference.trim() && (sw ? 'weka kumbukumbu ya malipo' : 'enter the payment reference'),
    !paymentDate && (sw ? 'chagua tarehe ya malipo' : 'choose the payment date'),
    !file && (sw ? 'chagua hati ya uthibitisho' : 'choose the proof document'),
    !confirmed && (sw ? 'weka alama kwenye kisanduku cha kuthibitisha' : 'tick the confirmation'),
  ].filter(Boolean);

  const toggle = (row: PaymentManifest, checked: boolean) => {
    setSelected((current) => {
      if (!checked) return current.filter((id) => id !== row.claim_id);
      if (!canSelectServicesManifest(rows, current, row)) return current;
      return [...current, row.claim_id];
    });
  };

  const chooseFile = (next: File | null) => {
    setFile(next);
    setFileError(
      next && !SERVICE_PROOF_TYPES.includes(next.type)
        ? (sw ? 'Chagua hati ya PDF, PNG au JPEG.' : 'Choose a PDF, PNG or JPEG document.')
        : next && next.size > MAX_SERVICE_PROOF_BYTES
          ? (sw ? 'Faili la uthibitisho lisizidi MB 10.' : 'The proof file must be 10 MB or smaller.')
          : null,
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || !canSubmit) return;
    const beneficiaries = buildServicesProofBeneficiaries(selectedRows);
    const form = new FormData();
    form.append('file', file);
    form.append('beneficiaries', JSON.stringify(beneficiaries));
    form.append('payment_reference', reference.trim());
    form.append('payment_date', paymentDate);
    form.append('beneficiaries_confirmed', 'true');
    if (method) form.append('payment_method', method);
    const result = await run(() => api.upload<ServicesProofPaymentResult>('/claims/services/proof-payment', form));
    if (result) onDone(result);
  };

  return (
    <Modal title={sw ? 'Huduma · ambatisha uthibitisho wa malipo' : 'Services · attach payment proof'} onClose={onClose}>
      <form className="stack services-proof-form" onSubmit={submit}>
        {manifests === undefined && eligible.loading && <div className="services-skeleton" role="status">{sw ? 'Inapakia madai ya Huduma yanayostahili…' : 'Loading eligible Services claims…'}</div>}
        {manifests === undefined && eligible.error && (
          <Alert>{eligible.error} <button type="button" className="link" onClick={eligible.reload}>{sw ? 'Jaribu tena' : 'Retry'}</button></Alert>
        )}
        {!eligible.loading && !eligible.error && rows.length === 0 && (
          <div className="empty">
            <strong>{sw ? 'Bado hakuna madai ya Huduma yaliyo tayari kwa uthibitisho.' : 'No Services claims are ready for proof yet.'}</strong>
            <p className="small">{sw ? 'Madai yanaonekana hapa baada ya mkaguzi wa Fedha Kuu kuyaidhinisha.' : 'Claims appear here once the Central Finance reviewer approves them.'}</p>
          </div>
        )}
        {rows.length > 0 && (
          <>
            <div className="services-selection-head">
              <div>
                <strong>{sw ? 'Wanufaika' : 'Beneficiaries'}</strong>
                <div className="muted small">{sw ? 'Chagua hadi madai 25 ya sarafu moja.' : 'Choose up to 25 claims in the same currency.'}</div>
              </div>
              <span className="services-count">{selectedRows.length} / 25 {sw ? 'yamechaguliwa' : 'selected'}</span>
            </div>
            <div className="services-manifest-list">
              {rows.map((row) => {
                const isSelected = selected.includes(row.claim_id);
                const isFullyRecorded = Number(row.outstanding_amount) <= 0;
                const disabled = !row.can_record_with_proof || (!isSelected && selectedRows.length >= 25) ||
                  (!isSelected && !!currency && row.currency !== currency);
                return (
                  <label key={row.claim_id} className={`services-manifest${isSelected ? ' is-selected' : ''}${!row.can_record_with_proof ? ' is-unavailable' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={disabled || busy}
                      onChange={(event) => toggle(row, event.target.checked)}
                      aria-label={sw ? `Chagua dai ${row.claim_id}, ${row.provider_name}` : `Select claim ${row.claim_id}, ${row.provider_name}`}
                    />
                    <span className="services-manifest-main">
                      <span className="services-manifest-title">
                        <strong>{row.provider_name}</strong>
                        <span className="muted small">{sw ? 'Dai' : 'Claim'} #{row.claim_id}</span>
                      </span>
                      <span className="services-service-list">{row.services.length ? row.services.join(' · ') : (sw ? 'Hakuna majina ya huduma yaliyotolewa' : 'No service names supplied')}</span>
                      <span className="services-amounts">
                        <span><small>{sw ? 'Kilichoidhinishwa' : 'Approved'}</small><strong>{money(row.amount, row.currency)}</strong></span>
                        <span><small>{sw ? 'Kilichorekodiwa' : 'Recorded'}</small><strong>{money(row.amount_recorded, row.currency)}</strong></span>
                        <span><small>{sw ? 'Kilichobaki' : 'Outstanding'}</small><strong>{money(row.outstanding_amount, row.currency)}</strong></span>
                        <span><small>{sw ? 'Kiasi kwenye uthibitisho' : 'Amount on proof'}</small><strong>{money(Number(row.outstanding_amount) > 0 ? row.outstanding_amount : row.amount, row.currency)}</strong></span>
                      </span>
                      {isFullyRecorded && row.can_record_with_proof && (
                        <span className="services-proof-note">{sw ? `Tayari yamerekodiwa — hakuna malipo yanayoongezwa.` : `Already recorded — no payment is added.`}</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="services-proof-summary">
              <span>{sw ? `${selectedRows.length === 1 ? 'Dai' : 'Madai'} ${selectedRows.length}` : `${selectedRows.length} ${selectedRows.length === 1 ? 'claim' : 'claims'}`} · {currency || (sw ? 'Chagua sarafu' : 'Select a currency')}</span>
              <strong>{sw ? 'Kiasi kwenye uthibitisho' : 'Proof amount'} {money(total, currency || '')}</strong>
              {selectedRows.some((row) => Number(row.outstanding_amount) <= 0) && (
                <small>{sw ? 'Madai yaliyorekodiwa tayari hayaundi malipo ya marudio.' : 'Already recorded claims do not create a duplicate payment.'}</small>
              )}
            </div>
            <div className="grid-2">
              <Field label={sw ? 'Kumbukumbu ya malipo' : 'Payment reference'}>
                <input required minLength={1} maxLength={200} value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>
              <Field label={sw ? 'Tarehe ya malipo' : 'Payment date'}>
                <input type="date" required max={todayLocal()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              </Field>
              <Field label={sw ? 'Njia ya malipo (si lazima)' : 'Payment method (optional)'}>
                <select value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option value="">{sw ? 'Haijabainishwa' : 'Not specified'}</option>
                  <option value="BANK">{sw ? 'Benki' : 'Bank'}</option>
                  <option value="MOBILE_WALLET">{sw ? 'Pesa kwa simu' : 'Mobile wallet'}</option>
                </select>
              </Field>
              <Field label={sw ? 'Hati ya uthibitisho' : 'Proof document'} hint={sw ? 'PDF, PNG au JPEG · hadi MB 10' : 'PDF, PNG or JPEG · maximum 10 MB'}>
                <input type="file" accept="application/pdf,image/png,image/jpeg" required onChange={(event) => chooseFile(event.target.files?.[0] || null)} />
              </Field>
            </div>
            {file && !fileError && <p className="muted small">{sw ? 'Umechagua' : 'Selected'}: {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
            <Alert>{fileError}</Alert>
            <label className="services-confirmation">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>{sw ? 'Nimekagua hati ya malipo; inaorodhesha kila mtoa huduma aliyechaguliwa na kiasi chake.' : 'I checked the payment document; it lists each selected provider and amount.'}</span>
            </label>
          </>
        )}
        <Alert>{error}</Alert>
        {rows.length > 0 && missing.length > 0 && <p className="muted small">{sw ? 'Ili kuhifadhi' : 'To save'}: {missing.join(', ')}.</p>}
        <div className="row">
          {rows.length > 0 && (
            <button className="btn btn-primary" disabled={busy || !canSubmit || (manifests === undefined && (!eligible.data || eligible.loading))}>
              {busy ? (sw ? 'Inahifadhi uthibitisho na malipo…' : 'Saving proof and payment…') : (sw ? 'Hifadhi uthibitisho na malipo' : 'Save proof and payment')}
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>{sw ? 'Ghairi' : 'Cancel'}</button>
        </div>
      </form>
    </Modal>
  );
}
