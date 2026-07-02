import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createLink, createLinkBatch, consumeUniqueClient } from '../src/services/link.service';

const prisma = new PrismaClient();

beforeAll(async () => {
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-0123456789012345';
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.linkAccessEvent.deleteMany();
  await prisma.linkRedemption.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.link.deleteMany();
});

describe('batch redemption creation', () => {
  it('creates N single-use links sharing a batch id', async () => {
    const links = await createLinkBatch({
      destinationUrl: 'https://example.com/batch',
      label: 'batch test',
      quantity: 4,
      isPublic: true,
    });

    expect(links).toHaveLength(4);
    const batchIds = new Set(links.map((link) => link.batchId));
    expect(batchIds.size).toBe(1);
    for (const link of links) {
      expect(link.redemptionMode).toBe('total_views');
      expect(link.maxViews).toBe(1);
      expect(link.viewCount).toBe(0);
      expect(link.batchId).toBeTruthy();
    }

    const dbLinks = await prisma.link.findMany({ where: { batchId: links[0].batchId! } });
    expect(dbLinks).toHaveLength(4);
  });
});

describe('unique-client redemption behavior', () => {
  it('allows a new client to redeem successfully', async () => {
    const link = await createLink({
      destinationUrl: 'https://example.com/unique',
      redemptionMode: 'unique_clients',
      maxViews: 2,
      isPublic: true,
    });

    const result = await consumeUniqueClient(link.slug, 'client-1', 'fp-1', '127.0.0.1', 'Mozilla/5.0', 'https://ref.example');

    expect(result.success).toBe(true);
    expect(result.destinationUrl).toBe('https://example.com/unique');

    const updated = await prisma.link.findUnique({ where: { id: link.id } });
    expect(updated?.viewCount).toBe(1);
    expect(updated?.status).toBe('active');
  });

  it('blocks the same client on a second redemption', async () => {
    const link = await createLink({
      destinationUrl: 'https://example.com/unique2',
      redemptionMode: 'unique_clients',
      maxViews: 2,
      isPublic: true,
    });

    const first = await consumeUniqueClient(link.slug, 'client-2', 'fp-2', '127.0.0.1', 'Mozilla/5.0', undefined);
    expect(first.success).toBe(true);

    const second = await consumeUniqueClient(link.slug, 'client-2', 'fp-2', '127.0.0.1', 'Mozilla/5.0', undefined);
    expect(second.success).toBe(false);
    expect(second.status).toBe('already_redeemed');

    const updated = await prisma.link.findUnique({ where: { id: link.id } });
    expect(updated?.viewCount).toBe(1);
  });

  it('blocks by ip/ua fallback when the cookie id changes', async () => {
    const link = await createLink({
      destinationUrl: 'https://example.com/unique3',
      redemptionMode: 'unique_clients',
      maxViews: 2,
      isPublic: true,
    });

    const first = await consumeUniqueClient(link.slug, 'cookie-a', 'fp-shared', '127.0.0.1', 'Mozilla/5.0', undefined);
    expect(first.success).toBe(true);

    const second = await consumeUniqueClient(link.slug, 'cookie-b', 'fp-shared', '127.0.0.1', 'Mozilla/5.0', undefined);
    expect(second.success).toBe(false);
    expect(second.status).toBe('already_redeemed');

    const redemptions = await prisma.linkRedemption.findMany({ where: { linkId: link.id } });
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0].ipHash).toBe('fp-shared');
  });

  it('marks the link consumed at maxViews and rejects the next distinct client', async () => {
    const link = await createLink({
      destinationUrl: 'https://example.com/unique4',
      redemptionMode: 'unique_clients',
      maxViews: 2,
      isPublic: true,
    });

    const first = await consumeUniqueClient(link.slug, 'client-1', 'fp-1', '127.0.0.1', 'Mozilla/5.0', undefined);
    const second = await consumeUniqueClient(link.slug, 'client-2', 'fp-2', '127.0.0.1', 'Mozilla/5.0', undefined);
    const third = await consumeUniqueClient(link.slug, 'client-3', 'fp-3', '127.0.0.1', 'Mozilla/5.0', undefined);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(third.success).toBe(false);
    expect(third.status).toBe('consumed');

    const updated = await prisma.link.findUnique({ where: { id: link.id } });
    expect(updated?.viewCount).toBe(2);
    expect(updated?.status).toBe('consumed');
  });

  it('returns status for disabled, expired, and password-protected links', async () => {
    const disabled = await createLink({
      destinationUrl: 'https://example.com/disabled',
      redemptionMode: 'unique_clients',
      maxViews: 1,
      isPublic: true,
    });
    await prisma.link.update({ where: { id: disabled.id }, data: { status: 'disabled' } });

    const expired = await createLink({
      destinationUrl: 'https://example.com/expired',
      redemptionMode: 'unique_clients',
      maxViews: 1,
      expiresAt: new Date(Date.now() - 60_000),
      isPublic: true,
    });

    const passwordLink = await createLink({
      destinationUrl: 'https://example.com/password',
      redemptionMode: 'unique_clients',
      maxViews: 1,
      password: 'secret123',
      isPublic: true,
    });

    const disabledResult = await consumeUniqueClient(disabled.slug, 'client-disabled', 'fp-disabled', '127.0.0.1', 'Mozilla/5.0', undefined);
    const expiredResult = await consumeUniqueClient(expired.slug, 'client-expired', 'fp-expired', '127.0.0.1', 'Mozilla/5.0', undefined);
    const passwordRequired = await consumeUniqueClient(passwordLink.slug, 'client-pass', 'fp-pass', '127.0.0.1', 'Mozilla/5.0', undefined);

    expect(disabledResult.status).toBe('disabled');
    expect(expiredResult.status).toBe('expired');
    expect(passwordRequired.status).toBe('password_required');
    expect(passwordRequired.requiresPassword).toBe(true);
  });
});

describe('unique-client concurrency safety', () => {
  it('allows only maxViews successful redemptions under concurrency', async () => {
    const link = await createLink({
      destinationUrl: 'https://example.com/concurrency',
      redemptionMode: 'unique_clients',
      maxViews: 5,
      isPublic: true,
    });

    const attempts = [
      ['client-1', 'fp-1'],
      ['client-2', 'fp-2'],
      ['client-3', 'fp-3'],
      ['client-4', 'fp-4'],
      ['client-5', 'fp-5'],
      ['client-1', 'fp-1'],
      ['client-2', 'fp-2'],
      ['client-6', 'fp-6'],
      ['client-7', 'fp-7'],
      ['client-8', 'fp-8'],
    ] as const;

    const results = await Promise.all(attempts.map(([clientId, ipUaHash]) => consumeUniqueClient(link.slug, clientId, ipUaHash, '127.0.0.1', 'Mozilla/5.0', 'https://ref.example')));

    const successCount = results.filter((result) => result.success).length;
    expect(successCount).toBe(5);

    const updated = await prisma.link.findUnique({ where: { id: link.id } });
    expect(updated?.viewCount).toBe(5);
    expect(updated?.status).toBe('consumed');

    const redemptionCount = await prisma.linkRedemption.count({ where: { linkId: link.id } });
    expect(redemptionCount).toBe(5);
  });
});
