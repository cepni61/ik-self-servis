/**
 * Basit, yapilandirilmis kosul degerlendirici.
 *
 * Bilincli olarak genel amacli bir rule engine DEGIL:
 *  - Alan yollari beyaz listeli prefixlerle sinirli (category./request./requester./form.)
 *  - Sadece 6 operator destekli
 *  - Tek seviye AND/OR gruplama (ic ice grup yok)
 *  - Arbitrary kod/script/eval YOK
 */

import {
  CONDITION_COMBINATOR,
  CONDITION_FIELD_PREFIXES,
  CONDITION_OPERATOR,
  CONDITION_OPERATORS,
  type ConditionCombinator,
  type ConditionOperator,
} from './constants';
import { ValidationError } from './errors';

export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  /** EQUALS/NOT_EQUALS icin skaler, IN/NOT_IN icin dizi, IS_EMPTY icin kullanilmaz. */
  value?: unknown;
}

export interface ConditionGroup {
  combinator: ConditionCombinator;
  rules: ConditionRule[];
}

export interface ConditionContext {
  category: {
    code: string;
    name: string;
    requiresManagerApproval: boolean;
  };
  request: {
    priority: string;
    departmentCode: string | null;
    subject: string;
  };
  requester: {
    id: string;
    departmentCode: string | null;
    department: string | null;
    title: string | null;
    hasManager: boolean;
  };
  form: Record<string, unknown>;
}

const OPERATORS_WITHOUT_VALUE: ConditionOperator[] = [
  CONDITION_OPERATOR.IS_EMPTY,
  CONDITION_OPERATOR.IS_NOT_EMPTY,
];

const OPERATORS_WITH_LIST_VALUE: ConditionOperator[] = [
  CONDITION_OPERATOR.IN,
  CONDITION_OPERATOR.NOT_IN,
];

// ---------------------------------------------------------------------------
// Parse / validate
// ---------------------------------------------------------------------------

/**
 * Kosul konfigurasyonunu dogrular ve normalize eder.
 * Hatali konfigurasyon publish sirasinda yakalanir.
 */
export function validateConditionGroup(input: unknown): ConditionGroup {
  if (input === null || input === undefined) {
    throw new ValidationError('Kosul bos olamaz.');
  }
  if (typeof input !== 'object') {
    throw new ValidationError('Kosul bir nesne olmalidir.');
  }

  const raw = input as Record<string, unknown>;
  const combinator = raw.combinator ?? CONDITION_COMBINATOR.AND;
  if (combinator !== CONDITION_COMBINATOR.AND && combinator !== CONDITION_COMBINATOR.OR) {
    throw new ValidationError('Kosul birlestiricisi AND veya OR olmalidir.');
  }

  if (!Array.isArray(raw.rules) || raw.rules.length === 0) {
    throw new ValidationError('Kosul en az bir kural icermelidir.');
  }
  if (raw.rules.length > 10) {
    throw new ValidationError('Bir kosulda en fazla 10 kural tanimlanabilir.');
  }

  const rules = raw.rules.map((r, index) => validateRule(r, index));
  return { combinator, rules };
}

function validateRule(input: unknown, index: number): ConditionRule {
  const position = index + 1;
  if (typeof input !== 'object' || input === null) {
    throw new ValidationError(`${position}. kural gecersiz.`);
  }
  const raw = input as Record<string, unknown>;

  const field = raw.field;
  if (typeof field !== 'string' || field.trim() === '') {
    throw new ValidationError(`${position}. kuralda alan secilmemis.`);
  }
  if (!CONDITION_FIELD_PREFIXES.some((prefix) => field.startsWith(prefix))) {
    throw new ValidationError(
      `${position}. kuraldaki "${field}" alani desteklenmiyor. Gecerli prefixler: ${CONDITION_FIELD_PREFIXES.join(', ')}`,
    );
  }
  // Yol derinligi sinirli: prefix + tek segment (form.x veya request.priority)
  const segments = field.split('.');
  if (segments.length !== 2 || segments[1].trim() === '') {
    throw new ValidationError(
      `${position}. kuraldaki "${field}" alan yolu gecersiz. Ornek: form.kartTipi`,
    );
  }

  const operator = raw.operator;
  if (typeof operator !== 'string' || !CONDITION_OPERATORS.includes(operator as ConditionOperator)) {
    throw new ValidationError(
      `${position}. kuralda gecersiz operator. Gecerli operatorler: ${CONDITION_OPERATORS.join(', ')}`,
    );
  }
  const op = operator as ConditionOperator;

  if (OPERATORS_WITHOUT_VALUE.includes(op)) {
    return { field, operator: op };
  }

  if (OPERATORS_WITH_LIST_VALUE.includes(op)) {
    if (!Array.isArray(raw.value) || raw.value.length === 0) {
      throw new ValidationError(
        `${position}. kuralda ${op} operatoru icin en az bir deger secilmelidir.`,
      );
    }
    return { field, operator: op, value: raw.value.map(normalizeScalar) };
  }

  if (raw.value === undefined || raw.value === null || raw.value === '') {
    throw new ValidationError(`${position}. kuralda deger girilmemis.`);
  }
  return { field, operator: op, value: normalizeScalar(raw.value) };
}

function normalizeScalar(value: unknown): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  throw new ValidationError('Kosul degeri metin, sayi veya mantiksal olmalidir.');
}

/** JSON string -> ConditionGroup. Bozuk veri sessizce yutulmaz. */
export function parseConditionGroup(json: string | null | undefined): ConditionGroup | null {
  if (!json || json.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ValidationError('Kosul konfigurasyonu okunamadi (gecersiz JSON).');
  }
  return validateConditionGroup(parsed);
}

/** Publish oncesi kontrol icin: hata firlatmadan gecerlilik bilgisi doner. */
export function checkConditionGroup(
  json: string | null | undefined,
): { valid: true } | { valid: false; message: string } {
  try {
    parseConditionGroup(json);
    return { valid: true };
  } catch (err) {
    return { valid: false, message: err instanceof Error ? err.message : 'Gecersiz kosul.' };
  }
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

/** Kosul yoksa (null) sonuc true kabul edilir - adim her zaman calisir. */
export function evaluateCondition(
  group: ConditionGroup | null,
  context: ConditionContext,
): boolean {
  if (!group) return true;
  if (group.rules.length === 0) return true;

  const results = group.rules.map((rule) => evaluateRule(rule, context));
  return group.combinator === CONDITION_COMBINATOR.OR
    ? results.some(Boolean)
    : results.every(Boolean);
}

function evaluateRule(rule: ConditionRule, context: ConditionContext): boolean {
  const actual = resolveFieldValue(rule.field, context);

  switch (rule.operator) {
    case CONDITION_OPERATOR.IS_EMPTY:
      return isEmpty(actual);
    case CONDITION_OPERATOR.IS_NOT_EMPTY:
      return !isEmpty(actual);
    case CONDITION_OPERATOR.EQUALS:
      return looseEquals(actual, rule.value);
    case CONDITION_OPERATOR.NOT_EQUALS:
      return !looseEquals(actual, rule.value);
    case CONDITION_OPERATOR.IN:
      return asArray(rule.value).some((v) => looseEquals(actual, v));
    case CONDITION_OPERATOR.NOT_IN:
      return !asArray(rule.value).some((v) => looseEquals(actual, v));
    default:
      return false;
  }
}

/** Beyaz listeli, iki segmentli yol cozumlemesi. Prototype erisimi mumkun degil. */
function resolveFieldValue(field: string, context: ConditionContext): unknown {
  const [scope, key] = field.split('.');

  switch (scope) {
    case 'category':
      return pickOwn(context.category as unknown as Record<string, unknown>, key);
    case 'request':
      return pickOwn(context.request as unknown as Record<string, unknown>, key);
    case 'requester':
      return pickOwn(context.requester as unknown as Record<string, unknown>, key);
    case 'form':
      return pickOwn(context.form, key);
    default:
      return undefined;
  }
}

function pickOwn(source: Record<string, unknown>, key: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return source[key];
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

/**
 * Tip toleransli karsilastirma. Form verisi ve konfigurasyon degerleri
 * string/number/boolean karisik gelebilir; "2" == 2 ve "true" == true kabul edilir.
 */
function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return toBool(a) === toBool(b);
  }
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'evet';
}

/** Kosulu insan okunur metne cevirir (UI ozeti ve timeline icin). */
export function describeCondition(group: ConditionGroup | null): string {
  if (!group || group.rules.length === 0) return '-';
  const joiner = group.combinator === CONDITION_COMBINATOR.OR ? ' VEYA ' : ' VE ';
  return group.rules.map(describeRule).join(joiner);
}

function describeRule(rule: ConditionRule): string {
  const label = rule.field;
  switch (rule.operator) {
    case CONDITION_OPERATOR.EQUALS:
      return `${label} = ${formatValue(rule.value)}`;
    case CONDITION_OPERATOR.NOT_EQUALS:
      return `${label} <> ${formatValue(rule.value)}`;
    case CONDITION_OPERATOR.IN:
      return `${label} icinde [${asArray(rule.value).map(formatValue).join(', ')}]`;
    case CONDITION_OPERATOR.NOT_IN:
      return `${label} disinda [${asArray(rule.value).map(formatValue).join(', ')}]`;
    case CONDITION_OPERATOR.IS_EMPTY:
      return `${label} bos`;
    case CONDITION_OPERATOR.IS_NOT_EMPTY:
      return `${label} dolu`;
    default:
      return label;
  }
}

function formatValue(value: unknown): string {
  if (value === true) return 'Evet';
  if (value === false) return 'Hayir';
  return String(value);
}
