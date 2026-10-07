import React, { useState } from 'react';
import { api } from '../../api';
import { useAuth } from '../../AuthContext';
import { useAction } from '../../hooks';
import { WorkLogDetail } from '../../types';
import { Alert, DevCodeNotice, Field, ReasonDialog } from '../ui';

/** Provider confirmation of the frozen, verified version by SMS code (or decline with a reason). */
export function OtpPanel({ log, onChanged }: { log: WorkLogDetail; onChanged: (log: WorkLogDetail) => void }) {
  const { me, t } = useAuth();
  const length = me?.client_settings.otp_length || 4;
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(log.otp?.dev_otp || log.dev_otp || null);
  const [info, setInfo] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const confirm = useAction();
  const resend = useAction();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await confirm.run(() => api.post<WorkLogDetail>(`/worklogs/${log.id}/otp/confirm`, { code: code.trim() }));
    if (result) onChanged(result);
    else setCode('');
  };

  const requestCode = async () => {
    setInfo(null);
    const result = await resend.run(() => api.post<{ sms_status: string; dev_otp?: string }>(`/worklogs/${log.id}/otp/resend`));
    if (result) {
      setInfo(`SMS: ${result.sms_status}`);
      setDevCode(result.dev_otp || null);
    }
  };

  const decline = async (comment: string) => {
    const result = await api.post<WorkLogDetail>(`/worklogs/${log.id}/actions/decline`, { comment, expected_version: log.version });
    setDeclining(false);
    onChanged(result);
  };

  return (
    <section className="card stack" aria-labelledby="otp-title" style={{ borderColor: 'var(--primary)', borderWidth: 2 }}>
      <h3 id="otp-title">{t('otpTitle')}</h3>
      <p className="small">{t('otpIntro')}</p>
      <DevCodeNotice code={devCode} label={t('devCode')} />
      <form className="row" onSubmit={submit}>
        <Field label={t('otpCode')}>
          <input
            className="otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern={`\\d{${length}}`}
            maxLength={length}
            minLength={length}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <button className="btn btn-primary" disabled={confirm.busy || code.length !== length} style={{ alignSelf: 'flex-end' }}>
          {confirm.busy ? t('loading') : t('confirm')}
        </button>
      </form>
      <Alert>{confirm.error}</Alert>
      <div className="row">
        <button type="button" className="btn btn-secondary btn-sm" onClick={requestCode} disabled={resend.busy}>
          {t('resend')}
        </button>
        {log.available_actions.includes('decline') && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDeclining(true)}>
            {t('decline')}
          </button>
        )}
      </div>
      <Alert kind="info">{info}</Alert>
      <Alert>{resend.error}</Alert>
      {declining && (
        <ReasonDialog
          title={t('decline')}
          description={t('declineReason')}
          required
          danger
          confirmLabel={t('decline')}
          onConfirm={decline}
          onClose={() => setDeclining(false)}
        />
      )}
    </section>
  );
}
