import React, { useMemo, useState } from 'react';
import { useAuth } from '../../AuthContext';
import { useApi } from '../../hooks';
import { dateOnly, humanize } from '../../format';
import { Cadre, Organization, StaffDetail } from '../../types';
import { Alert, AsyncState, Drawer, Facts, Section, StatusBadge } from '../ui';
import { EditStaffModal, ExitDialog, LoginModal, RotateModal } from './StaffForms';
import { StaffStartDateModal } from './StaffStartDateModal';

type Dialog = 'edit' | 'start-date' | 'rotate' | 'exit' | 'login' | null;

export function StaffDrawer({ staffId, cadres, onClose, onChanged }: { staffId: number; cadres: Cadre[]; onClose: () => void; onChanged: () => void }) {
  const { hasRole } = useAuth();
  const isAdmin = hasRole('CENTRAL_ADMIN', 'REGIONAL_ADMIN');
  const isCso = hasRole('CSO_FINANCE') && !isAdmin;
  const canEdit = isAdmin || isCso;
  const canCreateLogin = hasRole('SYSTEM_ADMIN');

  const { data, error, loading, reload, setData } = useApi<StaffDetail>(`/staff/${staffId}`);
  const orgs = useApi<Organization[]>('/admin/organizations');
  const orgName = useMemo(() => new Map((orgs.data || []).map((o) => [o.id, o.name])), [orgs.data]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const done = (message: string, updated?: StaffDetail) => {
    setDialog(null);
    setNotice(message);
    if (updated) setData(updated);
    else reload();
    onChanged();
  };

  return (
    <Drawer title={data ? data.legal_name : 'Staff member'} onClose={onClose} wide>
      <AsyncState data={data} error={error} loading={loading}>
        {(s) => {
          const hasBankProfile = 'bank_name' in s || 'bank_account_number' in s || 'bank_branch' in s;
          const hasMobileProfile = 'mobile_money_number' in s;
          const hasExplicitProfile = hasBankProfile || hasMobileProfile;
          const showLegacyPayment = !hasExplicitProfile && ('payment_method' in s || 'payment_provider' in s || 'payment_account' in s);
          const cadre = cadres.find((c) => c.id === s.cadre_id);
          return (
            <div className="stack-lg">
              <div className="row">
                <StatusBadge status={s.status} />
                <span className="badge badge-neutral">{cadre ? cadre.name : s.cadre}</span>
              </div>
              <Alert kind="success">{notice}</Alert>
              {(canEdit || canCreateLogin) && (
                <div className="row">
                  {canEdit && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('edit')}>
                      {isCso ? 'Edit / request change' : 'Edit'}
                    </button>
                  )}
                  {isAdmin && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('start-date')}>
                      Edit start date
                    </button>
                  )}
                  {isAdmin && s.status === 'ACTIVE' && (
                    <>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('rotate')}>
                        Rotate assignment
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => setDialog('exit')}>
                        Exit
                      </button>
                    </>
                  )}
                  {canCreateLogin && !s.username && !s.user_id && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDialog('login')}>
                      Create login
                    </button>
                  )}
                </div>
              )}
              <Section title="Identity">
                <Facts
                  items={[
                    ['First name', s.first_name],
                    ['Middle name', s.middle_name],
                    ['Last name', s.last_name],
                    ['Verified phone', s.verified_phone],
                    ['Cadre', cadre ? `${cadre.name} (${s.cadre})` : s.cadre],
                    ['Occupation', s.occupation && s.occupation_other ? `${s.occupation}: ${s.occupation_other}` : s.occupation],
                    ['Salary scale', s.salary_scale],
                    ['Employment start', dateOnly(s.employment_start_date)],
                    ['Employment end', s.employment_end_date ? dateOnly(s.employment_end_date) : null],
                    ['Enrollment source', humanize(s.enrollment_source)],
                    ['Login', s.username || 'No login'],
                  ]}
                />
              </Section>
              {(hasExplicitProfile || showLegacyPayment) && (
                <Section title="Payment details">
                  {hasBankProfile && (
                    <>
                      <h4>Payroll · bank account</h4>
                      <Facts
                        items={[
                          ...('bank_name' in s ? [['Bank', s.bank_name] as [string, React.ReactNode]] : []),
                          ...('bank_account_number' in s ? [['Account number', s.bank_account_number] as [string, React.ReactNode]] : []),
                          ...('bank_branch' in s ? [['Branch', s.bank_branch] as [string, React.ReactNode]] : []),
                        ]}
                      />
                    </>
                  )}
                  {hasMobileProfile && (
                    <>
                      <h4>Services · mobile money</h4>
                      <Facts items={[['Mobile money number', s.mobile_money_number]]} />
                    </>
                  )}
                  {showLegacyPayment && (
                    <Facts
                      items={[
                        ['Method', s.payment_method ? humanize(s.payment_method) : null],
                        ['Provider', s.payment_provider],
                        ['Account', s.payment_account],
                      ]}
                    />
                  )}
                  <p className="muted small">Only payment channels permitted for your role and assignment scope are shown. Viewing these details is recorded in the audit log.</p>
                </Section>
              )}
              <Section title="Assignment history">
                {s.assignments.length === 0 ? (
                  <p className="muted">No assignments.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Start</th>
                          <th>End</th>
                          <th>Region</th>
                          <th>District</th>
                          <th>Ward</th>
                          <th>Facility</th>
                          <th>Community area</th>
                          <th>Section</th>
                          <th>Organization</th>
                          <th>End reason</th>
                          <th>Primary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.assignments.map((a) => (
                          <tr key={a.id}>
                            <td className="nowrap">{dateOnly(a.start_date)}</td>
                            <td className="nowrap">{a.end_date ? dateOnly(a.end_date) : <span className="badge badge-success">Current</span>}</td>
                            <td>{a.region || '—'}</td>
                            <td>{a.district || '—'}</td>
                            <td>{a.ward || '—'}</td>
                            <td>{a.facility || '—'}</td>
                            <td>{a.community_area || '—'}</td>
                            <td>{a.section || '—'}</td>
                            <td>{a.organization_id ? orgName.get(a.organization_id) || `#${a.organization_id}` : '—'}</td>
                            <td>{a.end_reason || '—'}</td>
                            <td>{a.is_primary ? 'Yes' : 'No'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Section>
              {dialog === 'edit' && (
                <EditStaffModal staff={s} cadres={cadres} csoRequest={isCso} onClose={() => setDialog(null)} onSaved={(msg) => done(msg)} />
              )}
              {dialog === 'start-date' && isAdmin && (
                <StaffStartDateModal staff={s} onClose={() => setDialog(null)} onSaved={() => done('Staff start date updated.')} />
              )}
              {dialog === 'rotate' && (
                <RotateModal staff={s} cadres={cadres} onClose={() => setDialog(null)} onDone={(u) => done('Assignment rotated.', u)} />
              )}
              {dialog === 'exit' && <ExitDialog staff={s} onClose={() => setDialog(null)} onDone={(u) => done('Staff member exited.', u)} />}
              {dialog === 'login' && (
                <LoginModal staff={s} onClose={() => setDialog(null)} onDone={(username) => done(`Login created. Username: ${username}`)} />
              )}
            </div>
          );
        }}
      </AsyncState>
    </Drawer>
  );
}
