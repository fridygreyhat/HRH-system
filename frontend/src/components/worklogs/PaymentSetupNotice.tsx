import React from 'react';

/** Explain missing setup once per service, without hiding independent failures. */
export function PaymentSetupNotice({ exceptions, workType = 'SERVICES' }: { exceptions: string[]; workType?: string }) {
  if (!exceptions.length) return null;
  const missing = new Map<string, string[]>();
  const other: string[] = [];
  exceptions.forEach(message => {
    const match = message.match(/^(\d{4}-\d{2}-\d{2}): (.+) has no configured (?:daily amount|activity rate)\.$/);
    if (match) missing.set(match[2], [...(missing.get(match[2]) || []), match[1]]);
    else other.push(message);
  });
  const messages = Array.from(missing, ([service, dates]) =>
    `${service}: an approved ${workType === 'SERVICES' ? 'daily' : 'payment'} amount is needed for ${Array.from(new Set(dates)).sort().join(', ')}.`);
  messages.push(...other.filter(message => !missing.size ||
    !['No priced activity entries are available.', 'The validated payment amount must be greater than zero.'].includes(message)));
  return <div className="alert alert-warn" role="status">
    <strong>Payment setup required</strong>
    <p>RM can approve the work. Finance cannot prepare or route payment until the missing approved amounts are configured for the work dates.</p>
    <ul>{messages.map((message, index) => <li key={index}>{message}</li>)}</ul>
  </div>;
}
