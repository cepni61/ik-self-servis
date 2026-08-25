import { useMemo } from 'react';
import type { AdminMeta, CategoryListItem, PriorityInfo } from '../../api/types';

export interface ConditionRule {
  field: string;
  operator: string;
  value?: unknown;
}

export interface ConditionGroup {
  combinator: 'AND' | 'OR';
  rules: ConditionRule[];
}

const OPERATOR_LABELS: Record<string, string> = {
  EQUALS: 'eşittir',
  NOT_EQUALS: 'eşit değildir',
  IN: 'şunlardan biri',
  NOT_IN: 'şunlardan biri değil',
  IS_EMPTY: 'boş',
  IS_NOT_EMPTY: 'dolu',
};

const NO_VALUE_OPERATORS = ['IS_EMPTY', 'IS_NOT_EMPTY'];
const LIST_OPERATORS = ['IN', 'NOT_IN'];

/**
 * Basit, yapilandirilmis kosul kurucu.
 *
 * Bilincli sinirlar: tek seviye AND/OR, beyaz listeli alanlar, 6 operator.
 * Serbest metin ifade / kod girisi YOK.
 */
export function ConditionEditor({
  value,
  onChange,
  meta,
  categories,
  priorities,
  /** Kategoriye ozel form alanlari (form.<kod> secenekleri icin). */
  formFieldKeys = [],
}: {
  value: ConditionGroup | null;
  onChange: (value: ConditionGroup | null) => void;
  meta: AdminMeta;
  categories: CategoryListItem[];
  priorities: PriorityInfo[];
  formFieldKeys?: Array<{ key: string; label: string }>;
}) {
  const fieldOptions = useMemo(
    () => [
      ...meta.conditionFields.map((f) => ({
        path: f.path,
        label: f.label,
        valueSource: f.valueSource,
      })),
      ...formFieldKeys.map((f) => ({
        path: `form.${f.key}`,
        label: `Form: ${f.label}`,
        valueSource: 'TEXT',
      })),
    ],
    [meta.conditionFields, formFieldKeys],
  );

  const group = value ?? { combinator: 'AND' as const, rules: [] };

  const update = (next: ConditionGroup) => {
    onChange(next.rules.length === 0 ? null : next);
  };

  const addRule = () => {
    const first = fieldOptions[0];
    update({
      ...group,
      rules: [...group.rules, { field: first?.path ?? '', operator: 'EQUALS', value: '' }],
    });
  };

  const patchRule = (index: number, patch: Partial<ConditionRule>) => {
    update({
      ...group,
      rules: group.rules.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    });
  };

  const removeRule = (index: number) => {
    update({ ...group, rules: group.rules.filter((_, i) => i !== index) });
  };

  if (group.rules.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-[12px] text-ink-500">
          Koşul tanımlanmadı — bu adım her talepte çalışır.
        </p>
        <button type="button" className="btn-default btn-xs" onClick={addRule}>
          + Koşul Ekle
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {group.rules.length > 1 && (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-ink-600">Kurallar arasındaki ilişki:</span>
          <select
            className="input w-32 py-1"
            value={group.combinator}
            onChange={(e) =>
              update({ ...group, combinator: e.target.value as 'AND' | 'OR' })
            }
          >
            <option value="AND">Tümü (VE)</option>
            <option value="OR">Herhangi biri (VEYA)</option>
          </select>
        </div>
      )}

      <div className="space-y-2">
        {group.rules.map((rule, index) => {
          const fieldMeta = fieldOptions.find((f) => f.path === rule.field);
          const needsValue = !NO_VALUE_OPERATORS.includes(rule.operator);
          const isList = LIST_OPERATORS.includes(rule.operator);

          return (
            <div
              key={index}
              className="flex flex-wrap items-start gap-2 rounded border border-ink-200 bg-ink-50 p-2"
            >
              <select
                className="input w-56 py-1"
                value={rule.field}
                onChange={(e) => patchRule(index, { field: e.target.value, value: '' })}
                aria-label="Alan"
              >
                {fieldOptions.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.label}
                  </option>
                ))}
              </select>

              <select
                className="input w-40 py-1"
                value={rule.operator}
                onChange={(e) =>
                  patchRule(index, {
                    operator: e.target.value,
                    value: LIST_OPERATORS.includes(e.target.value) ? [] : '',
                  })
                }
                aria-label="Operatör"
              >
                {meta.conditionOperators.map((op) => (
                  <option key={op} value={op}>
                    {OPERATOR_LABELS[op] ?? op}
                  </option>
                ))}
              </select>

              {needsValue && (
                <div className="min-w-56 flex-1">
                  <ValueInput
                    valueSource={fieldMeta?.valueSource ?? 'TEXT'}
                    isList={isList}
                    value={rule.value}
                    onChange={(v) => patchRule(index, { value: v })}
                    categories={categories}
                    priorities={priorities}
                  />
                </div>
              )}

              <button
                type="button"
                className="btn-ghost btn-xs text-red-600"
                onClick={() => removeRule(index)}
                aria-label="Kuralı kaldır"
              >
                Kaldır
              </button>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn-default btn-xs"
          onClick={addRule}
          disabled={group.rules.length >= 10}
        >
          + Koşul Ekle
        </button>
        <button type="button" className="btn-ghost btn-xs" onClick={() => onChange(null)}>
          Koşulu Kaldır
        </button>
      </div>
    </div>
  );
}

function ValueInput({
  valueSource,
  isList,
  value,
  onChange,
  categories,
  priorities,
}: {
  valueSource: string;
  isList: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
  categories: CategoryListItem[];
  priorities: PriorityInfo[];
}) {
  const options =
    valueSource === 'CATEGORY'
      ? categories.map((c) => ({ value: c.code, label: c.name }))
      : valueSource === 'PRIORITY'
        ? priorities.map((p) => ({ value: p.code, label: p.name }))
        : valueSource === 'BOOLEAN'
          ? [
              { value: 'true', label: 'Evet' },
              { value: 'false', label: 'Hayır' },
            ]
          : null;

  if (valueSource === 'BOOLEAN') {
    return (
      <select
        className="input py-1"
        value={String(value ?? 'true')}
        onChange={(e) => onChange(e.target.value === 'true')}
        aria-label="Değer"
      >
        <option value="true">Evet</option>
        <option value="false">Hayır</option>
      </select>
    );
  }

  if (options && isList) {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <div className="max-h-32 space-y-0.5 overflow-y-auto rounded border border-ink-300 bg-white p-1.5">
        {options.map((opt) => (
          <label key={opt.value} className="flex items-center gap-2 text-[12px] text-ink-800">
            <input
              type="checkbox"
              className="size-3.5 rounded border-ink-300"
              checked={selected.includes(opt.value)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selected, opt.value]
                    : selected.filter((v) => v !== opt.value),
                )
              }
            />
            {opt.label}
          </label>
        ))}
      </div>
    );
  }

  if (options) {
    return (
      <select
        className="input py-1"
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Değer"
      >
        <option value="">Seçiniz…</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  // Serbest metin
  if (isList) {
    const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    return (
      <input
        className="input py-1"
        placeholder="Virgülle ayırın: DEGER1, DEGER2"
        value={text}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        aria-label="Değerler"
      />
    );
  }

  return (
    <input
      className="input py-1"
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Değer"
      aria-label="Değer"
    />
  );
}

export function parseConditionJson(json: string | null): ConditionGroup | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as ConditionGroup;
    if (!parsed || !Array.isArray(parsed.rules)) return null;
    return parsed;
  } catch {
    return null;
  }
}
