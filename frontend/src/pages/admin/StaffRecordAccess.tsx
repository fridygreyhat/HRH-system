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
      <p className="muted small">Link only if this person also works as a CHW, Data Clerk or HCP; it adds the Provider role.</p>
      <div>
        <button type="button" className="btn btn-secondary" aria-expanded={linking} onClick={() => setLinking(!linking)}>
          {linking ? 'Cancel staff linking' : 'Also works as a provider? Link staff record'}
        </button>
      </div>
      {linking && children}
    </section>
  );
}
