import React, { useState } from 'react';
import { useAuth } from '../AuthContext';
import { CadresSection } from './admin/CadresSection';
import { ConfigSection } from './admin/ConfigSection';
import { AuditSection, OutboxSection } from './admin/LogsSections';
import { RateRulesSection } from './admin/RateRulesSection';
import { SettingsSection } from './admin/SettingsSection';
import { SmsTemplatesSection } from './admin/SmsTemplatesSection';
import { UsersSection } from './admin/UsersSection';

const ADMIN_AREA = ['SYSTEM_ADMIN', 'CENTRAL_ADMIN', 'FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT'];

interface AdminSection {
  key: string;
  label: string;
  roles: string[];
  render: () => React.ReactNode;
}

const SECTIONS: AdminSection[] = [
  { key: 'users', label: 'Users', roles: ['SYSTEM_ADMIN'], render: () => <UsersSection /> },
  { key: 'config', label: 'Configuration', roles: ADMIN_AREA, render: () => <ConfigSection /> },
  { key: 'cadres', label: 'Cadre forms', roles: ADMIN_AREA, render: () => <CadresSection /> },
  { key: 'rates', label: 'Rate rules', roles: ['FHI360_FINANCE', 'CSO_FINANCE', 'RPM', 'OVERSIGHT'], render: () => <RateRulesSection /> },
  { key: 'settings', label: 'Settings', roles: ['SYSTEM_ADMIN', 'OVERSIGHT'], render: () => <SettingsSection /> },
  { key: 'sms', label: 'SMS templates', roles: ['RPM', 'OVERSIGHT', 'SYSTEM_ADMIN'], render: () => <SmsTemplatesSection /> },
  { key: 'outbox', label: 'SMS outbox', roles: ['SYSTEM_ADMIN', 'OVERSIGHT'], render: () => <OutboxSection /> },
  { key: 'audit', label: 'Audit events', roles: ['SYSTEM_ADMIN', 'SUPER_ADMIN', 'CENTRAL_ADMIN'], render: () => <AuditSection /> },
];

export function Admin() {
  const { hasRole } = useAuth();
  const visible = SECTIONS.filter((s) => hasRole(...s.roles));
  const [key, setKey] = useState<string | null>(null);
  const current = visible.find((s) => s.key === key) || visible[0];

  if (!current) {
    return <p className="notice">Your roles do not include any administration sections.</p>;
  }

  return (
    <div className="stack-lg">
      <div className="page-header">
        <h1>Administration</h1>
      </div>
      <nav className="subnav" aria-label="Administration sections">
        {visible.map((s) => (
          <button key={s.key} type="button" aria-current={s.key === current.key ? 'page' : undefined} onClick={() => setKey(s.key)}>
            {s.label}
          </button>
        ))}
      </nav>
      <div key={current.key}>{current.render()}</div>
    </div>
  );
}
