import type { Option } from './CrudTable';

/** Keep a legacy value selectable while editing, without offering it on new rows. */
export function preserveExistingOption(options: Option[], value: string, preserve: boolean): Option[] {
  if (!preserve || !value || options.some((option) => option.value === value)) return options;
  return [...options, { value, label: `${value} (existing)` }];
}
