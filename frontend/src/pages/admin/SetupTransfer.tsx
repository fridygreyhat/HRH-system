import React, { useRef, useState } from 'react';
import { ApiError, api, saveBlob } from '../../api';
import { Alert, Field, StatusBadge } from '../../components/ui';
import './setup-transfer.css';

const MAX_FILE_BYTES = 1024 * 1024;
const APPLY_PHRASE = 'APPLY MISSING SETUP';

export interface SetupRecord {
  id: string;
  kind: string;
  label: string;
  data: Record<string, unknown>;
}

export interface SetupDocument {
  version: 1;
  records: SetupRecord[];
}

export interface SetupReviewItem {
  id: string;
  kind: string;
  label: string;
  state: 'MISSING' | 'EXISTS' | 'CONFLICT';
  message: string;
}

interface ReviewResponse {
  review_token: string;
  items: SetupReviewItem[];
  warnings: string[];
}

interface ApplyResponse {
  applied: number;
  skipped: number;
  items: SetupReviewItem[];
}

function parseSetupDocument(value: unknown): SetupDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The file must contain a JSON object.');
  const doc = value as { version?: unknown; records?: unknown };
  if (doc.version !== 1) throw new Error('Unsupported document version. Expected version 1.');
  if (!Array.isArray(doc.records)) throw new Error('The document must contain a records array.');
  const valid = doc.records.every((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
    const item = record as Record<string, unknown>;
    return typeof item.id === 'string' && typeof item.kind === 'string' && typeof item.label === 'string' &&
      !!item.data && typeof item.data === 'object' && !Array.isArray(item.data);
  });
  if (!valid) throw new Error('Every record needs string id, kind and label fields, plus an object data value.');
  return value as SetupDocument;
}

export function SetupTransfer() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [document, setDocument] = useState<SetupDocument | null>(null);
  const [fileName, setFileName] = useState('');
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [inspected, setInspected] = useState<Set<string>>(() => new Set());
  const [expandedDetails, setExpandedDetails] = useState<Set<string>>(() => new Set());
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<'export' | 'review' | 'apply' | null>(null);
  const [reviewIsCurrent, setReviewIsCurrent] = useState(false);

  const chooseFile = async (file?: File) => {
    setError('');
    setNotice('');
    setReview(null);
    setSelected(new Set());
    setInspected(new Set());
    setExpandedDetails(new Set());
    setReviewIsCurrent(false);
    setDocument(null);
    setFileName('');
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('This file is larger than 1 MiB. Choose a smaller setup export.');
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    try {
      const parsed = parseSetupDocument(JSON.parse(await file.text()));
      setDocument(parsed);
      setFileName(file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This file could not be read as a setup export.');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const exportSetup = async () => {
    setBusy('export');
    setError('');
    setNotice('');
    try {
      saveBlob(await api.blob('/admin/setup-transfer/export', 'GET', 'hrh-pay-setup.json'));
      setNotice('Setup export downloaded. Keep the file secure while moving it to the live environment.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The setup export could not be downloaded.');
    } finally {
      setBusy(null);
    }
  };

  const runReview = async () => {
    if (!document) return;
    setBusy('review');
    setError('');
    setNotice('');
    setReview(null);
    setSelected(new Set());
    setInspected(new Set());
    setExpandedDetails(new Set());
    setReviewIsCurrent(false);
    setConfirmation('');
    try {
      const result = await api.post<ReviewResponse>('/admin/setup-transfer/review', { document });
      setReview(result);
      setReviewIsCurrent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The setup could not be reviewed.');
    } finally {
      setBusy(null);
    }
  };

  const applySetup = async () => {
    if (!canApply || !document || !review) return;
    setBusy('apply');
    setError('');
    setNotice('');
    try {
      const result = await api.post<ApplyResponse>('/admin/setup-transfer/apply', {
        document,
        selected_ids: Array.from(selected),
        review_token: review.review_token,
        reason: reason.trim(),
        confirmation: APPLY_PHRASE,
      });
      setReview({ ...review, items: result.items });
      setReviewIsCurrent(false);
      setSelected(new Set());
      setNotice(`${result.applied} setup item${result.applied === 1 ? '' : 's'} applied; ${result.skipped} skipped.`);
      setReason('');
      setConfirmation('');
    } catch (cause) {
      if ((cause as ApiError).status === 409) {
        setReviewIsCurrent(false);
        setSelected(new Set());
        setError('The reviewed target setup has changed. Nothing was retried. Review this document again before selecting and applying items.');
      } else {
        setError(cause instanceof Error ? cause.message : 'The selected setup could not be applied.');
      }
    } finally {
      setBusy(null);
    }
  };

  const missing = review?.items.filter((item) => item.state === 'MISSING') || [];
  const applyRequirements = [
    ...(!reviewIsCurrent ? ['Run Review setup again to get a current review.'] : []),
    ...(selected.size === 0 ? ['Inspect and select at least one missing record.'] : []),
    ...(selected.size > 250 ? ['Select no more than 250 records per transfer.'] : []),
    ...(reason.trim().length < 3 ? ['Enter a reason for this transfer using at least 3 characters.'] : []),
    ...(reason.trim().length > 1000 ? ['Shorten the transfer reason to 1,000 characters or fewer.'] : []),
    ...(confirmation !== APPLY_PHRASE ? [`Type ${APPLY_PHRASE} exactly in the confirmation field above.`] : []),
  ];
  const canApply = !!document && !!review && applyRequirements.length === 0 && !busy;

  return (
    <div className="stack-lg setup-transfer">
      <header className="setup-transfer-heading">
        <div>
          <p className="setup-transfer-kicker">Super Admin · controlled configuration</p>
          <h2>Setup transfer</h2>
          <p className="muted">Move approved system setup from Preview into Live with a fresh review before any change.</p>
          <p className="muted small">Current website: {window.location.origin}</p>
        </div>
        <span className="setup-transfer-version">DOCUMENT / 01</span>
      </header>

      <section className="setup-transfer-callout" aria-label="Environment separation">
        <div className="setup-transfer-callout-mark" aria-hidden="true">P → L</div>
        <div>
          <strong>Preview and Live use separate databases.</strong>
          <p>This tool transfers setup only. Export from Preview, then upload and review the file on Live. It does not connect to a remote environment.</p>
        </div>
      </section>

      <div className="setup-transfer-flow">
        <section className="card stack setup-transfer-step">
          <div className="setup-transfer-stephead"><span>01</span><div><h3>Export from Preview</h3><p>Download a portable setup document from the environment you are viewing.</p></div></div>
          <div className="setup-transfer-export">
            <p className="muted small">Included records are limited to configuration and setup. Work, approvals, financial records, passwords and bank or mobile payment data are excluded.</p>
            <button type="button" className="btn btn-secondary" onClick={exportSetup} disabled={!!busy}>
              {busy === 'export' ? 'Preparing export…' : 'Download setup file'}
            </button>
          </div>
        </section>

        <section className="card stack setup-transfer-step">
          <div className="setup-transfer-stephead"><span>02</span><div><h3>Review on Live</h3><p>Upload the Preview file in Live and inspect every proposed record.</p></div></div>
          <Field label="Setup export file" hint="JSON · maximum 1 MiB">
            <input ref={fileRef} type="file" accept=".json,application/json" aria-label="Setup export file" disabled={!!busy} onChange={(event) => void chooseFile(event.target.files?.[0])} />
          </Field>
          {fileName && document && (
            <div className="setup-transfer-file" role="status">
              <span className="setup-transfer-file-icon" aria-hidden="true">JSON</span>
              <span><strong>{fileName}</strong><small>{document.records.length} setup records · version 1</small></span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { chooseFile(undefined); if (fileRef.current) fileRef.current.value = ''; }} disabled={!!busy}>Remove</button>
            </div>
          )}
          <button type="button" className="btn btn-primary" onClick={runReview} disabled={!document || !!busy}>
            {busy === 'review' ? 'Reviewing target…' : 'Review setup'}
          </button>
        </section>
      </div>

      <section className="setup-transfer-scope" aria-label="What this transfer does">
        <div><span className="setup-transfer-scope-mark">IN SCOPE</span><p>System setup, reference data and explicitly selected user setup.</p></div>
        <div><span className="setup-transfer-scope-mark setup-transfer-scope-mark-muted">NEVER MOVED</span><p>Passwords, work, approvals, financial records, bank and mobile payment data.</p></div>
      </section>

      <Alert>{error}</Alert>
      <Alert kind="success">{notice}</Alert>

      {review && (
        <section className="card stack setup-transfer-review" aria-labelledby="setup-review-title">
          <div className="section-head">
            <div><p className="setup-transfer-kicker">Target snapshot</p><h3 id="setup-review-title">Review results</h3></div>
            <span className="setup-transfer-count">{review.items.length} records</span>
          </div>
          {!reviewIsCurrent && <Alert kind="warn">This review is no longer current. Run Review setup again before applying changes.</Alert>}
          {!!review.warnings.length && (
            <div className="setup-transfer-warnings" role="note">
              <strong>Review notes</strong>
              <ul>{review.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul>
            </div>
          )}
          <div className="setup-transfer-guidance">
            <p><strong>Dependencies matter.</strong> Select missing dependencies together; partial setup can leave a feature incomplete.</p>
            <p><strong>Conflicts are not applied.</strong> Resolve them manually in the target, then review again.</p>
            <p><strong>User setup is sensitive.</strong> Review the full user setup data, including roles and scopes, before selecting the record as a group. Applying setup never activates a new account or supplies a known password. A Super Admin must activate it and use the existing password-reset process before sign-in. Existing passwords and privileges are never removed.</p>
          </div>
          {missing.length > 0 && reviewIsCurrent && (
            <div className="setup-transfer-selection">
              <span>{selected.size} selected · inspect each record before it can be selected</span>
              <div className="row">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set(missing.filter((item) => inspected.has(item.id)).map((item) => item.id)))} disabled={!!busy || !missing.some((item) => inspected.has(item.id))}>Select inspected missing</button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())} disabled={!!busy}>Clear selection</button>
              </div>
            </div>
          )}
          <div className="setup-transfer-items">
            {review.items.length ? review.items.map((item) => (
              <article className={`setup-transfer-item setup-transfer-item-${item.state.toLowerCase()}`} key={item.id}>
                <div className="setup-transfer-item-check">
                  {item.state === 'MISSING' && reviewIsCurrent
                    ? <input type="checkbox" aria-label={`Select ${item.label}`} checked={selected.has(item.id)} disabled={!!busy || !inspected.has(item.id)} onChange={(event) => setSelected((previous) => {
                        const next = new Set(previous);
                        if (event.target.checked) next.add(item.id); else next.delete(item.id);
                        return next;
                      })} />
                    : <span className="setup-transfer-check-placeholder" aria-hidden="true" />}
                </div>
                <div className="setup-transfer-item-main">
                  <div className="setup-transfer-item-title"><strong>{item.label}</strong><code>{item.kind}</code></div>
                  <p>{item.message}</p>
                  {(() => {
                    const record = document?.records.find((candidate) => candidate.id === item.id);
                    const open = expandedDetails.has(item.id);
                    const detailsId = `setup-record-${encodeURIComponent(item.id)}`;
                    return (
                      <div className="setup-transfer-record-details">
                        <button
                          type="button"
                          className="setup-transfer-details-toggle"
                          aria-expanded={open}
                          aria-controls={detailsId}
                          onClick={() => {
                            setInspected((previous) => new Set(previous).add(item.id));
                            setExpandedDetails((previous) => {
                              const next = new Set(previous);
                              if (next.has(item.id)) next.delete(item.id); else next.add(item.id);
                              return next;
                            });
                          }}
                        >
                          {open ? 'Hide configuration details' : 'Inspect configuration details'}
                        </button>
                        {open && (
                          <div id={detailsId} className="setup-transfer-record-data" role="region" aria-label={`${item.label} configuration data`}>
                            {record
                              ? <pre className="json">{JSON.stringify(record.data, null, 2)}</pre>
                              : <p className="muted">No matching record data was found in the uploaded document.</p>}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <StatusBadge status={item.state} />
              </article>
            )) : <p className="empty">No setup records were found in this document.</p>}
          </div>
          {reviewIsCurrent && missing.length > 0 && (
            <div className="setup-transfer-apply">
              <div className="setup-transfer-apply-intro">
                <span>03 / APPLY SELECTED ONLY</span>
                <h4>Confirm the target changes</h4>
                <p>Only selected MISSING records will be sent. Existing records and conflicts remain untouched.</p>
              </div>
              <div className="grid-2">
                <Field label="Reason for this transfer" hint="At least 3 characters; recorded with the change">
                  <textarea rows={3} value={reason} maxLength={1000} disabled={!!busy} onChange={(event) => setReason(event.target.value)} placeholder="For example: align Live setup with approved Preview changes" />
                </Field>
                <Field label={`Type ${APPLY_PHRASE} to confirm`} hint="This confirmation is required for every apply operation.">
                  <input value={confirmation} disabled={!!busy} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" spellCheck={false} />
                </Field>
              </div>
              <div id="setup-apply-requirements" role="status" aria-live="polite">
                {busy === 'apply' ? <p>Applying the selected setup. Please wait; do not submit again.</p> :
                  applyRequirements.length > 0 ? (
                    <Alert kind="info">
                      <strong>Before Apply becomes available:</strong>
                      <ul>{applyRequirements.map((requirement) => <li key={requirement}>{requirement}</li>)}</ul>
                    </Alert>
                  ) : <p>Ready to apply {selected.size} selected item{selected.size === 1 ? '' : 's'}. No changes have been applied yet.</p>}
              </div>
              <button type="button" className="btn btn-primary" onClick={applySetup} disabled={!canApply} aria-describedby="setup-apply-requirements">
                {busy === 'apply' ? 'Applying selected setup…' : `Apply ${selected.size} selected item${selected.size === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
          {reviewIsCurrent && missing.length === 0 && <Alert kind="info">No missing setup is available to apply. Existing records are preserved; conflicts require manual resolution.</Alert>}
        </section>
      )}
      <p className="setup-transfer-footnote">A successful review is a snapshot, not a lock. If the target changes after review, Live rejects the stale token; review again before proceeding.</p>
    </div>
  );
}
