#!/bin/sh
# Container acilis adimlari. Hepsi idempotenttir; yeniden baslatma guvenlidir.
set -e

echo "[entrypoint] Veritabani semasi uygulaniyor..."
npx prisma db push --skip-generate

# Referans veri: roller, durumlar, oncelikler, kategoriler ve standart is akisi.
# Seed upsert kullanir; mevcut talepleri/veriyi SILMEZ.
if [ "${SKIP_SEED}" = "true" ]; then
  echo "[entrypoint] SKIP_SEED=true, baslangic verisi atlandi."
else
  echo "[entrypoint] Baslangic verisi kontrol ediliyor..."
  node dist/prisma/seed.js
fi

echo "[entrypoint] Uygulama baslatiliyor..."
exec "$@"
