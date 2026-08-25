import { createApp } from './app';
import { assertProductionSafety, env } from './config/env';
import { prisma } from './db';
import { logger } from './lib/logger';
import { startSlaScheduler, stopSlaScheduler } from './jobs/sla.job';

async function main(): Promise<void> {
  // Guvensiz konfigurasyonla production'a cikilmasini engeller.
  assertProductionSafety();

  const app = createApp();

  const server = app.listen(env.port, () => {
    logger.info(
      { port: env.port, env: env.nodeEnv, authProvider: env.authProvider },
      'HR Self Servis API baslatildi',
    );
  });

  startSlaScheduler(env.sla.jobIntervalMinutes);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Kapatiliyor...');
    stopSlaScheduler();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Islenmemis promise reddi');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Yakalanmamis istisna');
  });
}

main().catch((err) => {
  logger.error({ err }, 'Sunucu baslatilamadi');
  process.exit(1);
});
