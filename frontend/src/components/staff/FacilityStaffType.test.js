import { emptyHealthWorker, healthWorkerPayload } from './HealthWorkerFields';
import { FACILITY_STAFF_TYPE_MESSAGE, facilityStaffTypeLabel } from './FacilityStaffType';

const pay = { tin_number: '100 200 302', bank_name: 'NMB', bank_account_number: '40100200302' };
const worker = (patch) => ({
  ...emptyHealthWorker(), first_name: 'Neema', last_name: 'Mushi', occupation: 'Clinical Officer', pay,
  national_id: { id_type: 'NIDA', id_number: '19900101123451234512' },
  assignment: { ...emptyHealthWorker().assignment, region_id: '11' }, ...patch,
});

test('an HCP is registered as Government or Project facility staff', () => {
  expect(healthWorkerPayload(worker({ cadre_id: '3', cadre_code: 'HCP' }), '0755123502')).toBe(FACILITY_STAFF_TYPE_MESSAGE);
  expect(healthWorkerPayload(worker({ cadre_id: '3', cadre_code: 'HCP', facility_staff_type: 'PROJECT' }), '0755123502').staff)
    .toMatchObject({ occupation: 'Clinical Officer', facility_staff_type: 'PROJECT' });
});

test('other cadres send no facility staff type, and every new provider has a position', () => {
  const clerk = worker({ cadre_id: '2', cadre_code: 'DATA_CLERK', occupation: 'Facility Data Clerk', facility_staff_type: 'PROJECT' });
  expect(healthWorkerPayload(clerk, '0755123503').staff.facility_staff_type).toBeNull();
  expect(healthWorkerPayload({ ...clerk, occupation: '' }, '0755123503')).toMatch(/position/);
});

test('labels', () => {
  expect(facilityStaffTypeLabel('GOVERNMENT')).toBe('Government facility staff');
  expect(facilityStaffTypeLabel('PROJECT')).toBe('Project facility staff');
  expect(facilityStaffTypeLabel(null)).toBeNull();
});

test('government facility staff are registered without TIN or bank details', () => {
  const gov = worker({ cadre_id: '3', cadre_code: 'HCP', facility_staff_type: 'GOVERNMENT', pay: { tin_number: '', bank_name: '', bank_account_number: '' } });
  expect(healthWorkerPayload(gov, '0755123504').staff).toMatchObject({
    facility_staff_type: 'GOVERNMENT', tin_number: null, bank_name: null, bank_account_number: null });
  const project = { ...gov, facility_staff_type: 'PROJECT' };
  expect(healthWorkerPayload(project, '0755123504')).toMatch(/TIN, bank name, bank account number/);
});
