import { useMemo } from 'react';
import type { FormFieldConfig } from '../api/types';
import { evaluateCondition, parseCondition, type EvalContext } from '../lib/conditions';
import { UserSearchInput } from './UserSearchInput';

export type FormValues = Record<string, unknown>;

interface Props {
  fields: FormFieldConfig[];
  values: FormValues;
  onChange: (key: string, value: unknown) => void;
  context: EvalContext;
  /** Sunucudan gelen alan hatalari: { alanKodu: mesaj } */
  errors?: Record<string, string>;
  disabled?: boolean;
}

/**
 * Kategoriye gore tanimlanmis alanlari render eder.
 * Gorunurluk kosulu saglanmayan alanlar gosterilmez (ve degeri gonderilmez).
 */
export function DynamicForm({
  fields,
  values,
  onChange,
  context,
  errors = {},
  disabled = false,
}: Props) {
  const visibleFields = useMemo(() => {
    const ctx: EvalContext = { ...context, form: values };
    return fields
      .filter((f) => !f.isHidden)
      .filter((f) => evaluateCondition(parseCondition(f.visibilityConditionJson), ctx));
  }, [fields, values, context]);

  if (visibleFields.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {visibleFields.map((field) => (
        <div
          key={field.key}
          className={field.fieldType === 'LONG_TEXT' ? 'sm:col-span-2' : undefined}
        >
          <label className="label" htmlFor={`field-${field.key}`}>
            {field.label}
            {field.isRequired && <span className="ml-0.5 text-red-600">*</span>}
          </label>
          <FieldControl
            field={field}
            value={values[field.key]}
            onChange={(v) => onChange(field.key, v)}
            disabled={disabled || field.isReadOnly}
          />
          {field.helpText && <p className="hint">{field.helpText}</p>}
          {errors[field.key] && <p className="field-error">{errors[field.key]}</p>}
        </div>
      ))}
    </div>
  );
}

function FieldControl({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormFieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled: boolean;
}) {
  const id = `field-${field.key}`;
  const common = { id, disabled, className: 'input' as const };

  switch (field.fieldType) {
    case 'LONG_TEXT':
      return (
        <textarea
          {...common}
          rows={3}
          placeholder={field.placeholder ?? ''}
          maxLength={field.validation?.maxLength ?? 4000}
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'NUMBER':
      return (
        <input
          {...common}
          type="number"
          placeholder={field.placeholder ?? ''}
          min={field.validation?.min}
          max={field.validation?.max}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      );

    case 'DATE':
      return (
        <input
          {...common}
          type="date"
          value={asDateInput(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'CHECKBOX':
      return (
        <label className="flex items-center gap-2 py-1.5 text-[13px] text-ink-800">
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            className="size-4 rounded border-ink-300"
            checked={value === true || value === 'true'}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.placeholder ?? 'Evet'}</span>
        </label>
      );

    case 'DROPDOWN':
      return (
        <select {...common} value={asString(value)} onChange={(e) => onChange(e.target.value)}>
          <option value="">Seçiniz…</option>
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case 'MULTI_SELECT': {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <div className="space-y-1 rounded border border-ink-300 bg-white p-2">
          {field.options.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 text-[13px] text-ink-800"
            >
              <input
                type="checkbox"
                disabled={disabled}
                className="size-4 rounded border-ink-300"
                checked={selected.includes(opt.value)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...selected, opt.value]
                    : selected.filter((v) => v !== opt.value);
                  onChange(next);
                }}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      );
    }

    case 'USER':
      return (
        <UserSearchInput
          id={id}
          selectedId={asString(value) || null}
          onSelect={(user) => onChange(user?.id ?? '')}
          disabled={disabled}
        />
      );

    case 'FILE':
      return (
        <p className="rounded border border-dashed border-ink-300 px-2.5 py-2 text-[12px] text-ink-500">
          Dosyaları talep oluşturduktan sonra “Ekler” bölümünden yükleyebilirsiniz.
        </p>
      );

    case 'TEXT':
    default:
      return (
        <input
          {...common}
          type="text"
          placeholder={field.placeholder ?? ''}
          maxLength={field.validation?.maxLength ?? 500}
          value={asString(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function asDateInput(value: unknown): string {
  if (!value) return '';
  const text = String(value);
  // ISO tarih-saat -> YYYY-MM-DD
  if (text.length >= 10) return text.slice(0, 10);
  return text;
}
