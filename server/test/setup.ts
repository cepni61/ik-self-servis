/**
 * Test ortami hazirligi.
 *
 * Bu dosya diger importlardan ONCE import edilmelidir; env degiskenlerini
 * uygulama modulleri yuklenmeden ayarlar.
 *
 * Izolasyon kararlari:
 *  - Testler gelistirme veritabanina DOKUNMAZ; her test dosyasi kendi
 *    veritabaniyla calisir ve bu veritabani her kosuda sifirdan olusturulur.
 *  - Veritabani dosyalari proje dizini yerine ISLETIM SISTEMI GECICI DIZININDE
 *    tutulur. Proje OneDrive altinda oldugu icin senkronizasyon silinen dosyayi
 *    geri getiriyor ve testler bayat veriyle kosuyordu.
 *  - Yollar mutlak verilir; boylece Prisma'nin "goreli yolu schema.prisma
 *    dizinine gore cozme" davranisi devreye girmez.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** server/ dizini (test/ klasorunun bir ustu). */
const SERVER_ROOT = path.resolve(__dirname, '..');

// Her test dosyasi kendi veritabanini kullanir; dosyalar paralel kosabilir.
const testFileArg = process.argv.find((a) => a.endsWith('.test.ts')) ?? 'shared.test.ts';
const suiteName = path.basename(testFileArg, '.test.ts').replace(/[^a-z0-9_-]/gi, '');

const TEST_ROOT = path.join(os.tmpdir(), 'hr-self-service-tests');
fs.mkdirSync(TEST_ROOT, { recursive: true });

const TEST_DB_ABSOLUTE = path.join(TEST_ROOT, `${suiteName}.db`);
const STORAGE_DIR = path.join(TEST_ROOT, `storage-${suiteName}`);

// Prisma icin ileri slash'li mutlak yol (Windows'ta da gecerli).
const DATABASE_URL = `file:${TEST_DB_ABSOLUTE.replace(/\\/g, '/')}`;

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = DATABASE_URL;
process.env.JWT_SECRET = 'test-only-secret';
process.env.ALLOW_DEV_LOGIN = 'false';
process.env.SLA_JOB_INTERVAL_MINUTES = '0';
process.env.LOG_LEVEL = 'error';
process.env.STORAGE_DIR = STORAGE_DIR;
process.env.SEED_PASSWORD = 'Parola123!';

// Onceki kosudan kalan dosyalari temizle. Basarisiz olursa sessizce gecmiyoruz:
// bayat veri, testlerin yanlis sonuc vermesine yol acar.
for (const suffix of ['', '-journal', '-wal', '-shm']) {
  const file = `${TEST_DB_ABSOLUTE}${suffix}`;
  if (fs.existsSync(file)) fs.rmSync(file, { force: true });
}
if (fs.existsSync(TEST_DB_ABSOLUTE)) {
  throw new Error(
    `Test veritabani silinemedi: ${TEST_DB_ABSOLUTE}. Calisan bir test/sunucu sureci ` +
      'dosyayi kilitliyor olabilir.',
  );
}
fs.rmSync(STORAGE_DIR, { recursive: true, force: true });

const execOptions = {
  env: { ...process.env, DATABASE_URL },
  cwd: SERVER_ROOT,
  stdio: 'pipe' as const,
};

// Bos dosya uzerine sema yazilir; veri kaybi riski yok.
execSync('npx prisma db push --skip-generate', execOptions);
execSync('npx tsx prisma/seed.ts', execOptions);
