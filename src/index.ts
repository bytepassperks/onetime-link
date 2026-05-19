import { loadEnv } from './config/env';

const env = loadEnv();

import { createApp } from './app';
import prisma from './config/database';
import logger from './config/logger';

async function main() {
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to database');
    process.exit(1);
  }

  const app = createApp();
  const port = parseInt(env.PORT, 10);

  app.listen(port, '0.0.0.0', () => {
    logger.info({ port, env: env.NODE_ENV, baseUrl: env.APP_BASE_URL }, 'Server started');
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
