import React, { useState } from 'react';
import { CrudTable, FieldSpec, Option, TableSpec } from './CrudTable';
import { Row, refName, nameMap } from './common';

const CENTRAL = ['CENTRAL_ADMIN'];
const FINANCE = ['FHI360_FINANCE'];

const opts = (...values: string[]): Option[] => values.map((v) => ({ value: v, label: v }));

const GEOFENCE_FIELDS: FieldSpec[] = [
  { key: 'geofence_lat', label: 'Geofence latitude', type: 'number', step: '0.00000001', hint: 'Decimal degrees, e.g. -7.77' },
  { key: 'geofence_lon', label: 'Geofence longitude', type: 'number', step: '0.00000001', hint: 'Decimal degrees, e.g. 35.69' },
  { key: 'geofence_radius_meters', label: 'Geofence radius (m)', type: 'integer', hint: 'Leave all three geofence fields blank for no geofence' },
];

function validateGeofence(p: Row): string | null {
  const parts = [p.geofence_lat, p.geofence_lon, p.geofence_radius_meters];
  const set = parts.filter((v) => v !== null).length;
  if (set !== 0 && set !== 3) return 'Fill in latitude, longitude and radius together, or leave all three blank.';
  if (typeof p.geofence_lat === 'number' && Math.abs(p.geofence_lat) > 90) return 'Latitude must be between -90 and 90.';
  if (typeof p.geofence_lon === 'number' && Math.abs(p.geofence_lon) > 180) return 'Longitude must be between -180 and 180.';
  if (typeof p.geofence_radius_meters === 'number' && p.geofence_radius_meters <= 0) return 'Radius must be greater than zero.';
  return null;
}

/** "Gangilonga — Iringa Municipal": ward names repeat across districts, so show the parent. */
const wardLabel = (r: Row, lists: Record<string, Row[]>) =>
  `${String(r.name)} — ${refName(nameMap(lists['/admin/districts']), r.district_id)}`;

export const TABLES: TableSpec[] = [
  {
    key: 'organizations',
    title: 'Organizations',
    singular: 'organization',
    path: '/admin/organizations',
    writeRoles: CENTRAL,
    description: 'Payors, CSOs and partners. A CSO is the executor for Route B and Route C claims.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 255 },
      { key: 'code', label: 'Code', type: 'text', maxLength: 50 },
      { key: 'type', label: 'Type', type: 'select', required: true, options: opts('FHI360', 'CSO', 'PAYOR', 'PARTNER') },
      { key: 'is_active', label: 'Active', type: 'bool', defaultValue: true },
    ],
  },
  {
    key: 'regions',
    title: 'Regions',
    singular: 'region',
    path: '/admin/regions',
    writeRoles: CENTRAL,
    fields: [{ key: 'name', label: 'Name', type: 'text', required: true, maxLength: 255 }],
  },
  {
    key: 'clusters',
    title: 'Clusters',
    singular: 'cluster',
    path: '/admin/clusters',
    writeRoles: CENTRAL,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 255 },
      { key: 'region_id', label: 'Region', type: 'select', required: true, ref: { path: '/admin/regions' } },
    ],
  },
  {
    key: 'districts',
    title: 'Districts',
    singular: 'district',
    path: '/admin/districts',
    writeRoles: CENTRAL,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 255 },
      { key: 'region_id', label: 'Region', type: 'select', required: true, ref: { path: '/admin/regions' } },
    ],
  },
  {
    key: 'wards',
    title: 'Wards',
    singular: 'ward',
    path: '/admin/wards',
    writeRoles: CENTRAL,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 255 },
      { key: 'district_id', label: 'District', type: 'select', required: true, ref: { path: '/admin/districts' } },
    ],
  },
  {
    key: 'facilities',
    title: 'Facilities',
    singular: 'facility',
    path: '/admin/facilities',
    writeRoles: CENTRAL,
    extraPaths: ['/admin/districts'],
    description: 'The geofence is used to flag facility work-log entries recorded outside the facility area. It never blocks an entry.',
    validate: validateGeofence,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 255 },
      { key: 'ward_id', label: 'Ward', type: 'select', required: true, ref: { path: '/admin/wards', label: wardLabel } },
      { key: 'cluster_id', label: 'Cluster', type: 'select', ref: { path: '/admin/clusters' } },
      { key: 'facility_type', label: 'Facility type', type: 'text', maxLength: 50, hint: 'e.g. PUBLIC or PNP' },
      ...GEOFENCE_FIELDS,
      { key: 'is_active', label: 'Active', type: 'bool', defaultValue: true },
    ],
  },
  {
    key: 'community-areas',
    title: 'Community areas',
    singular: 'community area',
    path: '/admin/community-areas',
    writeRoles: CENTRAL,
    extraPaths: ['/admin/districts'],
    validate: validateGeofence,
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 255 },
      { key: 'district_id', label: 'District', type: 'select', required: true, ref: { path: '/admin/districts' } },
      { key: 'ward_id', label: 'Ward', type: 'select', ref: { path: '/admin/wards', label: wardLabel } },
      ...GEOFENCE_FIELDS,
    ],
  },
  {
    key: 'sections',
    title: 'Sections',
    singular: 'section',
    path: '/admin/sections',
    writeRoles: CENTRAL,
    pk: 'code',
    description: 'Facility sections offered on cadre forms that use a section (CTC, OPD, RCH…).',
    fields: [
      { key: 'code', label: 'Code', type: 'text', required: true, maxLength: 20, immutable: true },
      { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 100 },
    ],
  },
  {
    key: 'pay-periods',
    title: 'Pay periods',
    singular: 'pay period',
    path: '/admin/pay-periods',
    writeRoles: ['CENTRAL_ADMIN', 'FHI360_FINANCE'],
    validate: (p) => (String(p.end_date) < String(p.start_date) ? 'The end date is before the start date.' : null),
    fields: [
      { key: 'period_label', label: 'Label', type: 'text', maxLength: 100, hint: 'e.g. October 2026' },
      { key: 'start_date', label: 'Start date', type: 'date', required: true },
      { key: 'end_date', label: 'End date', type: 'date', required: true },
      { key: 'status', label: 'Status', type: 'select', required: true, options: opts('OPEN', 'CLOSED'), defaultValue: 'OPEN', badge: true },
    ],
  },
  {
    key: 'funding-sources',
    title: 'Funding sources',
    singular: 'funding source',
    path: '/admin/funding-sources',
    writeRoles: FINANCE,
    fields: [
      { key: 'code', label: 'Code', type: 'text', required: true, maxLength: 50 },
      { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 255 },
    ],
  },
  {
    key: 'claim-categories',
    title: 'Claim categories',
    singular: 'claim category',
    path: '/admin/claim-categories',
    writeRoles: FINANCE,
    description:
      'A category decides the payment route, payor, budget owner and budget line of its claims. A category without a route is flagged as an exception on every claim.',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 255 },
      { key: 'form_type', label: 'Form type', type: 'text', maxLength: 50, hint: 'e.g. CHW_PNP, HCP_PNP, COORDINATION, SALARY, COMMUNITY_SERVICE' },
      {
        key: 'route_id',
        label: 'Payment route',
        type: 'select',
        ref: { path: '/admin/payment-routes', label: (r) => `Route ${String(r.code)} — ${String(r.name)}` },
      },
      {
        key: 'funding_source_id',
        label: 'Funding source',
        type: 'select',
        ref: { path: '/admin/funding-sources', label: (r) => `${String(r.code)} — ${String(r.name)}` },
      },
      { key: 'payor_org_id', label: 'Payor organization', type: 'select', ref: { path: '/admin/organizations' }, hint: 'Leave blank for Route C (the assigned CSO pays)' },
      { key: 'budget_owner', label: 'Budget owner', type: 'select', required: true, options: opts('PAYOR', 'EXECUTOR'), defaultValue: 'PAYOR' },
      {
        key: 'origin_channel',
        label: 'Origin channel',
        type: 'select',
        required: true,
        options: opts('FACILITY', 'COMMUNITY'),
        defaultValue: 'FACILITY',
      },
      { key: 'budget_line_code', label: 'Budget line code', type: 'text', maxLength: 100 },
      { key: 'requires_work_log', label: 'Requires an approved work log', type: 'bool', defaultValue: true },
      { key: 'is_active', label: 'Active', type: 'bool', defaultValue: true },
    ],
  },
];

export function ConfigSection() {
  const [tableKey, setTableKey] = useState(TABLES[0].key);
  const spec = TABLES.find((t) => t.key === tableKey) || TABLES[0];
  return (
    <div className="stack">
      <nav className="subnav" aria-label="Configuration tables">
        {TABLES.map((t) => (
          <button key={t.key} type="button" aria-current={t.key === spec.key ? 'page' : undefined} onClick={() => setTableKey(t.key)}>
            {t.title}
          </button>
        ))}
      </nav>
      <section className="card">
        <CrudTable key={spec.key} spec={spec} />
      </section>
    </div>
  );
}
