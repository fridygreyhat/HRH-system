import React, { useState } from 'react';
import { AdminUser } from '../../types';

/** Staff records are required for providers, not finance or approval roles. */
export function StaffRecordAccess({
  user,
  children,
}: {
  user: Pick<AdminUser, 'roles' | 'staff_id' | 'is_active'>;
  children: React.ReactNode;
}) {
  const [linking, setLinking] = useState(false);
  if (user.staff_id || !user.is_active) return null;
  if (user.roles.includes('PROVIDER')) return <>{children}</>;
  return (
    <section className="stack card">
      <h3>Staff record: not required</h3>
      <p>
        Finance, administration and approval accounts do not need a health-worker staff record.
        This does not prevent access to their assigned duties.
      </p>
      <p className="muted small">
        Only link a staff record if this person also works as a CHW, Data Clerk or HCP.
        Linking adds the Provider role and work-log access.
      </p>
      <div>
        <button type="button" className="btn" aria-expanded={linking} onClick={() => setLinking(!linking)}>
          {linking ? 'Cancel staff linking' : 'Also works as a provider? Link staff record'}
        </button>
      </div>
      {linking && children}
    </section>
  );
}
