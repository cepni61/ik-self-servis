/**
 * Ortam dosyasi yukleme (tek nokta).
 *
 * Hem uygulama (env.ts) hem seed betigi bunu kullanir; boylece ikisi HER ZAMAN
 * ayni ortam dosyasini okur. Aksi halde seed gelistirme veritabanina, uygulama
 * production veritabanina baglanabilir.
 *
 * Oncelik:
 *   1. ENV_FILE (acikca verilen yol)
 *   2. NODE_ENV=production ise .env.production (varsa)
 *   3. .env
 *
 * Bu siralama, bir sunucuya yanlislikla kopyalanan gelistirme .env dosyasinin
 * (or. ALLOW_DEV_LOGIN=true) devreye girmesini onler.
 *
 * NOT: Bu modul, ortam degiskenine bagli baska bir modulden ONCE import
 * edilmelidir.
 */

import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

export function resolveEnvFile(cwd = process.cwd()): string {
  if (process.env.ENV_FILE) return path.resolve(process.env.ENV_FILE);

  if (process.env.NODE_ENV === 'production') {
    const productionFile = path.resolve(cwd, '.env.production');
    if (fs.existsSync(productionFile)) return productionFile;
  }
  return path.resolve(cwd, '.env');
}

/** dotenv mevcut process.env degerlerini EZMEZ; container ortami her zaman kazanir. */
export function loadEnv(): string {
  const file = resolveEnvFile();
  dotenv.config({ path: file });
  return file;
}

loadEnv();
