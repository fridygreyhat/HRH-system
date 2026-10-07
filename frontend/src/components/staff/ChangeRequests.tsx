import React, { useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { api } from '../../api';
import { useApi } from '../../hooks';
import { dateTime, humanize } from '../../format';
import { Cadre, ChangeRequest } from '../../types';
import { Alert, AsyncState, Field, ReasonDialog, StatusBadge } from '../ui';

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];

function ChangeValue({ field, value, cadres }: { field: string; value: unknown; cadres: Map<number, string> }) {
  if (value === null || value === undefined || value === '') return <span className="muted">(cleared)</span>;
  if (field === 'cadre_id' && typeof value === 'number') return <>{cadres.get(value) || `#${value}`}</>;
  if (field === 'status' || field === 'payment_method') return <>{humanize(String(value))}</>;
  return <>{typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value)}</>;
}

export function ChangeRequests({ cadres }: { cadres: Cadre[] }) {
  const { me, hasRole } = useAuth();
  const isAdmin = hasRole('CENTRAL_ADMIN', 'REGIONAL_ADMIN');
  const [status, setStatus] = useState('PENDING');
  const { data, error, loading, reload } = useApi<ChangeRequest[]>(`/staff/change-requests?status=${status}`);
  const [deciding, setDeciding] = useState<{ request: ChangeRequest; approve: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cadreNames = useMemo(() => new Map(cadres.map((c) => [c.id, c.name])), [cadres]);

  return (
    <div className="stack">
      <p className="muted small">
        {isAdmin
          ? 'Payment-critical changes requested by CSO finance. Approving applies the change to the staff record; you cannot decide your own requests.'
          : 'Your requests to change payment-critical staff details. HRH administrators approve or reject them.'}
      </p>
      <div className="filters">
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Alert kind="success">{notice}</Alert>
      <AsyncState data={data} error={error} loading={loading} empty={`No ${humanize(status).toLowerCase()} change requests.`}>
        {(rows) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Staff member</th>
                  <th>Requested changes</th>
                  <th>Reason</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Decision</th>
                  {isAdmin && status === 'PENDING' && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.staff_name}</td>
                    <td>
                      <ul className="small" style={{ margin: 0, paddingLeft: '1rem' }}>
                        {Object.entries(r.changes).map(([k, v]) => (
                          <li key={k}>
                            <strong>{humanize(k)}:</strong> <ChangeValue field={k} value={v} cadres={cadreNames} />
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>{r.reason}</td>
                    <td>
                      {r.requested_by_name}
                      <div className="muted small nowrap">{dateTime(r.created_at)}</div>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>
                      {r.decided_at ? (
                        <>
                          <div className="small nowrap">{dateTime(r.decided_at)}</div>
                          {r.decision_comment && <div className="small">“{r.decision_comment}”</div>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    {isAdmin && status === 'PENDING' && (
                      <td>
                        {r.requested_by === me?.id ? (
                          <span className="muted small">Your own request</span>
                        ) : (
                          <div className="row">
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDeciding({ request: r, approve: true })}>
                              Approve
                            </button>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeciding({ request: r, approve: false })}>
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AsyncState>
      {deciding && (
        <ReasonDialog
          title={`${deciding.approve ? 'Approve' : 'Reject'} change request #${deciding.request.id}`}
          description={
            deciding.approve
              ? `The requested changes are applied to ${deciding.request.staff_name}'s record immediately.`
              : `The changes are not applied. ${deciding.request.requested_by_name} will see your comment.`
          }
          required={!deciding.approve}
          danger={!deciding.approve}
          confirmLabel={deciding.approve ? 'Approve and apply' : 'Reject request'}
          onClose={() => setDeciding(null)}
          onConfirm={async (comment) => {
            await api.post(`/staff/change-requests/${deciding.request.id}/decide`, { approve: deciding.approve, comment: comment || null });
            setNotice(`Change request #${deciding.request.id} ${deciding.approve ? 'approved' : 'rejected'}.`);
            setDeciding(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
