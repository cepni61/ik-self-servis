/**
 * Saglayicidan bagimsiz metin arama yardimcisi.
 *
 * NEDEN GEREKLI
 * -------------
 * Prisma'da `contains` davranisi saglayiciya gore DEGISIR:
 *   - SQLite  : LIKE kullanir, buyuk/kucuk harf DUYARSIZ ("mehmet" -> "Mehmet" bulur)
 *   - Postgres: buyuk/kucuk harf DUYARLI ("mehmet" -> "Mehmet" BULMAZ)
 *
 * `mode: 'insensitive'` yalnizca PostgreSQL/MongoDB'de gecerlidir; SQLite ile
 * gonderilirse sorgu hata verir. Bu yuzden filtre nesnesi saglayiciya gore
 * uretilir.
 *
 * Aksi halde bulut dagitiminda (Postgres) arama kutulari sessizce eksik sonuc
 * dondurur - kullanicinin fark etmesi zor, tespiti zor bir hata.
 */

/**
 * Aktif Prisma datasource saglayicisi.
 * Dagitimda DATABASE_PROVIDER ile ayarlanir (bkz. scripts/prepare-schema.mjs);
 * tanimsizsa yerel gelistirme varsayilani SQLite'tir.
 */
const provider = (process.env.DATABASE_PROVIDER ?? 'sqlite').trim().toLowerCase();

/** `mode: 'insensitive'` yalnizca bu saglayicilarda desteklenir. */
const SUPPORTS_INSENSITIVE_MODE = new Set(['postgresql', 'postgres', 'mongodb', 'cockroachdb']);

const useInsensitiveMode = SUPPORTS_INSENSITIVE_MODE.has(provider);

/**
 * Buyuk/kucuk harf duyarsiz "icerir" filtresi uretir.
 *
 * @example
 *   where: { subject: containsInsensitive(term) }
 */
export function containsInsensitive(value: string) {
  return useInsensitiveMode
    ? ({ contains: value, mode: 'insensitive' } as const)
    : ({ contains: value } as const);
}

/** Tani/log amacli. */
export const textSearchInfo = {
  provider,
  caseInsensitiveMode: useInsensitiveMode,
} as const;
