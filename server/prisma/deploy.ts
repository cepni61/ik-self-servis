/**
 * Veritabani dagitim adimi: sema uygula + referans veriyi yaz.
 *
 * NEDEN BU BETIK VAR
 * ------------------
 * Prisma CLI yalnizca `.env` dosyasini okur; bizim `.env.production` kuralimizi
 * bilmez. Dolayisiyla production'da dogrudan `npx prisma db push` calistirmak
 * SESSIZCE gelistirme veritabanina baglanir ("already in sync" der, uygulama
 * ise bos bir veritabaniyla acilir).
 *
 * Bu betik once dogru ortam dosyasini yukler, sonra DATABASE_URL'i process
 * ortaminda hazir sekilde CLI'ya devreder. dotenv mevcut degiskenleri ezmedigi
 * icin CLI bizim degerimizi kullanir.
 *
 * Kullanim:
 *   npm run db:deploy --workspace server          (gelistirme)
 *   NODE_ENV=production node dist/prisma/deploy.js  (dagitim)
 */

import '../src/config/load-env';

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    'HATA: DATABASE_URL bulunamadi. Ortam dosyasini (.env veya .env.production) kontrol edin.',
  );
  process.exit(1);
}

// Hangi veritabanina yazdigimizi acikca goster; sessiz yanlis hedef en buyuk risk.
console.log(`[deploy] Ortam      : ${process.env.NODE_ENV ?? 'development'}`);
console.log(`[deploy] Veritabani : ${databaseUrl}`);

const serverRoot = path.resolve(__dirname, '..');

/** Komutlar sabittir (kullanici girdisi yok); shell kullanimi guvenli. */
function run(command: string): void {
  execSync(command, { stdio: 'inherit', env: process.env, cwd: serverRoot });
}

console.log('[deploy] Sema uygulaniyor...');
run('npx prisma db push --skip-generate');

console.log('[deploy] Referans veri yaziliyor...');
// Derlenmis surum varsa onu, yoksa TS kaynagini kullan.
const compiledSeed = path.join(__dirname, 'seed.js');
if (fs.existsSync(compiledSeed)) {
  run(`"${process.execPath}" "${compiledSeed}"`);
} else {
  run('npx tsx prisma/seed.ts');
}

console.log('[deploy] Tamamlandi.');
