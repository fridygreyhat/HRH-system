import React, { useState } from 'react';
import { api } from '../api';
import { useAction, useApi } from '../hooks';
import { captureLocation } from './worklogs/DayEntryForm';
import { Alert, Section } from './ui';

interface MyFacility {
  id: number;
  name: string;
  ward: string | null;
  district: string | null;
  geofence_lat: number | null;
  geofence_lon: number | null;
  geofence_radius_meters: number | null;
}

const MAX_ACCURACY_M = 100;

function FacilityRow({ facility, onSaved }: { facility: MyFacility; onSaved: () => void }) {
  const isSet = facility.geofence_lat !== null && facility.geofence_lon !== null;
  const [radius, setRadius] = useState(String(facility.geofence_radius_meters || 300));
  const [note, setNote] = useState<string | null>(null);
  const { busy, error, setError, run } = useAction();

  const useHere = async () => {
    setNote(null);
    setError(null);
    const r = Number(radius);
    if (!Number.isInteger(r) || r < 50 || r > 5000) return setError('Radius must be a whole number between 50 and 5000 metres.');
    const fix = await captureLocation();
    if (!fix) return setError('Could not read your location. Allow location for this site, turn on GPS, and try again outdoors.');
    if (fix.gps_accuracy_m > MAX_ACCURACY_M)
      return setError(`Your location is too imprecise (±${fix.gps_accuracy_m} m). Go outside or wait a moment for a better GPS signal, then try again.`);
    const ok = window.confirm(
      `Set ${facility.name} to your current position?\n\n${fix.gps_lat.toFixed(6)}, ${fix.gps_lon.toFixed(6)} (±${fix.gps_accuracy_m} m), area radius ${r} m.\n\nDo this only while you are at the facility.`,
    );
    if (!ok) return undefined;
    const saved = await run(() =>
      api.put<MyFacility>(`/admin/facilities/${facility.id}/location`, { lat: fix.gps_lat, lon: fix.gps_lon, accuracy_m: fix.gps_accuracy_m, radius_meters: r }),
    );
    if (saved) {
      setNote(`Location saved (±${fix.gps_accuracy_m} m).`);
      onSaved();
    }
    return undefined;
  };

  return (
    <div className="stack facility-location">
      <div className="row-between">
        <div>
          <strong>{facility.name}</strong>
          <div className="muted small">{[facility.ward, facility.district].filter(Boolean).join(', ')}</div>
        </div>
        {isSet ? (
          <span className="badge badge-success">
            Location set · {facility.geofence_radius_meters} m area
          </span>
        ) : (
          <span className="badge badge-warn">Location not set</span>
        )}
      </div>
      {isSet && (
        <div className="muted small">
          {Number(facility.geofence_lat).toFixed(6)}, {Number(facility.geofence_lon).toFixed(6)} ·{' '}
          <a href={`https://www.openstreetmap.org/?mlat=${facility.geofence_lat}&mlon=${facility.geofence_lon}#map=17/${facility.geofence_lat}/${facility.geofence_lon}`} target="_blank" rel="noreferrer">
            View on map
          </a>
        </div>
      )}
      <div className="row">
        <label className="row-inline small">
          Area radius (m)
          <input type="number" min={50} max={5000} step={10} value={radius} onChange={(e) => setRadius(e.target.value)} style={{ width: '6rem' }} disabled={busy} />
        </label>
        <button type="button" className={`btn btn-sm ${isSet ? 'btn-secondary' : 'btn-primary'}`} onClick={useHere} disabled={busy}>
          {busy ? 'Saving…' : isSet ? 'Update to my current location' : 'Use my current location'}
        </button>
      </div>
      <Alert>{error}</Alert>
      <Alert kind="success">{note}</Alert>
    </div>
  );
}

/** For a CTC In-Charge / Facility In-Charge: record each facility's position while standing there. */
export function FacilityLocationCard() {
  const { data, reload } = useApi<MyFacility[]>('/admin/my-facilities');
  if (!data?.length) return null;
  const missing = data.filter((f) => f.geofence_lat === null).length;
  return (
    <Section title={missing ? `Facility location needed (${missing})` : 'Facility location'}>
      <p className="muted small">
        Stand at the facility and tap the button. Health workers' daily entries are then marked as inside or outside the facility area. This never
        blocks an entry; it only helps review.
      </p>
      {data.map((f) => (
        <FacilityRow key={f.id} facility={f} onSaved={reload} />
      ))}
    </Section>
  );
}
