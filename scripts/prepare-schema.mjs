#!/usr/bin/env node
/**
 * Prisma datasource provider'ini dagitim hedefine gore ayarlar.
 *
 * NEDEN BU BETIK VAR
 * ------------------
 * Prisma'da `datasource.provider` ortam degiskeninden okunamaz; sema dosyasinda
 * sabit yazmak zorunludur. Gelistirmede SQLite (kurulum gerektirmez), bulut
 * dagitiminda PostgreSQL kullanmak istiyoruz.
 *
 * Iki sema dosyasi tutmak yerine TEK kaynak korunur: bu betik yalnizca
 * DATABASE_PROVIDER tanimliysa provider satirini degistirir. Yani yerel
 * gelistirmede (degisken tanimsiz) sema dosyasina HIC dokunulmaz.
 *
 * Kullanim:
 *   DATABASE_PROVIDER=postgresql node scripts/prepare-schema.mjs
 *
 * Dagitim ortaminda calisma agaci gecicidir; yerinde degisiklik guvenlidir.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(__dirname, '..', 'server', 'prisma', 'schema.prisma');

const SUPPORTED = new Set(['sqlite', 'postgresql', 'mysql', 'sqlserver', 'cockroachdb']);

const target = process.env.DATABASE_PROVIDER?.trim().toLowerCase();

if (!target) {
  console.log('[prepare-schema] DATABASE_PROVIDER tanimsiz - sema degistirilmedi (yerel gelistirme).');
  process.exit(0);
}

if (!SUPPORTED.has(target)) {
  console.error(
    `[prepare-schema] Desteklenmeyen DATABASE_PROVIDER: "${target}". ` +
      `Gecerli degerler: ${[...SUPPORTED].join(', ')}`,
  );
  process.exit(1);
}

if (!fs.existsSync(SCHEMA)) {
  console.error(`[prepare-schema] Sema bulunamadi: ${SCHEMA}`);
  process.exit(1);
}

const original = fs.readFileSync(SCHEMA, 'utf8');

// datasource blogundaki provider satirini bul (generator'daki provider'a dokunma).
const datasourceBlock = /datasource\s+\w+\s*\{[^}]*\}/m;
const match = original.match(datasourceBlock);
if (!match) {
  console.error('[prepare-schema] datasource blogu bulunamadi.');
  process.exit(1);
}

const currentMatch = match[0].match(/provider\s*=\s*"([^"]+)"/);
const current = currentMatch?.[1];
if (!current) {
  console.error('[prepare-schema] datasource icinde provider satiri bulunamadi.');
  process.exit(1);
}

if (current === target) {
  console.log(`[prepare-schema] provider zaten "${target}" - degisiklik yok.`);
  process.exit(0);
}

const updatedBlock = match[0].replace(
  /provider\s*=\s*"[^"]+"/,
  `provider = "${target}"`,
);
const updated = original.replace(datasourceBlock, updatedBlock);

fs.writeFileSync(SCHEMA, updated, 'utf8');
console.log(`[prepare-schema] datasource provider: "${current}" -> "${target}"`);

if (target === 'sqlserver') {
  console.warn(
    '[prepare-schema] UYARI: SQL Server dongusel cascade yollarina izin vermez. ' +
      'Bazi iliskilerde acikca onDelete/onUpdate: NoAction gerekir (bkz. README).',
  );
}
