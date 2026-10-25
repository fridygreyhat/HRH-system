import { preserveExistingOption } from './selectOptions';

const options = [
  { value: 'PUBLIC', label: 'Public' },
  { value: 'POLICE', label: 'Police' },
  { value: 'PRISON', label: 'Prison' },
  { value: 'PNP', label: 'PNP' },
];

test.each(['PUBLIC', 'POLICE', 'PRISON', 'PNP'])('keeps the known %s option without duplicating it', (value) => {
  expect(preserveExistingOption(options, value, true)).toBe(options);
});

test('preserves a custom stored type without mutating presets', () => {
  expect(preserveExistingOption(options, 'LEGACY_CUSTOM', true)).toEqual([
    ...options, { value: 'LEGACY_CUSTOM', label: 'LEGACY_CUSTOM (existing)' },
  ]);
  expect(options).toHaveLength(4);
});

test('does not add an empty value or change unrelated selects', () => {
  expect(preserveExistingOption(options, '', true)).toBe(options);
  expect(preserveExistingOption(options, 'OTHER', false)).toBe(options);
});
