import React from 'react';
import { CadreActivity, CadreField, Lang } from '../../types';
import { Field } from '../ui';
import { FieldLabel } from './shared';

type MeasureInput = Record<string, string | boolean | undefined>;

interface Props {
  fields: CadreField[];
  groups?: CadreActivity['groups'];
  requiredFields: string[];
  flaggedFields: Set<string>;
  measures: MeasureInput;
  lang: Lang;
  yesLabel: string;
  noLabel: string;
  onChange: (key: string, value: string | boolean | undefined) => void;
  selectedGroupKey?: string;
  onGroupChange?: (key: string) => void;
  nativeRequired?: boolean;
}

/** Renders activity indicators in API order, with named, accessible group panels when supplied. */
export function GroupedIndicators({
  fields,
  groups,
  requiredFields,
  flaggedFields,
  measures,
  lang,
  yesLabel,
  noLabel,
  onChange,
  selectedGroupKey,
  onGroupChange,
  nativeRequired = true,
}: Props) {
  const fieldByKey = new Map(fields.map((field) => [field.key, field]));
  const orderedGroups = (groups || []).map((group) => ({
    ...group,
    indicators: group.fields.map((key) => fieldByKey.get(key)).filter((field): field is CadreField => Boolean(field)),
  })).filter((group) => group.indicators.length > 0);
  const groupedKeys = new Set(orderedGroups.flatMap((group) => group.indicators.map((field) => field.key)));
  const ungrouped = fields.filter((field) => !groupedKeys.has(field.key));

  const renderField = (field: CadreField) => field.field_type === 'BOOLEAN' ? (
    <div key={field.key} className={`field${flaggedFields.has(field.key) ? ' flagged-field' : ''}`} role="group" aria-label={field.label_en}>
      <span className="field-label"><FieldLabel field={field} lang={lang} /></span>
      <div className="yesno">
        {[true, false].map((value) => (
          <button
            key={String(value)}
            type="button"
            aria-pressed={measures[field.key] === value}
            onClick={() => onChange(field.key, measures[field.key] === value ? undefined : value)}
          >
            {value ? yesLabel : noLabel}
          </button>
        ))}
      </div>
    </div>
  ) : (
    <Field key={field.key} label={<FieldLabel field={field} lang={lang} />} className={flaggedFields.has(field.key) ? 'flagged-field' : undefined}>
      <input
        type="number"
        inputMode="numeric"
        min="0"
        max="10000"
        step="1"
        required={nativeRequired && requiredFields.includes(field.key)}
        value={String(measures[field.key] ?? '')}
        onChange={(event) => onChange(field.key, event.target.value)}
      />
    </Field>
  );

  if (!orderedGroups.length) return <div className="measure-grid">{fields.map(renderField)}</div>;

  const activeGroup = orderedGroups.find((group) => group.key === selectedGroupKey) || orderedGroups[0];
  const groupSelectorEnabled = selectedGroupKey !== undefined && onGroupChange !== undefined;
  const displayedGroups = groupSelectorEnabled ? [activeGroup] : orderedGroups;

  return (
    <div className="indicator-groups">
      {groupSelectorEnabled && (
        <Field label={lang === 'sw' ? 'Kundi la viashiria vya kila siku' : 'Daily indicator group'}>
          <select value={activeGroup.key} onChange={(event) => onGroupChange(event.target.value)}>
            {orderedGroups.map((group) => (
              <option key={group.key} value={group.key}>
                {lang === 'sw' ? group.label_sw : group.label_en}
              </option>
            ))}
          </select>
        </Field>
      )}
      {displayedGroups.map((group) => (
        <fieldset key={group.key} className={`indicator-group indicator-group-${group.color.toLowerCase()}`}>
          <legend>{lang === 'sw' ? group.label_sw : group.label_en}</legend>
          <div className="measure-grid">{group.indicators.map(renderField)}</div>
        </fieldset>
      ))}
      {!groupSelectorEnabled && ungrouped.length > 0 && <div className="measure-grid indicator-ungrouped">{ungrouped.map(renderField)}</div>}
    </div>
  );
}
