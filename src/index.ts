import { loadEnv } from './config/env';

const env = loadEnv();

import { createApp } from './app';
import prisma from './config/database';
import logger from './config/logger';
import bcrypt from 'bcryptjs';

async function seedAdmin() {
  const email = env.ADMIN_EMAIL;
  const password = env.ADMIN_PASSWORD;
  const name = env.ADMIN_NAME || 'Admin';

  if (!email || !password) {
    logger.info('ADMIN_EMAIL or ADMIN_PASSWORD not set, skipping admin seed');
    return;
  }

  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    logger.info({ email }, 'Admin user already exists, skipping seed');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.admin.create({
    data: {
      email,
      name,
      passwordHash,
      role: 'superadmin',
      isActive: true,
    },
  });

  logger.info({ email }, 'Admin user created from environment variables');

  const defaultSettings = [
    { key: 'base_domain', value: env.APP_BASE_URL },
    { key: 'default_expiry_hours', value: env.DEFAULT_LINK_EXPIRY_HOURS },
    { key: 'anti_bot_enabled', value: 'true' },
    { key: 'require_interstitial', value: env.REQUIRE_INTERSTITIAL_FOR_SUSPECT_UA },
    { key: 'allow_public_creation', value: env.ALLOW_PUBLIC_LINK_CREATION },
    { key: 'registration_enabled', value: 'false' },
    { key: 'brand_name', value: 'LinkOnce' },
    { key: 'brand_tagline', value: 'Secure single-use redirect links' },
  ];

  for (const setting of defaultSettings) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }

  logger.info('Default app settings seeded');
}

async function main() {
  try {
    await prisma.$connect();
    logger.info('Database connected');
  } catch (err) {
    logger.fatal({ err }, 'Failed to connect to database');
    process.exit(1);
  }

  await seedAdmin();

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
