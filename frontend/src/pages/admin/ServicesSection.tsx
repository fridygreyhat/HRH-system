import React, { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { useAction, useApi } from '../../hooks';
import { Cadre } from '../../types';
import { Alert, AsyncState, Field, Modal } from '../../components/ui';

interface Service {
  key: string;
  label_en: string;
  label_sw: string | null;
  sort_order: number;
  cadre_ids: number[];
}

const KEY_RE = /^[a-z][a-z0-9_]{1,79}$/;

/** Suggest a key from the English label, e.g. "Weekend clinic (clients)" → svc_weekend_clinic_clients. */
function keyFrom(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return slug ? `svc_${slug}`.slice(0, 80) : '';
}

function ServiceForm({ service, cadres, sortOrder, onDone, onCancel }: { service: Service | null; cadres: Cadre[]; sortOrder: number; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    key: service?.key || '',
    label_en: service?.label_en || '',
    label_sw: service?.label_sw || '',
    sort_order: String(service?.sort_order ?? sortOrder),
    cadre_ids: service?.cadre_ids || cadres.map((c) => c.id),
  });
  const [keyEdited, setKeyEdited] = useState(false);
  const { busy, error, setError, run } = useAction();

  const toggle = (id: number) =>
    setForm((f) => ({ ...f, cadre_ids: f.cadre_ids.includes(id) ? f.cadre_ids.filter((c) => c !== id) : [...f.cadre_ids, id] }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.label_en.trim()) return setError('The English label is required.');
    if (!KEY_RE.test(form.key)) return setError('The key must start with a lowercase letter and use only lowercase letters, digits and _ (2–80 characters).');
    const order = Number(form.sort_order);
    if (!Number.isInteger(order)) return setError('Sort order must be a whole number.');
    if (!service && form.cadre_ids.length === 0) return setError('Choose at least one cadre that provides this service.');
    if (service && form.cadre_ids.length === 0 && !window.confirm(`Retire “${service.label_en}”? No cadre will see it on the form. Data already recorded is kept.`)) return undefined;
    const body = { key: form.key, label_en: form.label_en.trim(), label_sw: form.label_sw.trim() || null, sort_order: order, cadre_ids: form.cadre_ids };
    const ok = await run(async () => {
      if (service) await api.put(`/admin/services/${encodeURIComponent(service.key)}`, body);
      else await api.post('/admin/services', body);
      return true;
    });
    if (ok) onDone();
    return undefined;
  };

  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid-2">
        <Field label="Service name (English) *" hint="Say what is counted, e.g. “SNS testing (clients tested)”">
          <input
            value={form.label_en}
            onChange={(e) => {
              const label_en = e.target.value;
              setForm((f) => ({ ...f, label_en, key: service || keyEdited ? f.key : keyFrom(label_en) }));
            }}
            required
            maxLength={255}
          />
        </Field>
        <Field label="Service name (Kiswahili)">
          <input value={form.label_sw} onChange={(e) => setForm((f) => ({ ...f, label_sw: e.target.value }))} maxLength={255} />
        </Field>
        <Field label="Key *" hint={service ? 'Fixed: rate rules and recorded data use it.' : 'Used by the rate rule that prices this service.'}>
          <input
            value={form.key}
            onChange={(e) => {
              setKeyEdited(true);
              setForm((f) => ({ ...f, key: e.target.value }));
            }}
            disabled={!!service || busy}
            required
            pattern="[a-z][a-z0-9_]{1,79}"
            maxLength={80}
          />
        </Field>
        <Field label="Sort order" hint="Lower numbers appear first">
          <input type="number" step={1} value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} />
        </Field>
      </div>
      <fieldset className="checks">
        <legend>Cadres that provide this service</legend>
        {cadres.map((c) => (
          <label key={c.id} className="row-inline">
            <input type="checkbox" checked={form.cadre_ids.includes(c.id)} onChange={() => toggle(c.id)} disabled={busy} /> {c.name}
          </label>
        ))}
      </fieldset>
      <Alert>{error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : service ? 'Save service' : 'Add service'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Services paid by FHI360 per client (SNS testing, CART refill, ...), and which cadres record each one. */
export function ServicesSection() {
  const { hasRole } = useAuth();
  const canWrite = hasRole('CENTRAL_ADMIN');
  const services = useApi<Service[]>('/admin/services');
  const cadres = useApi<Cadre[]>('/admin/cadres');
  const [editing, setEditing] = useState<{ service: Service | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cadreName = new Map((cadres.data || []).map((c) => [c.id, c.name]));
  const open = (service: Service | null) => {
    setNotice(null);
    setEditing({ service });
  };

  return (
    <div className="stack">
      <p className="muted">
        Providers count these services in the <b>Services</b> section of their daily work log. After the RPM approves the work log, the services
        go to FHI360 Finance as a payment claim, priced by the approved rate rule for each service key.
      </p>
      {!canWrite && <p className="notice notice-info">Read only. Changes to services require the Central Admin role.</p>}
      {canWrite && (
        <div className="row">
          <button className="btn btn-primary btn-sm" disabled={!cadres.data} onClick={() => open(null)}>
            Add service
          </button>
        </div>
      )}
      <Alert kind="success">{notice}</Alert>
      <Alert>{cadres.error}</Alert>
      <AsyncState data={services.data} error={services.error} loading={services.loading} empty="No services yet.">
        {(rows) => (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Kiswahili</th>
                  <th>Key</th>
                  <th>Cadres</th>
                  {canWrite && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.key}>
                    <td>{s.label_en}</td>
                    <td>{s.label_sw || '—'}</td>
                    <td>
                      <code>{s.key}</code>
                    </td>
                    <td>{s.cadre_ids.length ? s.cadre_ids.map((id) => cadreName.get(id) || id).join(', ') : <span className="muted">Retired</span>}</td>
                    {canWrite && (
                      <td>
                        <button className="btn btn-secondary btn-sm" disabled={!cadres.data} onClick={() => open(s)}>
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
      </AsyncState>
      {editing && cadres.data && (
        <Modal title={editing.service ? `Edit ${editing.service.label_en}` : 'Add service'} onClose={() => setEditing(null)}>
          <ServiceForm
            service={editing.service}
            cadres={cadres.data}
            sortOrder={1000 + (services.data?.length || 0)}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setEditing(null);
              setNotice(editing.service ? 'Service saved.' : 'Service added. Ask FHI360 Finance to add its rate rule.');
              services.reload();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
