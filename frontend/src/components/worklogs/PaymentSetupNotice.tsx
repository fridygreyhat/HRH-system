import React from 'react';
import { pageLang } from '../ui';

/** Explain missing setup once per service, without hiding independent failures. */
export function PaymentSetupNotice({ exceptions, workType = 'SERVICES' }: { exceptions: string[]; workType?: string }) {
  if (!exceptions.length) return null;
  const sw = pageLang() === 'sw';
  const missing = new Map<string, string[]>();
  const other: string[] = [];
  exceptions.forEach(message => {
    const match = message.match(/^(\d{4}-\d{2}-\d{2}): (.+) has no configured (?:daily amount|activity rate)\.$/);
    if (match) missing.set(match[2], [...(missing.get(match[2]) || []), match[1]]);
    else other.push(message);
  });
  const messages = Array.from(missing, ([service, dates]) => {
    const days = Array.from(new Set(dates)).sort().join(', ');
    return sw
      ? `${service}: kiasi ${workType === 'SERVICES' ? 'cha kila siku' : 'cha malipo'} kilichoidhinishwa kinahitajika kwa ${days}.`
      : `${service}: an approved ${workType === 'SERVICES' ? 'daily' : 'payment'} amount is needed for ${days}.`;
  });
  messages.push(...other.filter(message => !missing.size ||
    !['No priced activity entries are available.', 'The validated payment amount must be greater than zero.'].includes(message)));
  return <div className="alert alert-warn" role="status">
    <strong>{sw ? 'Mpangilio wa malipo unahitajika' : 'Payment setup required'}</strong>
    <p>{sw ? 'RM anaweza kuidhinisha. Malipo hayawezi kutumwa hadi viwango viwekwe.' : 'RM can approve. Payment cannot be routed until amounts are set.'}</p>
    <ul>{messages.map((message, index) => <li key={index}>{message}</li>)}</ul>
  </div>;
}
