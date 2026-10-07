import React, { useMemo, useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { dateOnly, roleLabel } from '../../format';
import { useAction, useApi } from '../../hooks';
import { Alert, AsyncState, Drawer, Field, StatusBadge } from '../../components/ui';
import { Row, matches, nameMap, refName, useLookups } from './common';

export type FieldType = 'text' | 'number' | 'integer' | 'date' | 'bool' | 'select';

export interface Option {
  value: string;
  label: string;
}

/** A select whose options come from another configuration endpoint. */
export interface RefSpec {
  path: string;
  /** Display label for one option; `lists` holds every list the table loaded (for "Ward — District" style labels). */
  label?: (row: Row, lists: Record<string, Row[]>) => string;
}

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  /** Fixed options for a select. */
  options?: Option[];
  /** Options loaded from another endpoint; values are ids (sent as numbers). */
  ref?: RefSpec;
  /** Value for a new row. */
  defaultValue?: string | boolean;
  /** Can be set on create only (e.g. a natural primary key). */
  immutable?: boolean;
  step?: string;
  maxLength?: number;
  /** Render the value as a status badge in the list. */
  badge?: boolean;
  hideInList?: boolean;
}

export interface TableSpec {
  key: string;
  title: string;
  /** Singular noun for buttons, e.g. "facility". */
  singular: string;
  path: string;
  writeRoles: string[];
  fields: FieldSpec[];
  pk?: string;
  description?: React.ReactNode;
  /** Extra lookup lists used only by ref labels. */
  extraPaths?: string[];
  /** Cross-field validation on the payload; return an error message or null. */
  validate?: (payload: Row) => string | null;
}

type FormValues = Record<string, string | boolean>;

function optionsFor(f: FieldSpec, lists: Record<string, Row[]>): Option[] {
  if (f.options) return f.options;
  if (f.ref) {
    const ref = f.ref;
    return (lists[ref.path] || []).map((r) => ({ value: String(r.id), label: ref.label ? ref.label(r, lists) : String(r.name ?? r.id) }));
  }
  return [];
}

function display(f: FieldSpec, value: unknown, refMaps: Record<string, Map<string, string>>): React.ReactNode {
  if (f.type === 'bool') return value ? 'Yes' : 'No';
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  if (f.ref) return refName(refMaps[f.key], value);
  if (f.badge) return <StatusBadge status={String(value)} />;
  if (f.options) return f.options.find((o) => o.value === String(value))?.label ?? String(value);
  if (f.type === 'date') return dateOnly(String(value));
  return String(value);
}

function initialValues(fields: FieldSpec[], row: Row | null): FormValues {
  const out: FormValues = {};
  fields.forEach((f) => {
    if (!row) {
      out[f.key] = f.defaultValue ?? (f.type === 'bool' ? false : '');
      return;
    }
    const v = row[f.key];
    out[f.key] = f.type === 'bool' ? Boolean(v) : v === null || v === undefined ? '' : String(v);
  });
  return out;
}

/** Build the complete row the API expects: every column is sent, blanks become null. */
function toPayload(fields: FieldSpec[], values: FormValues): { payload: Row; error: string | null } {
  const payload: Row = {};
  for (const f of fields) {
    const raw = values[f.key];
    if (f.type === 'bool') {
      payload[f.key] = Boolean(raw);
      continue;
    }
    const s = String(raw ?? '').trim();
    if (!s) {
      if (f.required) return { payload, error: `${f.label} is required.` };
      payload[f.key] = null;
      continue;
    }
    if (f.type === 'number' || f.type === 'integer') {
      const n = Number(s);
      if (!Number.isFinite(n) || (f.type === 'integer' && !Number.isInteger(n))) {
        return { payload, error: `${f.label} must be ${f.type === 'integer' ? 'a whole number' : 'a number'}.` };
      }
      payload[f.key] = n;
    } else if (f.type === 'select' && f.ref) {
      payload[f.key] = Number(s);
    } else {
      payload[f.key] = s;
    }
  }
  return { payload, error: null };
}

function FieldInput({
  f,
  value,
  onChange,
  disabled,
  lists,
}: {
  f: FieldSpec;
  value: string | boolean;
  onChange: (v: string | boolean) => void;
  disabled: boolean;
  lists: Record<string, Row[]>;
}) {
  if (f.type === 'bool') {
    return (
      <label className="row-inline">
        <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} disabled={disabled} /> {f.label}
      </label>
    );
  }
  const label = `${f.label}${f.required ? ' *' : ''}`;
  const hint = disabled && f.immutable ? `${f.hint ? `${f.hint} ` : ''}This is the record's key and cannot be changed.` : f.hint;
  if (f.type === 'select') {
    return (
      <Field label={label} hint={hint}>
        <select value={String(value)} onChange={(e) => onChange(e.target.value)} disabled={disabled} required={f.required}>
          <option value="">{f.required ? 'Choose…' : '— None —'}</option>
          {optionsFor(f, lists).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  return (
    <Field label={label} hint={hint}>
      <input
        type={f.type === 'date' ? 'date' : f.type === 'text' ? 'text' : 'number'}
        step={f.type === 'integer' ? '1' : f.step || 'any'}
        inputMode={f.type === 'integer' ? 'numeric' : f.type === 'number' ? 'decimal' : undefined}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        required={f.required}
        maxLength={f.maxLength}
      />
    </Field>
  );
}

function CrudForm({
  spec,
  row,
  lists,
  onDone,
  onCancel,
}: {
  spec: TableSpec;
  row: Row | null;
  lists: Record<string, Row[]>;
  onDone: (saved: Row) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>(() => initialValues(spec.fields, row));
  const { busy, error, setError, run } = useAction();
  const pk = spec.pk || 'id';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { payload, error: invalid } = toPayload(spec.fields, values);
    const crossError = invalid || (spec.validate ? spec.validate(payload) : null);
    if (crossError) {
      setError(crossError);
      return;
    }
    const saved = await run(() =>
      row ? api.put<Row>(`${spec.path}/${encodeURIComponent(String(row[pk]))}`, payload) : api.post<Row>(spec.path, payload),
    );
    if (saved) onDone(saved);
  };

  const bools = spec.fields.filter((f) => f.type === 'bool');
  return (
    <form className="stack" onSubmit={submit}>
      <div className="grid-2">
        {spec.fields
          .filter((f) => f.type !== 'bool')
          .map((f) => (
            <FieldInput
              key={f.key}
              f={f}
              value={values[f.key]}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              disabled={busy || (!!row && !!f.immutable)}
              lists={lists}
            />
          ))}
      </div>
      {bools.length > 0 && (
        <fieldset className="checks">
          <legend>Options</legend>
          {bools.map((f) => (
            <FieldInput
              key={f.key}
              f={f}
              value={values[f.key]}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              disabled={busy}
              lists={lists}
            />
          ))}
        </fieldset>
      )}
      {row && <p className="muted small">Saving replaces every field of this record with the values above.</p>}
      <Alert>{error}</Alert>
      <div className="row">
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : row ? 'Save changes' : 'Create'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** List / create / edit for one configuration table, driven entirely by its field spec. */
export function CrudTable({ spec }: { spec: TableSpec }) {
  const { hasRole } = useAuth();
  const canWrite = hasRole(...spec.writeRoles);
  const { data, error, loading, reload } = useApi<Row[]>(spec.path);
  const refPaths = useMemo(
    () => Array.from(new Set([...spec.fields.filter((f) => f.ref).map((f) => (f.ref as RefSpec).path), ...(spec.extraPaths || [])])),
    [spec],
  );
  const { lists, error: lookupError } = useLookups(refPaths);
  const refMaps = useMemo(() => {
    const maps: Record<string, Map<string, string>> = {};
    spec.fields.forEach((f) => {
      if (f.ref) {
        const ref = f.ref;
        maps[f.key] = nameMap(lists[ref.path], ref.label ? (r) => (ref.label as NonNullable<RefSpec['label']>)(r, lists) : undefined);
      }
    });
    return maps;
  }, [spec, lists]);
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const pk = spec.pk || 'id';
  const listFields = spec.fields.filter((f) => !f.hideInList);

  const rows = (data || []).filter((r) =>
    matches(query, ...listFields.map((f) => (f.ref ? refName(refMaps[f.key], r[f.key]) : r[f.key])), r[pk]),
  );

  return (
    <div className="stack">
      <div className="section-head">
        <h3>{spec.title}</h3>
        {canWrite && (
          <button
            className="btn btn-primary"
            onClick={() => {
              setNotice(null);
              setEditing({ row: null });
            }}
          >
            Add {spec.singular}
          </button>
        )}
      </div>
      {spec.description && <p className="muted">{spec.description}</p>}
      {!canWrite && (
        <p className="notice notice-info">
          Read only. Changes require the role{spec.writeRoles.length > 1 ? 's' : ''} {spec.writeRoles.map(roleLabel).join(' or ')}.
        </p>
      )}
      <Alert kind="success">{notice}</Alert>
      <Alert>{lookupError}</Alert>
      <div className="filters">
        <Field label="Search">
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter rows" />
        </Field>
      </div>
      <AsyncState data={data} error={error} loading={loading} empty="No records yet.">
        {() =>
          rows.length === 0 ? (
            <p className="empty">No records match the search.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {pk === 'id' && <th className="num">ID</th>}
                    {listFields.map((f) => (
                      <th key={f.key}>{f.label}</th>
                    ))}
                    {canWrite && <th>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={String(r[pk])}>
                      {pk === 'id' && <td className="num">{String(r.id)}</td>}
                      {listFields.map((f) => (
                        <td key={f.key} className={f.type === 'number' || f.type === 'integer' ? 'num' : undefined}>
                          {display(f, r[f.key], refMaps)}
                        </td>
                      ))}
                      {canWrite && (
                        <td>
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setNotice(null);
                              setEditing({ row: r });
                            }}
                          >
                            Edit
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </AsyncState>
      {editing && (
        <Drawer
          title={editing.row ? `Edit ${spec.singular}` : `New ${spec.singular}`}
          onClose={() => setEditing(null)}
        >
          <CrudForm
            spec={spec}
            row={editing.row}
            lists={lists}
            onCancel={() => setEditing(null)}
            onDone={() => {
              setNotice(editing.row ? 'Changes saved.' : 'Record created.');
              setEditing(null);
              reload();
            }}
          />
        </Drawer>
      )}
    </div>
  );
}
