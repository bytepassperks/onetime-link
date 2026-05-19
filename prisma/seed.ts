import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Admin';

  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required for seeding.');
    process.exit(1);
  }

  const existing = await prisma.admin.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user "${email}" already exists. Skipping seed.`);
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

  console.log(`Admin user "${email}" created successfully.`);

  const defaultSettings = [
    { key: 'base_domain', value: process.env.APP_BASE_URL || 'http://localhost:3000' },
    { key: 'default_expiry_hours', value: process.env.DEFAULT_LINK_EXPIRY_HOURS || '24' },
    { key: 'anti_bot_enabled', value: 'true' },
    { key: 'require_interstitial', value: 'true' },
    { key: 'allow_public_creation', value: process.env.ALLOW_PUBLIC_LINK_CREATION || 'true' },
    { key: 'registration_enabled', value: 'false' },
    { key: 'brand_name', value: 'One-Time Link' },
    { key: 'brand_tagline', value: 'Secure single-use redirect links' },
  ];

  for (const setting of defaultSettings) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }

  console.log('Default app settings seeded.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
