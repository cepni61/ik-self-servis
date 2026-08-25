/**
 * AppSetting okuma katmani.
 *
 * Amac: SLA esikleri, fallback rolu, dosya limitleri gibi degerlerin kod icine
 * gomulmemesi. Degerler veritabaninda; burada yalnizca tip donusumu ve kisa
 * sureli cache var (her istekte DB'ye gitmemek icin).
 */

import { prisma } from '../db';
import { SETTING_KEYS, SLA_CALENDAR_MODE, type SlaCalendarMode } from '../domain/constants';
import { tryParseJson } from '../lib/json';
import { DEFAULT_SLA_CALENDAR, type SlaCalendarOptions } from '../domain/sla';

const CACHE_TTL_MS = 30_000;

let cache: { loadedAt: number; values: Map<string, string> } | null = null;

async function loadAll(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.values;
  }
  const rows = await prisma.appSetting.findMany();
  const values = new Map(rows.map((r) => [r.key, r.value]));
  cache = { loadedAt: Date.now(), values };
  return values;
}

/** Konfigurasyon degistiginde cagrilir. */
export function invalidateSettingsCache(): void {
  cache = null;
}

export async function getSetting(key: string): Promise<string | null> {
  const values = await loadAll();
  return values.get(key) ?? null;
}

export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getBooleanSetting(key: string, fallback: boolean): Promise<boolean> {
  const raw = await getSetting(key);
  if (raw === null) return fallback;
  return ['1', 'true', 'yes', 'evet'].includes(raw.trim().toLowerCase());
}

export async function getJsonSetting<T>(key: string, fallback: T): Promise<T> {
  const raw = await getSetting(key);
  if (raw === null) return fallback;
  return tryParseJson<T>(raw, fallback);
}

// ---------------------------------------------------------------------------
// SLA takvimi
// ---------------------------------------------------------------------------

/**
 * SLA takvim ayarlarini derler.
 * Oncelik: workflow versiyonundaki mod > global ayar > CALENDAR_DAYS.
 */
export async function getSlaCalendarOptions(
  versionMode?: string | null,
): Promise<SlaCalendarOptions> {
  const globalMode = (await getSetting(SETTING_KEYS.SLA_CALENDAR_MODE)) ?? null;
  const mode = normalizeMode(versionMode) ?? normalizeMode(globalMode) ?? SLA_CALENDAR_MODE.CALENDAR_DAYS;

  const options: SlaCalendarOptions = {
    mode,
    workDayStartHour: await getNumberSetting(
      SETTING_KEYS.SLA_WORK_DAY_START_HOUR,
      DEFAULT_SLA_CALENDAR.workDayStartHour,
    ),
    workDayEndHour: await getNumberSetting(
      SETTING_KEYS.SLA_WORK_DAY_END_HOUR,
      DEFAULT_SLA_CALENDAR.workDayEndHour,
    ),
    includeWeekends: await getBooleanSetting(SETTING_KEYS.SLA_INCLUDE_WEEKENDS, false),
  };

  // Tatil listesi yalnizca BUSINESS_DAYS modunda gerekli.
  if (mode === SLA_CALENDAR_MODE.BUSINESS_DAYS) {
    options.holidays = await loadHolidaySet();
  }
  return options;
}

function normalizeMode(value: string | null | undefined): SlaCalendarMode | null {
  if (value === SLA_CALENDAR_MODE.BUSINESS_DAYS) return SLA_CALENDAR_MODE.BUSINESS_DAYS;
  if (value === SLA_CALENDAR_MODE.CALENDAR_DAYS) return SLA_CALENDAR_MODE.CALENDAR_DAYS;
  return null;
}

let holidayCache: { loadedAt: number; set: Set<string> } | null = null;

async function loadHolidaySet(): Promise<Set<string>> {
  if (holidayCache && Date.now() - holidayCache.loadedAt < CACHE_TTL_MS) {
    return holidayCache.set;
  }
  const rows = await prisma.holiday.findMany({ select: { date: true } });
  const set = new Set(
    rows.map((r) => {
      const d = r.date;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;
    }),
  );
  holidayCache = { loadedAt: Date.now(), set };
  return set;
}

export function invalidateHolidayCache(): void {
  holidayCache = null;
}

export async function getSlaAtRiskThreshold(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.SLA_AT_RISK_THRESHOLD_PCT, 80);
}

/**
 * REQUESTER_MANAGER cozumlenemedigi durumda devreye giren yedek rol.
 * BUSINESS DECISION REQUIRED: kurumun tercih ettigi yedek sorumlu bu ayarla belirlenir.
 */
export async function getAssigneeFallbackRole(): Promise<string> {
  return (await getSetting(SETTING_KEYS.ASSIGNEE_FALLBACK_ROLE)) ?? 'HR_PROCESS_OWNER';
}

export async function getAttachmentLimits(): Promise<{
  maxSizeMb: number;
  allowedMimeTypes: string[];
}> {
  return {
    maxSizeMb: await getNumberSetting(SETTING_KEYS.ATTACHMENT_MAX_SIZE_MB, 20),
    allowedMimeTypes: await getJsonSetting<string[]>(
      SETTING_KEYS.ATTACHMENT_ALLOWED_MIME,
      [],
    ),
  };
}
