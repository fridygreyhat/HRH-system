import React, { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { useAction, useApi } from '../../hooks';
import { Cadre, CadreField } from '../../types';
import { Alert, AsyncState, Facts, Field, Modal, Section } from '../../components/ui';

const KEY_RE = /^[a-z][a-z0-9_]{1,79}$/;
const HOURS_MODE_LABELS: Record<string, string> = {
  DIRECT: 'Hours entered directly',
  START_END: 'Start and end time (hours calculated)',
};

function CadreForm({ cadre, onDone, onCancel }: { cadre: Cadre; onDone: (c: Cadre) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    name: cadre.name,
    form_title: cadre.form_title || '',
    uses_facility_geofence: cadre.uses_facility_geofence,
    requires_facility_endorsement: cadre.requires_facility_endorsement,
    technical_reviewer_title: cadre.technical_reviewer_title || '',
    uses_section: cadre.uses_section,
    occupations: cadre.occupation_options.join('\n'),
    is_active: true,
  });
  const { busy, error, setError, run } = useAction();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Name is required.');
    if (!form.is_active && !window.confirm(`Mark the ${cadre.name} cadre as inactive?`)) return undefined;
    const saved = await run(() =>
      api.put<Cadre>(`/admin/cadres/${cadre.id}`, {
        name: form.name.trim(),
        form_title: form.form_title.trim() || null,
        uses_facility_geofence: form.uses_facility_geofence,
        requires_facility_endorsement: false,
        technical_reviewer_title: form.technical_reviewer_title.trim() || null,
        uses_section: form.uses_section,
        occupation_options: form.occupations
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        is_active: form.is_active,
      }),
    );
    if (saved) onDone(saved);
    return undefined;
  };

  const check = (key: 'uses_facility_geofence' | 'requires_facility_endorsement' | 'uses_section' | 'is_active', text: string) => (
    <label className="row-inline">
      <input type="checkbox" checked={form[key]} disabled={busy} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.checked }))} /> {text}
    </label>
  );

  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid-2">
        <Field label="Name *">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required maxLength={255} />
        </Field>
        <Field label="Form title" hint="Printed at the top of the work-log sheet">
          <input value={form.form_title} onChange={(e) => setForm((f) => ({ ...f, form_title: e.target.value }))} maxLength={255} />
        </Field>
      </div>
      <Field label="Technical reviewer" hint="The FHI360 position that gives technical endorsement for this cadre's work logs">
        <input value={form.technical_reviewer_title} onChange={(e) => setForm((f) => ({ ...f, technical_reviewer_title: e.target.value }))} maxLength={255} />
      </Field>
      <Field label="Occupation options" hint="One per line. Leave empty if the form does not ask for an occupation.">
        <textarea rows={4} value={form.occupations} onChange={(e) => setForm((f) => ({ ...f, occupations: e.target.value }))} />
      </Field>
      <fieldset className="checks">
        <legend>Form behaviour</legend>
        {check('uses_facility_geofence', 'Check entries against the facility geofence')}
        {check('uses_section', 'Asks for the facility section')}
        {check('is_active', 'Cadre is active')}
      </fieldset>
      <p className="muted small">
        The cadre list does not report whether a cadre is active, so “Cadre is active” starts ticked and saving keeps (or makes) the cadre
        active. Untick it only to deactivate the cadre. Hours mode is fixed and cannot be changed here.
      </p>
      <Alert>{error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save cadre'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function FieldForm({
  cadre,
  field,
  sortOrder,
  onDone,
  onCancel,
}: {
  cadre: Cadre;
  field: CadreField | null;
  sortOrder: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    key: field?.key || '',
    label_en: field?.label_en || '',
    label_sw: field?.label_sw || '',
    field_type: field?.field_type || 'INTEGER',
    sort_order: String(sortOrder),
    is_active: true,
  });
  const { busy, error, setError, run } = useAction();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!KEY_RE.test(form.key)) return setError('The key must start with a lowercase letter and use only lowercase letters, digits and _ (2–80 characters).');
    if (!form.label_en.trim()) return setError('The English label is required.');
    const order = Number(form.sort_order);
    if (!Number.isInteger(order)) return setError('Sort order must be a whole number.');
    if (field && !form.is_active && !window.confirm(`Hide “${field.label_en}” from the ${cadre.name} form? Data already recorded is kept.`)) return undefined;
    const body = {
      key: form.key,
      label_en: form.label_en.trim(),
      label_sw: form.label_sw.trim() || null,
      field_type: form.field_type,
      sort_order: order,
      is_active: form.is_active,
    };
    const ok = await run(async () => {
      if (field) await api.put(`/admin/cadres/${cadre.id}/fields/${encodeURIComponent(field.key)}`, body);
      else await api.post(`/admin/cadres/${cadre.id}/fields`, body);
      return true;
    });
    if (ok) onDone();
    return undefined;
  };

  const fixedHint = field ? 'Fixed once the field exists: add a new field and deactivate this one to change it.' : undefined;
  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid-2">
        <Field label="Key *" hint={fixedHint || 'Lowercase letters, digits and _, e.g. clients_followed_up. Used by rate rules.'}>
          <input
            value={form.key}
            onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
            disabled={!!field || busy}
            required
            pattern="[a-z][a-z0-9_]{1,79}"
            maxLength={80}
          />
        </Field>
        <Field label="Type *" hint={fixedHint}>
          <select
            value={form.field_type}
            onChange={(e) => setForm((f) => ({ ...f, field_type: e.target.value as CadreField['field_type'] }))}
            disabled={!!field || busy}
          >
            <option value="INTEGER">Number (count)</option>
            <option value="BOOLEAN">Yes / no</option>
          </select>
        </Field>
        <Field label="Label (English) *">
          <input value={form.label_en} onChange={(e) => setForm((f) => ({ ...f, label_en: e.target.value }))} required maxLength={255} />
        </Field>
        <Field label="Label (Kiswahili)">
          <input value={form.label_sw} onChange={(e) => setForm((f) => ({ ...f, label_sw: e.target.value }))} maxLength={255} />
        </Field>
        <Field label="Sort order" hint="Lower numbers appear first">
          <input type="number" step={1} value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} />
        </Field>
      </div>
      <label className="row-inline">
        <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} disabled={busy} /> Show
        this field on the form
      </label>
      {field && (
        <p className="muted small">Deactivated fields disappear from this list (the cadre list only returns active fields) and cannot be re-activated here.</p>
      )}
      <Alert>{error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : field ? 'Save field' : 'Add field'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type Editing = { kind: 'cadre'; cadre: Cadre } | { kind: 'field'; cadre: Cadre; field: CadreField | null; sortOrder: number };

export function CadresSection() {
  const { hasRole } = useAuth();
  const canWrite = hasRole('CENTRAL_ADMIN');
  const { data, error, loading, reload } = useApi<Cadre[]>('/admin/cadres');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = (e: Editing) => {
    setNotice(null);
    setEditing(e);
  };

  return (
    <div className="stack">
      {!canWrite && <p className="notice notice-info">Read only. Changes to cadre forms require the Central Admin role.</p>}
      <Alert kind="success">{notice}</Alert>
      <AsyncState data={data} error={error} loading={loading} empty="No cadres configured.">
        {(cadres) =>
          cadres.map((c) => (
            <Section
              key={c.id}
              title={`${c.name} (${c.code})`}
              actions={
                canWrite && (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={() => open({ kind: 'cadre', cadre: c })}>
                      Edit cadre
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => open({ kind: 'field', cadre: c, field: null, sortOrder: c.fields.length })}>
                      Add field
                    </button>
                  </>
                )
              }
            >
              <Facts
                items={[
                  ['Form title', c.form_title],
                  ['Hours mode (read only)', HOURS_MODE_LABELS[c.hours_mode] || c.hours_mode],
                  ['Facility geofence', c.uses_facility_geofence ? 'Checked' : 'Not used'],
                  ['Technical reviewer', c.technical_reviewer_title],
                  ['Section', c.uses_section ? 'Asked' : 'Not asked'],
                  ['Occupation options', c.occupation_options.length ? c.occupation_options.join(', ') : null],
                ]}
              />
              {c.fields.length === 0 ? (
                <p className="muted">No extra measures on this form.</p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th className="num">Order</th>
                        <th>Key</th>
                        <th>Label (English)</th>
                        <th>Label (Kiswahili)</th>
                        <th>Type</th>
                        {canWrite && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {c.fields.map((f, i) => (
                        <tr key={f.key}>
                          <td className="num">{i + 1}</td>
                          <td>
                            <code>{f.key}</code>
                          </td>
                          <td>{f.label_en}</td>
                          <td>{f.label_sw || '—'}</td>
                          <td>{f.field_type === 'BOOLEAN' ? 'Yes / no' : 'Number'}</td>
                          {canWrite && (
                            <td>
                              <button className="btn btn-secondary btn-sm" onClick={() => open({ kind: 'field', cadre: c, field: f, sortOrder: i })}>
                                Edit
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          ))
        }
      </AsyncState>
      {editing?.kind === 'cadre' && (
        <Modal title={`Edit ${editing.cadre.name}`} onClose={() => setEditing(null)}>
          <CadreForm
            cadre={editing.cadre}
            onCancel={() => setEditing(null)}
            onDone={(c) => {
              setEditing(null);
              setNotice(`${c.name} saved.`);
              reload();
            }}
          />
        </Modal>
      )}
      {editing?.kind === 'field' && (
        <Modal title={editing.field ? `Edit field on ${editing.cadre.name}` : `Add field to ${editing.cadre.name}`} onClose={() => setEditing(null)}>
          <FieldForm
            cadre={editing.cadre}
            field={editing.field}
            sortOrder={editing.sortOrder}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null);
              setNotice(editing.field ? 'Field saved.' : 'Field added.');
              reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
