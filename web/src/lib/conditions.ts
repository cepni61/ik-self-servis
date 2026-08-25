/**
 * Kosul degerlendirici (istemci kopyasi).
 *
 * NOT: Yetki ve dogrulamada TEK YETKILI SUNUCUDUR. Buradaki degerlendirme
 * yalnizca alanlari gosterip gizlemek icindir; kullanici gizli bir alani
 * zorlasa bile sunucu ayni kosulu yeniden degerlendirip reddeder.
 */

export interface ConditionRule {
  field: string;
  operator: string;
  value?: unknown;
}

export interface ConditionGroup {
  combinator: 'AND' | 'OR';
  rules: ConditionRule[];
}

export interface EvalContext {
  category: { code: string; name: string; requiresManagerApproval: boolean };
  request: { priority: string; departmentCode: string | null; subject: string };
  requester: {
    id: string;
    department: string | null;
    departmentCode: string | null;
    title: string | null;
    hasManager: boolean;
  };
  form: Record<string, unknown>;
}

export function parseCondition(json: string | null | undefined): ConditionGroup | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as ConditionGroup;
    if (!parsed || !Array.isArray(parsed.rules)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function evaluateCondition(
  group: ConditionGroup | null,
  ctx: EvalContext,
): boolean {
  if (!group || group.rules.length === 0) return true;
  const results = group.rules.map((rule) => evaluateRule(rule, ctx));
  return group.combinator === 'OR' ? results.some(Boolean) : results.every(Boolean);
}

function evaluateRule(rule: ConditionRule, ctx: EvalContext): boolean {
  const actual = resolve(rule.field, ctx);
  switch (rule.operator) {
    case 'IS_EMPTY':
      return isEmpty(actual);
    case 'IS_NOT_EMPTY':
      return !isEmpty(actual);
    case 'EQUALS':
      return looseEquals(actual, rule.value);
    case 'NOT_EQUALS':
      return !looseEquals(actual, rule.value);
    case 'IN':
      return asArray(rule.value).some((v) => looseEquals(actual, v));
    case 'NOT_IN':
      return !asArray(rule.value).some((v) => looseEquals(actual, v));
    default:
      return true;
  }
}

function resolve(field: string, ctx: EvalContext): unknown {
  const [scope, key] = field.split('.');
  if (!scope || !key) return undefined;
  const source =
    scope === 'category'
      ? (ctx.category as unknown as Record<string, unknown>)
      : scope === 'request'
        ? (ctx.request as unknown as Record<string, unknown>)
        : scope === 'requester'
          ? (ctx.requester as unknown as Record<string, unknown>)
          : scope === 'form'
            ? ctx.form
            : null;
  if (!source) return undefined;
  return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
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

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'boolean' || typeof b === 'boolean') return toBool(a) === toBool(b);
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function toBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const s = String(value).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'evet';
}
