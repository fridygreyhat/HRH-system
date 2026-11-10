import React, { useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { api } from '../../api';
import { useApi } from '../../hooks';
import { dateTime, humanize } from '../../format';
import { Cadre, ChangeRequest } from '../../types';
import { Alert, AsyncState, PersonCell, ReasonDialog, StatusBadge, Tabs } from '../ui';

type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
const STATUSES: { key: RequestStatus; en: string; sw: string }[] = [
  { key: 'PENDING', en: 'Pending', sw: 'Zinasubiri' },
  { key: 'APPROVED', en: 'Approved', sw: 'Zimeidhinishwa' },
  { key: 'REJECTED', en: 'Rejected', sw: 'Zimekataliwa' },
];
const STATUS_SW: Record<string, string> = { PENDING: 'Inasubiri', APPROVED: 'Imeidhinishwa', REJECTED: 'Imekataliwa' };

function ChangeValue({ field, value, cadres, sw }: { field: string; value: unknown; cadres: Map<number, string>; sw: boolean }) {
  if (value === null || value === undefined || value === '') return <span className="muted">{sw ? '(imefutwa)' : '(cleared)'}</span>;
  if (field === 'cadre_id' && typeof value === 'number') return <>{cadres.get(value) || `#${value}`}</>;
  if (field === 'status' || field === 'payment_method') return <>{humanize(String(value))}</>;
  return <>{typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : JSON.stringify(value)}</>;
}

export function ChangeRequests({ cadres }: { cadres: Cadre[] }) {
  const { me, hasRole, lang } = useAuth();
  const sw = lang === 'sw';
  const isAdmin = hasRole('CENTRAL_ADMIN', 'REGIONAL_ADMIN');
  const [status, setStatus] = useState<RequestStatus>('PENDING');
  const { data, error, loading, reload } = useApi<ChangeRequest[]>(`/staff/change-requests?status=${status}`);
  const [deciding, setDeciding] = useState<{ request: ChangeRequest; approve: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const cadreNames = useMemo(() => new Map(cadres.map((c) => [c.id, c.name])), [cadres]);

  return (
    <div className="stack">
      <div className="toolbar">
        <Tabs label={sw ? 'Hali ya maombi' : 'Request status'} value={status} onChange={setStatus} tabs={STATUSES.map((s) => ({ key: s.key, label: sw ? s.sw : s.en }))} />
      </div>
      <Alert kind="success">{notice}</Alert>
      <AsyncState data={data} error={error} loading={loading} empty={sw ? 'Hakuna maombi ya mabadiliko hapa.' : `No ${humanize(status).toLowerCase()} change requests.`}>
        {(rows) => (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{sw ? 'Mtumishi' : 'Staff member'}</th>
                  <th>{sw ? 'Mabadiliko yaliyoombwa' : 'Requested changes'}</th>
                  <th>{sw ? 'Sababu' : 'Reason'}</th>
                  <th>{sw ? 'Aliyeomba' : 'Requested'}</th>
                  <th>{sw ? 'Hali' : 'Status'}</th>
                  <th>{sw ? 'Uamuzi' : 'Decision'}</th>
                  {isAdmin && status === 'PENDING' && <th>{sw ? 'Hatua' : 'Actions'}</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <PersonCell name={r.staff_name} sub={`${sw ? 'Ombi' : 'Request'} #${r.id}`} />
                    </td>
                    <td>
                      <ul className="small" style={{ margin: 0, paddingLeft: '1rem' }}>
                        {Object.entries(r.changes).map(([k, v]) => (
                          <li key={k}>
                            <strong>{humanize(k)}:</strong> <ChangeValue field={k} value={v} cadres={cadreNames} sw={sw} />
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>{r.reason}</td>
                    <td>
                      <span className="cell-main">{r.requested_by_name}</span>
                      <span className="cell-sub">{dateTime(r.created_at)}</span>
                    </td>
                    <td>
                      <StatusBadge status={r.status} label={sw ? STATUS_SW[r.status] : undefined} />
                    </td>
                    <td>
                      {r.decided_at ? (
                        <>
                          <span className="cell-sub">{dateTime(r.decided_at)}</span>
                          {r.decision_comment && <div className="small">“{r.decision_comment}”</div>}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    {isAdmin && status === 'PENDING' && (
                      <td>
                        {r.requested_by === me?.id ? (
                          <span className="muted small">{sw ? 'Ombi lako mwenyewe' : 'Your own request'}</span>
                        ) : (
                          <div className="row nowrap">
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => setDeciding({ request: r, approve: true })}>
                              {sw ? 'Idhinisha' : 'Approve'}
                            </button>
                            <button type="button" className="btn btn-danger btn-sm" onClick={() => setDeciding({ request: r, approve: false })}>
                              {sw ? 'Kataa' : 'Reject'}
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
          title={
            sw
              ? `${deciding.approve ? 'Idhinisha' : 'Kataa'} ombi la mabadiliko #${deciding.request.id}`
              : `${deciding.approve ? 'Approve' : 'Reject'} change request #${deciding.request.id}`
          }
          description={
            deciding.approve
              ? sw
                ? `Mabadiliko yataingizwa kwenye rekodi ya ${deciding.request.staff_name} mara moja.`
                : `The requested changes are applied to ${deciding.request.staff_name}'s record immediately.`
              : sw
                ? `Mabadiliko hayataingizwa. ${deciding.request.requested_by_name} ataona maoni yako.`
                : `The changes are not applied. ${deciding.request.requested_by_name} will see your comment.`
          }
          required={!deciding.approve}
          danger={!deciding.approve}
          confirmLabel={deciding.approve ? (sw ? 'Idhinisha na uingize' : 'Approve and apply') : sw ? 'Kataa ombi' : 'Reject request'}
          onClose={() => setDeciding(null)}
          onConfirm={async (comment) => {
            await api.post(`/staff/change-requests/${deciding.request.id}/decide`, { approve: deciding.approve, comment: comment || null });
            setNotice(sw ? `Ombi #${deciding.request.id} ${deciding.approve ? 'limeidhinishwa' : 'limekataliwa'}.` : `Change request #${deciding.request.id} ${deciding.approve ? 'approved' : 'rejected'}.`);
            setDeciding(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
