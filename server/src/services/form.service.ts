/**
 * Kategori bazli dinamik form alanlari.
 *
 * Kapsam sinirli tutuldu: bu bir "form engine" degil, HR taleplerinin ihtiyaci
 * olan alan tipleri ve basit dogrulamalar. Alan tanimlari veritabaninda
 * (CategoryFormField) tutulur; kod icinde kategoriye ozel alan YOK.
 */

import { prisma } from '../db';
import { FIELD_TYPE, type FieldType } from '../domain/constants';
import { ValidationError } from '../domain/errors';
import {
  evaluateCondition,
  parseConditionGroup,
  type ConditionContext,
} from '../domain/conditions';
import { parseJsonArray, parseJsonObject } from '../lib/json';

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldValidation {
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** Regex kaynagi. Kullanici girdisi degil, admin konfigurasyonu. */
  pattern?: string;
}

export interface FormFieldConfig {
  id: string;
  key: string;
  label: string;
  fieldType: FieldType;
  isRequired: boolean;
  isReadOnly: boolean;
  isHidden: boolean;
  defaultValue: string | null;
  helpText: string | null;
  placeholder: string | null;
  options: FieldOption[];
  validation: FieldValidation | null;
  visibilityConditionJson: string | null;
  sortOrder: number;
}

export async function getCategoryFormFields(categoryId: string): Promise<FormFieldConfig[]> {
  const rows = await prisma.categoryFormField.findMany({
    where: { categoryId, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    fieldType: row.fieldType as FieldType,
    isRequired: row.isRequired,
    isReadOnly: row.isReadOnly,
    isHidden: row.isHidden,
    defaultValue: row.defaultValue,
    helpText: row.helpText,
    placeholder: row.placeholder,
    options: parseJsonArray<FieldOption>(row.optionsJson, `${row.label} seçenekleri`),
    validation: parseJsonObject<FieldValidation>(row.validationJson, `${row.label} doğrulaması`),
    visibilityConditionJson: row.visibilityConditionJson,
    sortOrder: row.sortOrder,
  }));
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

interface FieldIssue {
  field: string;
  label: string;
  message: string;
}

/**
 * Form verisini alan tanimlarina gore dogrular ve temizler.
 * Tanimda olmayan anahtarlar atilir (kullanici keyfi alan gonderemez).
 */
export async function validateFormData(
  fields: FormFieldConfig[],
  raw: Record<string, unknown>,
  ctx: ConditionContext,
  options: { partial?: boolean } = {},
): Promise<Record<string, unknown>> {
  const issues: FieldIssue[] = [];
  const cleaned: Record<string, unknown> = {};

  // Gorunurluk kosullari mevcut form verisiyle degerlendirilir.
  const ctxWithForm: ConditionContext = { ...ctx, form: raw };

  for (const field of fields) {
    if (field.isHidden) continue;

    let visible = true;
    if (field.visibilityConditionJson) {
      try {
        visible = evaluateCondition(
          parseConditionGroup(field.visibilityConditionJson),
          ctxWithForm,
        );
      } catch {
        // Bozuk gorunurluk kosulu alani gizlemez; alan gosterilir ve loglanir.
        visible = true;
      }
    }
    if (!visible) continue;

    // Read-only alanlarda kullanici girdisi yok sayilir.
    const incoming = field.isReadOnly ? field.defaultValue : raw[field.key];
    const value = isBlank(incoming) ? (field.defaultValue ?? null) : incoming;

    if (isBlank(value)) {
      // Taslak kaydederken zorunluluk aranmaz; gonderimde aranir.
      if (field.isRequired && !options.partial) {
        issues.push({
          field: field.key,
          label: field.label,
          message: `${field.label} zorunludur.`,
        });
      }
      continue;
    }

    const coerced = coerceAndValidate(field, value, issues);
    if (coerced !== undefined) {
      cleaned[field.key] = coerced;
    }
  }

  // USER tipi alanlar icin gecerli kullanici kontrolu
  const userFieldKeys = fields
    .filter((f) => f.fieldType === FIELD_TYPE.USER && cleaned[f.key] !== undefined)
    .map((f) => f);

  if (userFieldKeys.length > 0) {
    const ids = userFieldKeys.map((f) => String(cleaned[f.key]));
    const found = await prisma.user.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true },
    });
    const foundSet = new Set(found.map((u) => u.id));
    for (const field of userFieldKeys) {
      if (!foundSet.has(String(cleaned[field.key]))) {
        issues.push({
          field: field.key,
          label: field.label,
          message: `${field.label} için geçerli bir kullanıcı seçilmedi.`,
        });
      }
    }
  }

  if (issues.length > 0) {
    throw new ValidationError('Form bilgilerinde eksik veya hatalı alanlar var.', {
      fields: issues,
    });
  }

  return cleaned;
}

function coerceAndValidate(
  field: FormFieldConfig,
  value: unknown,
  issues: FieldIssue[],
): unknown {
  const push = (message: string) =>
    issues.push({ field: field.key, label: field.label, message });
  const v = field.validation;

  switch (field.fieldType) {
    case FIELD_TYPE.NUMBER: {
      const num = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
      if (!Number.isFinite(num)) {
        push(`${field.label} sayısal bir değer olmalıdır.`);
        return undefined;
      }
      if (v?.min !== undefined && num < v.min) push(`${field.label} en az ${v.min} olmalıdır.`);
      if (v?.max !== undefined && num > v.max) push(`${field.label} en fazla ${v.max} olabilir.`);
      return num;
    }

    case FIELD_TYPE.CHECKBOX: {
      if (typeof value === 'boolean') return value;
      const s = String(value).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'evet';
    }

    case FIELD_TYPE.DATE: {
      const date = value instanceof Date ? value : new Date(String(value));
      if (Number.isNaN(date.getTime())) {
        push(`${field.label} geçerli bir tarih olmalıdır.`);
        return undefined;
      }
      return date.toISOString();
    }

    case FIELD_TYPE.DROPDOWN: {
      const s = String(value);
      if (field.options.length > 0 && !field.options.some((o) => o.value === s)) {
        push(`${field.label} için geçersiz bir seçim yapıldı.`);
        return undefined;
      }
      return s;
    }

    case FIELD_TYPE.MULTI_SELECT: {
      const arr = Array.isArray(value) ? value.map(String) : [String(value)];
      if (field.options.length > 0) {
        const valid = new Set(field.options.map((o) => o.value));
        const invalid = arr.filter((a) => !valid.has(a));
        if (invalid.length > 0) {
          push(`${field.label} için geçersiz seçim: ${invalid.join(', ')}`);
          return undefined;
        }
      }
      return arr;
    }

    case FIELD_TYPE.USER:
      return String(value);

    case FIELD_TYPE.FILE:
      // Dosyalar Attachment tablosunda tutulur; form verisinde yalnizca not kalir.
      return String(value);

    case FIELD_TYPE.TEXT:
    case FIELD_TYPE.LONG_TEXT:
    default: {
      const s = String(value).trim();
      const maxLength = v?.maxLength ?? (field.fieldType === FIELD_TYPE.LONG_TEXT ? 4000 : 500);
      if (v?.minLength !== undefined && s.length < v.minLength) {
        push(`${field.label} en az ${v.minLength} karakter olmalıdır.`);
      }
      if (s.length > maxLength) {
        push(`${field.label} en fazla ${maxLength} karakter olabilir.`);
      }
      if (v?.pattern) {
        try {
          if (!new RegExp(v.pattern).test(s)) {
            push(`${field.label} beklenen biçimde değil.`);
          }
        } catch {
          // Gecersiz regex konfigurasyonu dogrulamayi engellemez.
        }
      }
      return s;
    }
  }
}
