import { emptyHealthWorker, healthWorkerPayload } from './components/staff/HealthWorkerFields';
import { ID_REQUIRED_MESSAGE, NIDA_MESSAGE, VOTER_MESSAGE, identityPayload, normalizeIdNumber } from './nationalId';

test('a NIDA number is kept as 19900101-12345-12345-12 and a Voter ID in capitals', () => {
  expect(normalizeIdNumber('NIDA', '1990 0101 1234 5123 4512')).toEqual({ value: '19900101-12345-12345-12' });
  expect(normalizeIdNumber('NIDA', '12345')).toEqual({ error: NIDA_MESSAGE });
  expect(normalizeIdNumber('VOTER', ' t-1000-1234-567 ')).toEqual({ value: 'T-1000-1234-567' });
  expect(normalizeIdNumber('VOTER', 'T1')).toEqual({ error: VOTER_MESSAGE });
  expect(normalizeIdNumber('', '19900101123451234512')).toHaveProperty('error');
});

test('registration needs the ID type and number; an edit without an ID on file may leave both empty', () => {
  expect(identityPayload('', '')).toBe(ID_REQUIRED_MESSAGE);
  expect(identityPayload('NIDA', '')).toBe(ID_REQUIRED_MESSAGE);
  expect(identityPayload('', '', false)).toEqual({ id_type: null, id_number: null });
  expect(identityPayload('NIDA', '19900101123451234512')).toEqual({ id_type: 'NIDA', id_number: '19900101-12345-12345-12' });
});

test('a new health worker account is not sent without the ID', () => {
  const worker = {
    ...emptyHealthWorker(), cadre_id: '1', cadre_code: 'CHW', occupation: 'CHW (HIV + TB)', first_name: 'Christina', last_name: 'Mafie',
    pay: { tin_number: '100 200 302', bank_name: 'NMB', bank_account_number: '40100200302' },
    assignment: { ...emptyHealthWorker().assignment, region_id: '22' },
  };
  expect(healthWorkerPayload(worker, '0755123501')).toBe(ID_REQUIRED_MESSAGE);
  const sent = healthWorkerPayload({ ...worker, national_id: { id_type: 'VOTER', id_number: 't-1000-1234-567' } }, '0755123501');
  expect(sent.staff).toMatchObject({ id_type: 'VOTER', id_number: 'T-1000-1234-567' });
});
