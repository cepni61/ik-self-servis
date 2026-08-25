import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { logger } from './lib/logger';
import { attachAuth } from './auth/middleware';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authRoutes } from './routes/auth.routes';
import { requestRoutes } from './routes/requests.routes';
import { catalogRoutes } from './routes/catalog.routes';
import { adminRoutes } from './routes/admin.routes';
import { prisma } from './db';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // API; HTML servis etmiyor. CSP frontend tarafinda uygulanir.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Ayni origin / sunucu ici istekler (origin yok) serbest.
        if (!origin) return callback(null, true);
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error('CORS politikası bu kaynağa izin vermiyor.'));
      },
      credentials: true,
      exposedHeaders: ['Content-Disposition'],
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  // Token varsa req.auth doldurulur; zorunluluk route seviyesinde.
  app.use(attachAuth);

  app.get('/api/health', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', message: 'Veritabanına erişilemiyor.' });
    }
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/requests', requestRoutes);
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/admin', adminRoutes);

  // API rotalari bulunamazsa JSON 404 doner (SPA fallback'ine dusmemeli).
  app.use('/api', notFoundHandler);

  mountWebClient(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/**
 * Build edilmis web arayuzunu ayni port uzerinden servis eder.
 *
 * Boylece dagitim tek servis olur: CORS, ikinci port ve ters proxy
 * konfigurasyonuna gerek kalmaz. Gelistirmede Vite kendi sunucusunu
 * kullandigi icin bu katman devreye girmez (dist yoksa atlanir).
 */
function mountWebClient(app: express.Express): void {
  const distDir = env.webDistDir;
  const indexFile = path.join(distDir, 'index.html');

  if (!fs.existsSync(indexFile)) {
    if (env.isProduction) {
      logger.warn(
        { distDir },
        'Web arayuzu build cikti dizini bulunamadi; yalnizca API servis edilecek. ' +
          '"npm run build --workspace web" komutunu calistirin.',
      );
    }
    return;
  }

  // Hash'li asset dosyalari uzun sureli cache'lenebilir; index.html asla.
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    }),
  );

  // SPA fallback: bilinmeyen GET yollari React router'a devredilir.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  });

  logger.info({ distDir }, 'Web arayuzu ayni port uzerinden servis ediliyor');
}
