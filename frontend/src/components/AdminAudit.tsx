import React from 'react';
import { useAuth } from '../AuthContext';

export const AUDIT_ADMIN_ROLES = ['SUPER_ADMIN', 'SYSTEM_ADMIN', 'CENTRAL_ADMIN'];

/** Audit records remain stored; only administrative accounts may render them. */
export function AdminAudit({ children }: { children: React.ReactNode }) {
  const { hasRole } = useAuth();
  return hasRole(...AUDIT_ADMIN_ROLES) ? <>{children}</> : null;
}
