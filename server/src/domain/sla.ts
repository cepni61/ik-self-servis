/**
 * SLA hesaplama.
 *
 * BUSINESS DECISION REQUIRED
 * --------------------------
 * "SLA kac gun?", "resmi tatiller dahil mi?", "mesai saati disi sayilir mi?"
 * sorularinin cevabi is birimi tarafindan verilmelidir. Bu yuzden:
 *   - Sure degerleri (slaHours) workflow adim konfigurasyonundan gelir.
 *   - Takvim modu (CALENDAR_DAYS / BUSINESS_DAYS) workflow versiyonunda tutulur.
 *   - Resmi tatil listesi Holiday tablosundan okunur (bos olabilir).
 * Varsayilan mod CALENDAR_DAYS'dir; yani ek bir is kurali uydurulmaz.
 */

import {
  SLA_CALENDAR_MODE,
  SLA_STATUS,
  type SlaCalendarMode,
  type SlaStatus,
} from './constants';

export interface SlaCalendarOptions {
  mode: SlaCalendarMode;
  /** 'YYYY-MM-DD' formatinda tatil gunleri. */
  holidays?: Set<string>;
  /** BUSINESS_DAYS modunda mesai baslangici (0-23). */
  workDayStartHour?: number;
  /** BUSINESS_DAYS modunda mesai bitisi (1-24). */
  workDayEndHour?: number;
  /** true ise hafta sonu da is gunu sayilir. */
  includeWeekends?: boolean;
}

export const DEFAULT_SLA_CALENDAR: Required<Omit<SlaCalendarOptions, 'holidays'>> & {
  holidays: Set<string>;
} = {
  mode: SLA_CALENDAR_MODE.CALENDAR_DAYS,
  holidays: new Set<string>(),
  workDayStartHour: 9,
  workDayEndHour: 18,
  includeWeekends: false,
};

const MS_PER_HOUR = 60 * 60 * 1000;
const MAX_ITERATIONS = 2000; // sonsuz donguye karsi guvenlik siniri

export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Adim baslangicindan itibaren SLA bitis anini hesaplar.
 * slaHours null/0 ise SLA tanimli degildir -> null doner.
 */
export function calculateDueDate(
  startedAt: Date,
  slaHours: number | null | undefined,
  options: SlaCalendarOptions,
): Date | null {
  if (!slaHours || slaHours <= 0) return null;

  const opts = { ...DEFAULT_SLA_CALENDAR, ...options };
  if (opts.mode === SLA_CALENDAR_MODE.CALENDAR_DAYS) {
    return new Date(startedAt.getTime() + slaHours * MS_PER_HOUR);
  }
  return addBusinessHours(startedAt, slaHours, opts);
}

function isWorkingDay(date: Date, opts: typeof DEFAULT_SLA_CALENDAR): boolean {
  if (!opts.includeWeekends) {
    const day = date.getDay(); // 0 Pazar, 6 Cumartesi
    if (day === 0 || day === 6) return false;
  }
  return !opts.holidays.has(toDateKey(date));
}

function startOfWorkDay(date: Date, opts: typeof DEFAULT_SLA_CALENDAR): Date {
  const d = new Date(date);
  d.setHours(opts.workDayStartHour, 0, 0, 0);
  return d;
}

function endOfWorkDay(date: Date, opts: typeof DEFAULT_SLA_CALENDAR): Date {
  const d = new Date(date);
  d.setHours(opts.workDayEndHour, 0, 0, 0);
  return d;
}

function nextWorkDayStart(from: Date, opts: typeof DEFAULT_SLA_CALENDAR): Date {
  const cursor = new Date(from);
  cursor.setDate(cursor.getDate() + 1);
  let guard = 0;
  while (!isWorkingDay(cursor, opts) && guard++ < MAX_ITERATIONS) {
    cursor.setDate(cursor.getDate() + 1);
  }
  return startOfWorkDay(cursor, opts);
}

function addBusinessHours(
  startedAt: Date,
  hours: number,
  opts: typeof DEFAULT_SLA_CALENDAR,
): Date {
  let cursor = new Date(startedAt);

  // Baslangic mesai penceresinin disindaysa ilk gecerli ana tasi.
  if (!isWorkingDay(cursor, opts)) {
    cursor = nextWorkDayStart(cursor, opts);
  } else if (cursor < startOfWorkDay(cursor, opts)) {
    cursor = startOfWorkDay(cursor, opts);
  } else if (cursor >= endOfWorkDay(cursor, opts)) {
    cursor = nextWorkDayStart(cursor, opts);
  }

  let remaining = hours;
  let guard = 0;
  while (remaining > 0 && guard++ < MAX_ITERATIONS) {
    const dayEnd = endOfWorkDay(cursor, opts);
    const availableHours = (dayEnd.getTime() - cursor.getTime()) / MS_PER_HOUR;

    if (remaining <= availableHours) {
      return new Date(cursor.getTime() + remaining * MS_PER_HOUR);
    }
    remaining -= availableHours;
    cursor = nextWorkDayStart(cursor, opts);
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// SLA durumu
// ---------------------------------------------------------------------------

export interface SlaEvaluationInput {
  startedAt: Date | null;
  dueAt: Date | null;
  /** Kayit kapandiysa kapanma ani. */
  closedAt?: Date | null;
  now?: Date;
  /** Kalan surenin hangi orana dustugunde AT_RISK sayilacagi (0-100). */
  atRiskThresholdPercent?: number;
}

/** Acik kayitlar icin ON_TRACK/AT_RISK/BREACHED, kapali kayitlar icin MET/MISSED. */
export function evaluateSlaStatus(input: SlaEvaluationInput): SlaStatus {
  const { startedAt, dueAt } = input;
  if (!dueAt) return SLA_STATUS.NA;

  if (input.closedAt) {
    return input.closedAt.getTime() <= dueAt.getTime()
      ? SLA_STATUS.MET
      : SLA_STATUS.MISSED;
  }

  const now = input.now ?? new Date();
  if (now.getTime() > dueAt.getTime()) return SLA_STATUS.BREACHED;

  const threshold = input.atRiskThresholdPercent ?? 80;
  if (startedAt) {
    const total = dueAt.getTime() - startedAt.getTime();
    if (total > 0) {
      const elapsedPercent = ((now.getTime() - startedAt.getTime()) / total) * 100;
      if (elapsedPercent >= threshold) return SLA_STATUS.AT_RISK;
    }
  }
  return SLA_STATUS.ON_TRACK;
}

/** Kalan sureyi insan okunur formatta verir (UI icin). */
export function describeRemaining(dueAt: Date | null, now = new Date()): string | null {
  if (!dueAt) return null;
  const diffMs = dueAt.getTime() - now.getTime();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const days = Math.floor(abs / (24 * MS_PER_HOUR));
  const hoursPart = Math.floor((abs % (24 * MS_PER_HOUR)) / MS_PER_HOUR);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} gun`);
  if (hoursPart > 0 || days === 0) parts.push(`${hoursPart} saat`);
  const text = parts.join(' ');
  return overdue ? `${text} gecikme` : `${text} kaldi`;
}

/** Reminder/escalation zamanini hesaplar (adim basindan itibaren saat). */
export function calculateReminderAt(
  startedAt: Date,
  offsetHours: number | null | undefined,
  options: SlaCalendarOptions,
): Date | null {
  return calculateDueDate(startedAt, offsetHours, options);
}
