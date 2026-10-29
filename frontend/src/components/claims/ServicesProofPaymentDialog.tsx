import React, { useMemo, useState } from 'react';
import { api } from '../../api';
import { money, todayLocal } from '../../format';
import { useAction, useApi } from '../../hooks';
import { PaymentManifest } from '../../types';
import { Alert, Field, Modal } from '../ui';
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
        ? 'Choose a PDF, PNG or JPEG document.'
        : next && next.size > MAX_SERVICE_PROOF_BYTES
          ? 'The proof file must be 10 MB or smaller.'
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
    <Modal title="Services · attach payment proof" onClose={onClose}>
      <form className="stack services-proof-form" onSubmit={submit}>
        <div className="notice notice-info">
          This records one external payment and attaches its proof in a single save. It does not initiate a bank or wallet transfer, and the
          document is not read or verified by OCR.
        </div>
        {manifests === undefined && eligible.loading && <div className="services-skeleton" role="status">Loading eligible Services claims…</div>}
        {manifests === undefined && eligible.error && (
          <Alert>{eligible.error} <button type="button" className="link" onClick={eligible.reload}>Retry</button></Alert>
        )}
        {!eligible.loading && !eligible.error && rows.length === 0 && (
          <div className="empty">No Services claims are currently eligible for proof.</div>
        )}
        {rows.length > 0 && (
          <>
            <div className="services-selection-head">
              <div>
                <strong>Beneficiaries</strong>
                <div className="muted small">Choose up to 25 claims in the same currency.</div>
              </div>
              <span className="services-count">{selectedRows.length} / 25 selected</span>
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
                      aria-label={`Select claim ${row.claim_id}, ${row.provider_name}`}
                    />
                    <span className="services-manifest-main">
                      <span className="services-manifest-title">
                        <strong>{row.provider_name}</strong>
                        <span className="muted small">Claim #{row.claim_id}</span>
                      </span>
                      <span className="services-service-list">{row.services.length ? row.services.join(' · ') : 'No service names supplied'}</span>
                      <span className="services-amounts">
                        <span><small>Approved</small><strong>{money(row.amount, row.currency)}</strong></span>
                        <span><small>Recorded</small><strong>{money(row.amount_recorded, row.currency)}</strong></span>
                        <span><small>Outstanding</small><strong>{money(row.outstanding_amount, row.currency)}</strong></span>
                        <span><small>Amount on proof</small><strong>{money(Number(row.outstanding_amount) > 0 ? row.outstanding_amount : row.amount, row.currency)}</strong></span>
                      </span>
                      {isFullyRecorded && row.can_record_with_proof && (
                        <span className="services-proof-note">Already recorded — proof amount remains {money(row.amount, row.currency)}; no payment is added.</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="services-proof-summary">
              <span>{selectedRows.length} {selectedRows.length === 1 ? 'claim' : 'claims'} · {currency || 'Select a currency'}</span>
              <strong>Proof amount {money(total, currency || '')}</strong>
              {selectedRows.some((row) => Number(row.outstanding_amount) <= 0) && (
                <small>Fully recorded claims are included for proof confirmation only and do not create a duplicate payment.</small>
              )}
            </div>
            <div className="grid-2">
              <Field label="Payment reference">
                <input required minLength={1} maxLength={200} value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>
              <Field label="Payment date">
                <input type="date" required max={todayLocal()} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              </Field>
              <Field label="Payment method (optional)">
                <select value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option value="">Not specified</option>
                  <option value="BANK">Bank</option>
                  <option value="MOBILE_WALLET">Mobile wallet</option>
                </select>
              </Field>
              <Field label="Proof document" hint="PDF, PNG or JPEG · maximum 10 MB">
                <input type="file" accept="application/pdf,image/png,image/jpeg" required onChange={(event) => chooseFile(event.target.files?.[0] || null)} />
              </Field>
            </div>
            {file && !fileError && <p className="muted small">Selected: {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}
            <Alert>{fileError}</Alert>
            <label className="services-confirmation">
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              <span>I have checked the actual payment document and confirm it lists each selected provider, their services, and the actual payment amount for each beneficiary.</span>
            </label>
            <div className="notice">
              This is a manual confirmation only. HRH does not verify document contents, OCR the proof, or send money through a bank or wallet.
            </div>
          </>
        )}
        <Alert>{error}</Alert>
        <div className="row">
          <button className="btn btn-primary" disabled={busy || !canSubmit || (manifests === undefined && (!eligible.data || eligible.loading))}>
            {busy ? 'Saving proof and payment…' : 'Save proof and payment'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}
