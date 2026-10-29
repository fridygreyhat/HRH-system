import React, { useState } from 'react';
import { api } from '../../api';
import { ClaimCategory } from '../../types';
import { Alert, Field, Modal } from '../ui';
import { unconfiguredServiceCategories } from './FundingReview';

type Props = {
  categories: ClaimCategory[];
  fundingSourceId: string;
  canConfigure: boolean;
  showContactHint: boolean;
  onSaved: (category: ClaimCategory) => Promise<void> | void;
};

export function FundingCategorySetup({ categories, fundingSourceId, canConfigure, showContactHint, onSaved }: Props) {
  const [categoryId, setCategoryId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unconfigured = unconfiguredServiceCategories(categories);

  if (!unconfigured.length || !fundingSourceId || (!canConfigure && !showContactHint)) return null;
  if (!canConfigure) {
    return (
      <p className="notice notice-info" role="status">
        An active Services category has no funding source yet. Contact Central Finance to link it before reviewing this claim.
      </p>
    );
  }

  const selectedCategory = unconfigured.find((category) => String(category.id) === categoryId);
  const cancel = () => {
    if (busy) return;
    setConfirmOpen(false);
    setError(null);
  };

  const saveMapping = async () => {
    if (!selectedCategory || !reason.trim() || reason.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.put<ClaimCategory>(
        `/finance/categories/${selectedCategory.id}/funding-source`,
        { funding_source_id: Number(fundingSourceId), reason: reason.trim() },
      );
      await onSaved(updated);
      setCategoryId('');
      setReason('');
      setConfirmOpen(false);
    } catch (e) {
      setError((e as Error).message || 'The funding source could not be linked. Refresh and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="notice notice-info stack" aria-label="Initial Services category funding setup">
      <div>
        <strong>Initial category setup</strong>
        <p className="small">These active Services categories are not linked to a funding source. Link only after confirming the intended programme.</p>
      </div>
      <Field label="Unconfigured Services category">
        <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">Choose category to configure…</option>
          {unconfigured.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </Field>
      <Field label="Reason for initial assignment" hint="At least 3 characters. This is recorded with the setup change.">
        <input value={reason} minLength={3} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {error && <Alert kind="error">{error}</Alert>}
      <div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!selectedCategory || reason.trim().length < 3}
          onClick={() => {
            setError(null);
            setConfirmOpen(true);
          }}
        >
          Review initial assignment
        </button>
      </div>
      {confirmOpen && selectedCategory && (
        <Modal title="Confirm initial funding assignment" onClose={cancel}>
          <div className="stack">
            <p>
              Link <strong>{selectedCategory.name}</strong> to the selected funding source? This affects other new claims using this category. It does not allocate funds, create a budget, or change existing claims.
            </p>
            <p className="muted small">Reason: {reason.trim()}</p>
            {error && <Alert kind="error">{error}</Alert>}
            <div className="row">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={cancel}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={saveMapping}>
                {busy ? 'Saving assignment…' : 'Confirm and link category'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
