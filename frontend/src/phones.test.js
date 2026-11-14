import { normalizeTzMobile, phoneCheckText } from './phones';

test('only Tanzanian mobiles are accepted, written as people type them, and saved as +255', () => {
  expect(normalizeTzMobile('0712 345 678')).toBe('+255712345678');
  expect(normalizeTzMobile('0655-123-456')).toBe('+255655123456');
  expect(normalizeTzMobile('255712345678')).toBe('+255712345678');
  expect(normalizeTzMobile('+255 712 345 678')).toBe('+255712345678');
  for (const bad of ['0812345678', '+15551234567', '071234567', '', 'phone']) expect(normalizeTzMobile(bad)).toBeNull();
});

test('the record says whether the SMS reached the number', () => {
  expect(phoneCheckText({ status: 'SENT', at: null, event: 'WELCOME' }).tone).toBe('success');
  expect(phoneCheckText({ status: 'FAILED', at: null, event: 'WELCOME' }).text).toContain('check the number');
  expect(phoneCheckText(null)).toBeNull();
});
