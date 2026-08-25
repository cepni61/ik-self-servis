import { ValidationError } from '../domain/errors';

/**
 * Guvenli JSON yardimcilari.
 * Bozuk veri sessizce yutulmaz: parseJsonObject hata firlatir, tryParse ise
 * yalnizca gorunum amacli yerlerde kullanilir ve fallback doner.
 */

export function parseJsonObject<T = Record<string, unknown>>(
  json: string | null | undefined,
  fieldLabel = 'Veri',
): T | null {
  if (json === null || json === undefined || json.trim() === '') return null;
  try {
    const parsed = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object') {
      throw new ValidationError(`${fieldLabel} bir nesne olmalidir.`);
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`${fieldLabel} okunamadi (gecersiz JSON).`);
  }
}

export function parseJsonArray<T = unknown>(
  json: string | null | undefined,
  fieldLabel = 'Veri',
): T[] {
  if (json === null || json === undefined || json.trim() === '') return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) {
      throw new ValidationError(`${fieldLabel} bir liste olmalidir.`);
    }
    return parsed as T[];
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`${fieldLabel} okunamadi (gecersiz JSON).`);
  }
}

/** Yalnizca gorunum/log icin: hata firlatmaz. */
export function tryParseJson<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}
