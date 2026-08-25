# =========================================================================
# İK Self Servis - tek imaj (API + build edilmis web arayuzu)
#
# Web arayuzu API ile ayni port uzerinden servis edilir; ters proxy veya
# ikinci bir servise gerek yoktur.
#
# NOT: Bu imaj bu makinede test EDILEMEDI (Docker kurulu degil). Ilk build'de
# sorun cikarsa hata mesajini paylasmaniz yeterli.
# =========================================================================

# ---------- 1. Build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Prisma engine'leri OpenSSL'e ihtiyac duyar
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY . .

# Prisma client + Linux engine (schema'daki binaryTargets)
RUN npx prisma generate --schema server/prisma/schema.prisma

RUN npm run build --workspace server \
    && npm run build --workspace web

# ---------- 2. Calisma imaji ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=4000 \
    WEB_DIST_DIR=/app/web/dist \
    STORAGE_DIR=/data/storage \
    DATABASE_URL=file:/data/prod.db

# node_modules build asamasindan aynen kopyalanir.
# Boylece Prisma CLI (sema uygulamak icin) ve uretilmis client garanti mevcut olur.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma/schema.prisma ./server/prisma/schema.prisma
COPY --from=build /app/web/dist ./web/dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh \
    && mkdir -p /data/storage \
    && chown -R node:node /data /app

USER node
WORKDIR /app/server
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "dist/src/index.js"]
