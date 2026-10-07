import React, { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { ROLE_LABELS, roleLabel } from '../../format';
import { useApi } from '../../hooks';
import { Setting } from '../../types';
import { Alert, AsyncState, Field, ReasonDialog, StatusBadge } from '../../components/ui';

const GPS_EVENTS: Record<string, string> = {
  ENTRY: 'ENTRY — when a daily entry is saved',
  SUBMIT: 'SUBMIT — when the work log is submitted',
};

function show(key: string, value: unknown): React.ReactNode {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    if (!value.length) return <span className="muted">None</span>;
    return key === 'escalation_recipient_roles' ? value.map((v) => roleLabel(String(v))).join(', ') : value.join(', ');
  }
  if (value === null || value === undefined) return '—';
  return String(value);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Editor that keeps the default's JSON type (number, boolean or list). */
function ValueEditor({ setting, value, onChange }: { setting: Setting; value: unknown; onChange: (v: unknown) => void }) {
  const def = setting.default;
  if (typeof def === 'boolean') {
    return (
      <label className="row-inline">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> Enabled
      </label>
    );
  }
  if (typeof def === 'number') {
    return (
      <Field label="New value" hint="Whole number">
        <input
          type="number"
          step={1}
          min={0}
          value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
          required
        />
      </Field>
    );
  }
  if (Array.isArray(def)) {
    const list = Array.isArray(value) ? value.map(String) : [];
    const choices: Record<string, string> =
      setting.key === 'gps_capture_events'
        ? GPS_EVENTS
        : setting.key === 'escalation_recipient_roles'
          ? ROLE_LABELS
          : Object.fromEntries(list.map((v) => [v, v]));
    return (
      <fieldset className="checks">
        <legend>New value</legend>
        {Object.entries(choices).map(([k, text]) => (
          <label key={k}>
            <input type="checkbox" checked={list.includes(k)} onChange={(e) => onChange(e.target.checked ? [...list, k] : list.filter((x) => x !== k))} />{' '}
            {text}
          </label>
        ))}
      </fieldset>
    );
  }
  return (
    <Field label="New value">
      <input value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function SettingsSection() {
  const { hasRole } = useAuth();
  const canEdit = hasRole('SYSTEM_ADMIN');
  const { data, error, loading, reload } = useApi<Setting[]>('/admin/settings');
  const [editing, setEditing] = useState<{ setting: Setting; value: unknown } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async (reason: string) => {
    if (!editing) return;
    const { setting, value } = editing;
    if (typeof setting.default === 'number' && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
      throw new Error('Enter a whole number of zero or more.');
    }
    if (reason.length < 3) throw new Error('Give a reason (at least 3 characters).');
    await api.put(`/admin/settings/${encodeURIComponent(setting.key)}`, { value, reason });
    setEditing(null);
    setNotice(`${setting.key} updated.`);
    reload();
  };

  return (
    <section className="card stack">
      <h3>Settings</h3>
      <p className="muted">Operational policy stored in the database. Every change is recorded in the audit log with its reason.</p>
      {!canEdit && <p className="notice notice-info">Read only. Settings can be changed by a System Admin.</p>}
      <Alert kind="success">{notice}</Alert>
      <AsyncState data={data} error={error} loading={loading} empty="No settings.">
        {(settings) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Description</th>
                  <th>Current value</th>
                  <th>Default</th>
                  {canEdit && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {settings.map((s) => (
                  <tr key={s.key}>
                    <td>
                      <code>{s.key}</code>
                    </td>
                    <td>{s.description || '—'}</td>
                    <td>
                      <strong>{show(s.key, s.value)}</strong> {!same(s.value, s.default) && <StatusBadge status="CHANGED" />}
                    </td>
                    <td className="muted">{show(s.key, s.default)}</td>
                    {canEdit && (
                      <td>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setNotice(null);
                            setEditing({ setting: s, value: s.value });
                          }}
                        >
                          Change
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncState>
      {editing && (
        <ReasonDialog
          title={`Change ${editing.setting.key}`}
          description={
            <>
              {editing.setting.description}
              <br />
              Current: {show(editing.setting.key, editing.setting.value)} · Default: {show(editing.setting.key, editing.setting.default)}
            </>
          }
          required
          confirmLabel="Save setting"
          onConfirm={save}
          onClose={() => setEditing(null)}
        >
          <ValueEditor setting={editing.setting} value={editing.value} onChange={(v) => setEditing((e) => (e ? { ...e, value: v } : e))} />
        </ReasonDialog>
      )}
    </section>
  );
}
