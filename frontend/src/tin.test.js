import { normalizeTin, TIN_MESSAGE } from './tin';
import { emptyHealthWorker, healthWorkerPayload } from './components/staff/HealthWorkerFields';

test('a TIN is optional, 9 digits, and kept as 123-456-789', () => {
  expect(normalizeTin('')).toBe('');
  expect(normalizeTin('  ')).toBe('');
  expect(normalizeTin('123456789')).toBe('123-456-789');
  expect(normalizeTin('123 456 789')).toBe('123-456-789');
  expect(normalizeTin('123-456-789')).toBe('123-456-789');
  expect(normalizeTin('12345678')).toBeNull();
  expect(normalizeTin('12A456789')).toBeNull();
});

test('a new user registered as a health worker sends the TIN, or nothing when it is blank', () => {
  const base = { ...emptyHealthWorker(), cadre_id: '1', first_name: 'Asha', last_name: 'Komba', assignment: { ...emptyHealthWorker().assignment, region_id: '11' } };
  expect(healthWorkerPayload({ ...base, tin_number: '100 200 301' }, '0755123501').staff.tin_number).toBe('100-200-301');
  expect(healthWorkerPayload(base, '0755123501').staff.tin_number).toBeNull();
  expect(healthWorkerPayload({ ...base, tin_number: '1234' }, '0755123501')).toBe(TIN_MESSAGE);
});
