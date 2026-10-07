import React, { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateTime, humanize } from '../../format';
import { useAction, useApi } from '../../hooks';
import { SmsTemplate } from '../../types';
import { Alert, AsyncState, Drawer, Field, StatusBadge } from '../../components/ui';

const PROTECTED_TEXT =
  'The OTP message is protected: it carries a one-time code, so its text cannot be edited here and the code is never stored or shown in the outbox.';
const LANG_LABELS: Record<string, string> = { en: 'English', sw: 'Kiswahili' };
const MAX_CHARS = 320;

interface Preview {
  preview: string;
  characters: number;
  segments: number;
}

function TemplateEditor({ template, canEdit, onPublished }: { template: SmsTemplate; canEdit: boolean; onPublished: () => void }) {
  const [text, setText] = useState(template.active_text || '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [published, setPublished] = useState<string | null>(null);
  const previewAction = useAction();
  const publishAction = useAction();
  const body = { event_name: template.event_name, language: template.language, template_text: text };
  const unchanged = text === (template.active_text || '');

  const runPreview = async () => {
    setPublished(null);
    const result = await previewAction.run(() => api.post<Preview>('/admin/sms-templates/preview', body));
    if (result) setPreview(result);
  };

  const publish = async () => {
    if (!window.confirm(`Publish this text as the new ${LANG_LABELS[template.language]} “${humanize(template.event_name)}” message? It is used for every message sent from now on.`)) return;
    const ok = await publishAction.run(async () => {
      await api.post('/admin/sms-templates', body);
      return true;
    });
    if (ok) {
      setPublished('New version published.');
      onPublished();
    }
  };

  if (template.protected) {
    return (
      <div className="stack">
        <p className="notice">{PROTECTED_TEXT}</p>
        <p className="muted">Variables: {template.variables.map((v) => `{${v}}`).join(', ')}</p>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div className="stack">
        <p className="muted">
          Recipient: <strong>{template.recipient}</strong>. Allowed variables (type them in braces):{' '}
          {template.variables.map((v) => (
            <code key={v} style={{ marginRight: '0.4rem' }}>{`{${v}}`}</code>
          ))}
        </p>
        <p className="muted small">SMS never carries patient data, GPS, bank or wallet details, or payment amounts.</p>
        <Field label={`Message text (${LANG_LABELS[template.language]})`} hint={`${text.length} / ${MAX_CHARS} characters (before variables are filled in)`}>
          <textarea
            rows={5}
            value={text}
            maxLength={MAX_CHARS}
            readOnly={!canEdit}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
              setPublished(null);
            }}
          />
        </Field>
        {!canEdit && <p className="muted small">Read only: SMS texts are published by RPM or Oversight users. You can still preview the current text.</p>}
        <Alert>{previewAction.error || publishAction.error}</Alert>
        <Alert kind="success">{published}</Alert>
        <div className="row">
          <button className="btn btn-secondary" onClick={runPreview} disabled={previewAction.busy || text.trim().length < 5}>
            {previewAction.busy ? 'Previewing…' : 'Preview'}
          </button>
          {canEdit && (
            <button className="btn btn-primary" onClick={publish} disabled={publishAction.busy || unchanged || text.trim().length < 5}>
              {publishAction.busy ? 'Publishing…' : 'Publish new version'}
            </button>
          )}
        </div>
        {preview && (
          <div className="card stack">
            <strong>Preview with sample values</strong>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{preview.preview}</p>
            <p className={`small ${preview.segments > 1 ? '' : 'muted'}`}>
              {preview.characters} characters · {preview.segments} SMS segment{preview.segments === 1 ? '' : 's'}
              {preview.segments > 1 ? ' — longer messages cost more and may arrive split.' : ''}
            </p>
          </div>
        )}
      </div>
      <div className="stack">
        <h3>Version history</h3>
        {template.versions.length === 0 ? (
          <p className="muted">No published versions yet: the built-in default text is in use.</p>
        ) : (
          <ol className="stack" style={{ paddingLeft: '1.2rem', margin: 0 }}>
            {template.versions.map((v) => (
              <li key={v.version}>
                <div className="row">
                  <strong>Version {v.version}</strong>
                  {v.is_active && <StatusBadge status="ACTIVE" />}
                  <span className="muted small">{dateTime(v.created_at)}</span>
                  {canEdit && !v.is_active && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setText(v.text);
                        setPreview(null);
                        setPublished(null);
                      }}
                    >
                      Load into editor
                    </button>
                  )}
                </div>
                <p className="small" style={{ margin: '0.25rem 0 0' }}>
                  {v.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

export function SmsTemplatesSection() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('RPM', 'OVERSIGHT');
  const { data, error, loading, reload } = useApi<SmsTemplate[]>('/admin/sms-templates');
  const [lang, setLang] = useState('');
  const [selected, setSelected] = useState<{ event: string; language: string } | null>(null);
  const current = selected && data ? data.find((t) => t.event_name === selected.event && t.language === selected.language) || null : null;
  const rows = (data || []).filter((t) => !lang || t.language === lang);

  return (
    <section className="card stack">
      <h3>SMS templates</h3>
      <p className="muted">
        One message per event and language. Publishing creates a new version; earlier versions are kept for the record.
        {!canEdit && ' You can view and preview templates; RPM and Oversight users publish changes.'}
      </p>
      <div className="filters">
        <Field label="Language">
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="">Both languages</option>
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </select>
        </Field>
      </div>
      <AsyncState data={data} error={error} loading={loading} empty="No SMS events defined.">
        {() => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Language</th>
                  <th>Recipient</th>
                  <th>Active text</th>
                  <th>Version</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={`${t.event_name}-${t.language}`}>
                    <td className="nowrap">{humanize(t.event_name)}</td>
                    <td>{LANG_LABELS[t.language] || t.language}</td>
                    <td>{t.recipient}</td>
                    <td className="small">{t.protected ? <span className="muted">Protected (one-time code)</span> : t.active_text}</td>
                    <td>{t.protected ? '—' : t.active_version ?? 'Default'}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => setSelected({ event: t.event_name, language: t.language })}>
                        {t.protected ? 'View' : canEdit ? 'Edit' : 'View'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncState>
      {current && (
        <Drawer title={`${humanize(current.event_name)} — ${LANG_LABELS[current.language] || current.language}`} onClose={() => setSelected(null)} wide>
          <TemplateEditor key={`${current.event_name}-${current.language}`} template={current} canEdit={canEdit} onPublished={reload} />
        </Drawer>
      )}
    </section>
  );
}
