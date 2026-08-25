/**
 * Ortam konfigurasyonu.
 * Secret/parola kod icine gomulmez; hepsi ortam degiskeninden okunur.
 */

// ONEMLI: ortam dosyasi diger her seyden once yuklenmeli.
import './load-env';

import fs from 'node:fs';
import path from 'node:path';

function required(key: string, fallbackForDev?: string): string {
  const value = process.env[key];
  if (value && value.trim() !== '') return value;
  if (fallbackForDev !== undefined && process.env.NODE_ENV !== 'production') {
    return fallbackForDev;
  }
  throw new Error(
    `Zorunlu ortam degiskeni eksik: ${key}. .env dosyasini .env.example dosyasindan olusturun.`,
  );
}

function optionalInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes'].includes(raw.trim().toLowerCase());
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

/**
 * Web build ciktisini olasi konumlarda arar.
 * Ilk gecerli aday secilir; hicbiri yoksa en olasi yol dondurulur (app.ts
 * dizin yoksa yalnizca API servis eder ve uyari yazar).
 */
function resolveWebDistDir(): string {
  const candidates = [
    // server/ dizininden calistirildiginda
    path.resolve(process.cwd(), '..', 'web', 'dist'),
    // repo kokunden calistirildiginda
    path.resolve(process.cwd(), 'web', 'dist'),
    // derlenmis dosyanin konumuna gore (dist/src/config -> repo koku)
    path.resolve(__dirname, '..', '..', '..', '..', 'web', 'dist'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return candidates[0];
}

export const env = {
  nodeEnv,
  isProduction,
  isTest: nodeEnv === 'test',

  port: optionalInt('PORT', 4000),
  /** Virgulle ayrilmis izinli origin listesi. */
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  databaseUrl: required('DATABASE_URL', 'file:./dev.db'),

  jwt: {
    // Production'da zorunlu; dev'de sabit fallback (yalnizca lokal).
    secret: required('JWT_SECRET', 'dev-only-insecure-secret-change-me'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
    issuer: process.env.JWT_ISSUER ?? 'hr-self-service',
  },

  /**
   * Kimlik saglayici. Ilk surumde 'local' (seed edilmis kullanicilar + parola).
   * Kurumsal ortamda 'oidc' eklenecek; arayuz src/auth/provider.ts icinde.
   */
  authProvider: (process.env.AUTH_PROVIDER ?? 'local') as 'local' | 'oidc',

  /**
   * Dev kolayligi: parola dogrulamadan kullanici secerek giris.
   * Production'da her zaman kapali.
   */
  allowDevLogin: !isProduction && optionalBool('ALLOW_DEV_LOGIN', true),

  storage: {
    /** Ek dosyalarin tutuldugu dizin. Web root altinda DEGIL. */
    dir: process.env.STORAGE_DIR ?? path.resolve(process.cwd(), 'storage'),
    maxFileSizeMb: optionalInt('ATTACHMENT_MAX_SIZE_MB', 20),
  },

  sla: {
    /** SLA degerlendirme job aralik (dakika). 0 = kapali. */
    jobIntervalMinutes: optionalInt('SLA_JOB_INTERVAL_MINUTES', 15),
  },

  logLevel: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),

  /**
   * Build edilmis web arayuzunun dizini. Production'da API ile ayni port
   * uzerinden servis edilir.
   *
   * WEB_DIST_DIR verilmezse olasi konumlar sirayla denenir; boylece uygulama
   * hem server/ hem repo kokunden baslatildiginda arayuzu bulur (bulut
   * platformlari start komutunu farkli dizinlerden calistirabiliyor).
   */
  webDistDir: process.env.WEB_DIST_DIR ?? resolveWebDistDir(),

  /**
   * DEMO MODU.
   *
   * true ise seed, ornek kullanicilari (Mehmet Ozturk, Ahmet Yilmaz, ...)
   * ortak bir parola ile olusturur. Ekip testi icin gereklidir ANCAK bu
   * kurulumda GERCEK PERSONEL VERISI TUTULMAMALIDIR.
   *
   * Gelistirmede varsayilan acik; production'da acikca belirtilmelidir.
   */
  demoMode: optionalBool('DEMO_MODE', !isProduction),
} as const;

/** Bilinen zayif/varsayilan degerler. Production'da bunlarla acilis engellenir. */
const INSECURE_JWT_SECRETS = new Set([
  'dev-only-insecure-secure-change-me',
  'dev-only-insecure-secret-change-me',
  'test-only-secret',
  'change-me',
  'secret',
]);

/**
 * Production icin guvenlik on kontrolu.
 *
 * Amac: uygulamanin yanlislikla "gelistirme kolayliklari acik" sekilde
 * yayinlanmasini ENGELLEMEK. Ozellikle ALLOW_DEV_LOGIN, parola sormadan
 * herhangi bir kullanici (Admin dahil) olarak giris yapilmasina izin verir.
 *
 * Hata durumunda uygulama baslamaz; sessizce guvensiz calismaz.
 */
export function assertProductionSafety(): void {
  if (!isProduction) return;

  const problems: string[] = [];

  if (INSECURE_JWT_SECRETS.has(env.jwt.secret.trim().toLowerCase())) {
    problems.push(
      'JWT_SECRET varsayilan/ornek deger. Rastgele en az 32 karakterlik bir deger uretin.',
    );
  } else if (env.jwt.secret.trim().length < 32) {
    problems.push('JWT_SECRET en az 32 karakter olmalidir.');
  }

  // env.allowDevLogin production'da zaten false; yine de niyet acikca uyarilir.
  if (optionalBool('ALLOW_DEV_LOGIN', false)) {
    problems.push(
      'ALLOW_DEV_LOGIN production ortaminda kullanilamaz (parolasiz giris acar). ' +
        'Bu degeri false yapin veya kaldirin.',
    );
  }

  // Demo modu production'da yasak degil (ekip testi icin gerekli) ama
  // ortak parola acikca belirlenmis olmali; varsayilan parola kabul edilmez.
  if (env.demoMode) {
    const seedPassword = process.env.SEED_PASSWORD ?? '';
    if (!seedPassword) {
      problems.push(
        'DEMO_MODE=true iken SEED_PASSWORD tanimlanmalidir (ornek kullanicilarin ortak parolasi).',
      );
    } else if (seedPassword.trim().length < 8) {
      problems.push('SEED_PASSWORD en az 8 karakter olmalidir.');
    } else if (seedPassword.trim() === 'Parola123!') {
      problems.push(
        'SEED_PASSWORD varsayilan ornek deger. Paylasilan kurulum icin farkli bir parola belirleyin.',
      );
    }
  }

  if (problems.length > 0) {
    const lines = [
      'Production guvenlik kontrolu basarisiz:',
      ...problems.map((p) => `  - ${p}`),
      'Detay icin .env.production.example dosyasina bakin.',
    ];
    throw new Error(lines.join('\n'));
  }
}
