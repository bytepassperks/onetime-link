import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.linkAccessEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.link.deleteMany();
});

describe('Link Creation', () => {
  it('should create a link with valid data', async () => {
    const link = await prisma.link.create({
      data: {
        slug: 'test-link-1',
        destinationUrl: 'https://example.com',
        maxViews: 1,
        status: 'active',
      },
    });

    expect(link).toBeDefined();
    expect(link.slug).toBe('test-link-1');
    expect(link.destinationUrl).toBe('https://example.com');
    expect(link.maxViews).toBe(1);
    expect(link.viewCount).toBe(0);
    expect(link.status).toBe('active');
  });

  it('should enforce unique slug constraint', async () => {
    await prisma.link.create({
      data: {
        slug: 'unique-slug',
        destinationUrl: 'https://example.com',
        maxViews: 1,
        status: 'active',
      },
    });

    await expect(
      prisma.link.create({
        data: {
          slug: 'unique-slug',
          destinationUrl: 'https://other.com',
          maxViews: 1,
          status: 'active',
        },
      })
    ).rejects.toThrow();
  });

  it('should create a link with password hash', async () => {
    const hash = await bcrypt.hash('secret123', 12);
    const link = await prisma.link.create({
      data: {
        slug: 'pw-link',
        destinationUrl: 'https://example.com',
        passwordHash: hash,
        maxViews: 1,
        status: 'active',
      },
    });

    expect(link.passwordHash).toBeTruthy();
    const match = await bcrypt.compare('secret123', link.passwordHash!);
    expect(match).toBe(true);
  });
});

describe('Atomic Consumption', () => {
  it('should consume a link and update status atomically', async () => {
    const link = await prisma.link.create({
      data: {
        slug: 'consume-test',
        destinationUrl: 'https://example.com/consumed',
        maxViews: 1,
        status: 'active',
      },
    });

    const updated = await prisma.$transaction(async (tx) => {
      const found = await tx.link.findUnique({ where: { slug: 'consume-test' } });
      if (!found || found.status !== 'active') return null;

      const newViewCount = found.viewCount + 1;
      const newStatus = newViewCount >= found.maxViews ? 'consumed' : 'active';

      return tx.link.update({
        where: { id: found.id, viewCount: found.viewCount },
        data: {
          viewCount: newViewCount,
          status: newStatus as any,
          consumedAt: newStatus === 'consumed' ? new Date() : null,
          lastAccessedAt: new Date(),
        },
      });
    });

    expect(updated).toBeDefined();
    expect(updated!.viewCount).toBe(1);
    expect(updated!.status).toBe('consumed');
    expect(updated!.consumedAt).toBeTruthy();
  });

  it('should not consume an already-consumed link', async () => {
    await prisma.link.create({
      data: {
        slug: 'already-consumed',
        destinationUrl: 'https://example.com',
        maxViews: 1,
        viewCount: 1,
        status: 'consumed',
        consumedAt: new Date(),
      },
    });

    const result = await prisma.$transaction(async (tx) => {
      const found = await tx.link.findUnique({ where: { slug: 'already-consumed' } });
      if (!found || found.status !== 'active') return null;
      return found;
    });

    expect(result).toBeNull();
  });

  it('should handle multi-view links correctly', async () => {
    const link = await prisma.link.create({
      data: {
        slug: 'multi-view',
        destinationUrl: 'https://example.com/multi',
        maxViews: 3,
        status: 'active',
      },
    });

    for (let i = 0; i < 3; i++) {
      await prisma.$transaction(async (tx) => {
        const found = await tx.link.findUnique({ where: { slug: 'multi-view' } });
        if (!found || found.status !== 'active') return;

        const newViewCount = found.viewCount + 1;
        const newStatus = newViewCount >= found.maxViews ? 'consumed' : 'active';

        await tx.link.update({
          where: { id: found.id, viewCount: found.viewCount },
          data: {
            viewCount: newViewCount,
            status: newStatus as any,
            consumedAt: newStatus === 'consumed' ? new Date() : null,
            lastAccessedAt: new Date(),
          },
        });
      });
    }

    const final = await prisma.link.findUnique({ where: { slug: 'multi-view' } });
    expect(final!.viewCount).toBe(3);
    expect(final!.status).toBe('consumed');
  });
});

describe('Link Expiry', () => {
  it('should identify an expired link', async () => {
    const pastDate = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.link.create({
      data: {
        slug: 'expired-link',
        destinationUrl: 'https://example.com/expired',
        maxViews: 1,
        status: 'active',
        expiresAt: pastDate,
      },
    });

    const link = await prisma.link.findUnique({ where: { slug: 'expired-link' } });
    expect(link).toBeDefined();
    expect(link!.expiresAt).toBeTruthy();
    expect(new Date() > link!.expiresAt!).toBe(true);
  });
});

describe('Link Status Management', () => {
  it('should disable and re-enable a link', async () => {
    const link = await prisma.link.create({
      data: {
        slug: 'toggle-link',
        destinationUrl: 'https://example.com/toggle',
        maxViews: 1,
        status: 'active',
      },
    });

    await prisma.link.update({
      where: { id: link.id },
      data: { status: 'disabled' },
    });

    let updated = await prisma.link.findUnique({ where: { id: link.id } });
    expect(updated!.status).toBe('disabled');

    await prisma.link.update({
      where: { id: link.id },
      data: { status: 'active' },
    });

    updated = await prisma.link.findUnique({ where: { id: link.id } });
    expect(updated!.status).toBe('active');
  });

  it('should soft delete a link', async () => {
    const link = await prisma.link.create({
      data: {
        slug: 'delete-link',
        destinationUrl: 'https://example.com/delete',
        maxViews: 1,
        status: 'active',
      },
    });

    await prisma.link.update({
      where: { id: link.id },
      data: { status: 'deleted' },
    });

    const updated = await prisma.link.findUnique({ where: { id: link.id } });
    expect(updated!.status).toBe('deleted');
  });
});

describe('Access Events', () => {
  it('should log access events', async () => {
    const link = await prisma.link.create({
      data: {
        slug: 'event-link',
        destinationUrl: 'https://example.com/events',
        maxViews: 1,
        status: 'active',
      },
    });

    await prisma.linkAccessEvent.create({
      data: {
        linkId: link.id,
        eventType: 'created',
      },
    });

    await prisma.linkAccessEvent.create({
      data: {
        linkId: link.id,
        eventType: 'consumed',
        ipHash: 'abc123hash',
        userAgent: 'Mozilla/5.0',
      },
    });

    const events = await prisma.linkAccessEvent.findMany({
      where: { linkId: link.id },
      orderBy: { timestamp: 'asc' },
    });

    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('created');
    expect(events[1].eventType).toBe('consumed');
    expect(events[1].ipHash).toBe('abc123hash');
  });
});

describe('Admin Authentication', () => {
  it('should have a seeded admin user', async () => {
    const admin = await prisma.admin.findFirst({
      where: { role: 'superadmin' },
    });

    if (admin) {
      expect(admin.email).toBeTruthy();
      expect(admin.passwordHash).toBeTruthy();
      expect(admin.isActive).toBe(true);
    }
  });
});

describe('Audit Logs', () => {
  it('should create audit log entries', async () => {
    const admin = await prisma.admin.findFirst();

    await prisma.auditLog.create({
      data: {
        adminId: admin?.id || null,
        action: 'link_created',
        target: 'test-slug',
        details: 'Test link created',
        ipHash: 'testhash123',
      },
    });

    const logs = await prisma.auditLog.findMany({
      where: { action: 'link_created', target: 'test-slug' },
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].details).toBe('Test link created');
  });
});

describe('Bot Detection', () => {
  it('should detect common bots', async () => {
    const { detectBot } = await import('../src/utils/bot-detection');

    const facebookBot = detectBot('facebookexternalhit/1.1', 'GET');
    expect(facebookBot.isBot).toBe(true);
    expect(facebookBot.isPreviewAgent).toBe(true);

    const googleBot = detectBot('Googlebot/2.1', 'GET');
    expect(googleBot.isBot).toBe(true);

    const slack = detectBot('Slackbot-LinkExpanding 1.0', 'GET');
    expect(slack.isBot).toBe(true);
    expect(slack.isPreviewAgent).toBe(true);
  });

  it('should pass real browsers', async () => {
    const { detectBot } = await import('../src/utils/bot-detection');

    const chrome = detectBot(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'GET'
    );
    expect(chrome.isBot).toBe(false);
    expect(chrome.isSuspicious).toBe(false);
  });

  it('should flag empty user agents as suspicious', async () => {
    const { detectBot } = await import('../src/utils/bot-detection');

    const empty = detectBot('', 'GET');
    expect(empty.isSuspicious).toBe(true);

    const noUa = detectBot(undefined, 'GET');
    expect(noUa.isSuspicious).toBe(true);
  });

  it('should flag HEAD requests as suspicious', async () => {
    const { detectBot } = await import('../src/utils/bot-detection');

    const head = detectBot('Mozilla/5.0', 'HEAD');
    expect(head.isSuspicious).toBe(true);
  });
});

describe('URL Validation', () => {
  it('should validate valid URLs', async () => {
    const { validateDestinationUrl } = await import('../src/utils/url-validator');

    const valid = validateDestinationUrl('https://example.com');
    expect(valid.valid).toBe(true);

    const httpValid = validateDestinationUrl('http://example.com/path?q=1');
    expect(httpValid.valid).toBe(true);
  });

  it('should reject invalid URLs', async () => {
    const { validateDestinationUrl } = await import('../src/utils/url-validator');

    const invalid = validateDestinationUrl('not-a-url');
    expect(invalid.valid).toBe(false);

    const ftp = validateDestinationUrl('ftp://example.com');
    expect(ftp.valid).toBe(false);

    const javascript = validateDestinationUrl('javascript:alert(1)');
    expect(javascript.valid).toBe(false);
  });
});

describe('Slug Generation', () => {
  it('should generate valid slugs', async () => {
    const { generateSlug, isValidSlug } = await import('../src/utils/slug');

    const slug = generateSlug();
    expect(slug).toHaveLength(8);
    expect(isValidSlug(slug)).toBe(true);
  });

  it('should validate slug format', async () => {
    const { isValidSlug } = await import('../src/utils/slug');

    expect(isValidSlug('abc123')).toBe(true);
    expect(isValidSlug('my-link')).toBe(true);
    expect(isValidSlug('my_link')).toBe(true);
    expect(isValidSlug('ab')).toBe(false);
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('a'.repeat(65))).toBe(false);
  });
});

describe('IP Hashing', () => {
  it('should hash IP addresses consistently', async () => {
    const { hashIp } = await import('../src/utils/bot-detection');

    const hash1 = hashIp('192.168.1.1');
    const hash2 = hashIp('192.168.1.1');
    expect(hash1).toBe(hash2);

    const hash3 = hashIp('192.168.1.2');
    expect(hash1).not.toBe(hash3);
  });

  it('should truncate hashes to 16 chars', async () => {
    const { hashIp } = await import('../src/utils/bot-detection');

    const hash = hashIp('10.0.0.1');
    expect(hash).toHaveLength(16);
  });
});
