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

test('a provider registered as a new user must give TIN, bank name and account number', () => {
  const base = { ...emptyHealthWorker(), cadre_id: '1', cadre_code: 'CHW', occupation: 'CHW (HIV + TB)', first_name: 'Asha', last_name: 'Komba', national_id: { id_type: 'VOTER', id_number: 'T-1000-1234-567' }, assignment: { ...emptyHealthWorker().assignment, region_id: '11' } };
  const pay = { tin_number: '100 200 301', bank_name: ' CRDB Bank ', bank_account_number: '0152 2789 4400' };
  expect(healthWorkerPayload({ ...base, pay }, '0755123501').staff).toMatchObject({
    tin_number: '100-200-301', bank_name: 'CRDB Bank', bank_account_number: '015227894400' });
  expect(healthWorkerPayload(base, '0755123501')).toMatch(/TIN, bank name, bank account number/);
  expect(healthWorkerPayload({ ...base, pay: { ...pay, tin_number: '1234' } }, '0755123501')).toBe(TIN_MESSAGE);
  expect(healthWorkerPayload({ ...base, pay: { ...pay, bank_account_number: '12' } }, '0755123501')).toMatch(/6 to 34/);
});
