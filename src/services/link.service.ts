import prisma from '../config/database';
import { LinkStatus, Prisma, RedemptionMode, EventType } from '@prisma/client';
import { generateSlug, isValidSlug } from '../utils/slug';
import { validateDestinationUrl } from '../utils/url-validator';
import { hashIp } from '../utils/bot-detection';
import bcrypt from 'bcryptjs';
import logger from '../config/logger';
import { randomUUID } from 'crypto';

export interface CreateLinkInput {
  destinationUrl: string;
  slug?: string;
  label?: string;
  password?: string;
  notes?: string;
  maxViews?: number;
  expiresAt?: Date | null;
  createdById?: string;
  isPublic?: boolean;
  redemptionMode?: RedemptionMode;
  batchId?: string | null;
}

export interface CreateLinkBatchInput {
  destinationUrl: string;
  label?: string;
  password?: string;
  notes?: string;
  expiresAt?: Date | null;
  quantity: number;
  createdById?: string;
  isPublic?: boolean;
}

export interface LinkWithRelations {
  id: string;
  slug: string;
  destinationUrl: string;
  label: string | null;
  passwordHash: string | null;
  maxViews: number;
  viewCount: number;
  redemptionMode: RedemptionMode;
  batchId: string | null;
  expiresAt: Date | null;
  status: LinkStatus;
  createdById: string | null;
  consumedAt: Date | null;
  lastAccessedAt: Date | null;
  notes: string | null;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ConsumeResult {
  success: boolean;
  destinationUrl?: string;
  status?: string;
  requiresPassword?: boolean;
  error?: string;
}

interface UniqueClientConsumeInput {
  slug: string;
  clientId: string;
  ipUaHash: string;
  ip: string;
  userAgent: string | undefined;
  referer: string | undefined;
}

const RETRYABLE_TRANSACTION_ERROR_CODES = new Set(['P2034', '40001']);
const RETRYABLE_MAX_ATTEMPTS = 8;

export async function createLink(input: CreateLinkInput): Promise<LinkWithRelations> {
  const urlResult = validateDestinationUrl(input.destinationUrl);
  if (!urlResult.valid) {
    throw new Error(urlResult.error || 'Invalid destination URL');
  }

  let passwordHash: string | null = null;
  if (input.password) {
    passwordHash = await bcrypt.hash(input.password, 12);
  }

  return prisma.$transaction(async (tx) => {
    let slug = input.slug;
    if (slug) {
      if (!isValidSlug(slug)) {
        throw new Error('Invalid slug format. Use 3-64 alphanumeric characters, hyphens, or underscores.');
      }
      const existing = await tx.link.findUnique({ where: { slug } });
      if (existing) {
        throw new Error('This slug is already taken. Please choose a different one.');
      }
    } else {
      slug = generateSlug();
      while (await tx.link.findUnique({ where: { slug } })) {
        slug = generateSlug();
      }
    }

    const link = await tx.link.create({
      data: {
        slug,
        destinationUrl: urlResult.normalized,
        label: input.label || null,
        passwordHash,
        notes: input.notes || null,
        maxViews: input.maxViews || 1,
        expiresAt: input.expiresAt || null,
        createdById: input.createdById || null,
        isPublic: input.isPublic ?? true,
        redemptionMode: input.redemptionMode || 'total_views',
        batchId: input.batchId || null,
      },
    });

    await tx.linkAccessEvent.create({
      data: {
        linkId: link.id,
        eventType: 'created',
      },
    });

    logger.info({ slug: link.slug }, 'Link created');
    return link;
  });
}

export async function createLinkBatch(input: CreateLinkBatchInput): Promise<LinkWithRelations[]> {
  const urlResult = validateDestinationUrl(input.destinationUrl);
  if (!urlResult.valid) {
    throw new Error(urlResult.error || 'Invalid destination URL');
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 1000) {
    throw new Error('Quantity must be between 1 and 1000.');
  }

  const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : null;
  const batchId = randomUUID();

  return prisma.$transaction(async (tx) => {
    const links: LinkWithRelations[] = [];

    for (let index = 0; index < input.quantity; index += 1) {
      let slug = generateSlug();
      while (await tx.link.findUnique({ where: { slug } })) {
        slug = generateSlug();
      }

      const link = await tx.link.create({
        data: {
          slug,
          destinationUrl: urlResult.normalized,
          label: input.label || null,
          passwordHash,
          notes: input.notes || null,
          maxViews: 1,
          expiresAt: input.expiresAt || null,
          createdById: input.createdById || null,
          isPublic: input.isPublic ?? true,
          redemptionMode: 'total_views',
          batchId,
        },
      });

      await tx.linkAccessEvent.create({
        data: {
          linkId: link.id,
          eventType: 'created',
        },
      });

      links.push(link);
    }

    logger.info({ batchId, quantity: input.quantity }, 'Batch links created');
    return links;
  });
}

export async function consumeLink(
  slug: string,
  ip: string,
  userAgent: string | undefined,
  referer: string | undefined
): Promise<ConsumeResult> {
  const ipHashed = hashIp(ip);

  return await prisma.$transaction(async (tx) => {
    const link = await tx.link.findUnique({
      where: { slug },
    });

    if (!link) {
      await logAccessEvent(slug, ipHashed, userAgent, referer, 'invalid_hit');
      return { success: false, status: 'invalid' };
    }

    if (link.status === 'deleted') {
      await logAccessEventWithId(tx, link.id, ipHashed, userAgent, referer, 'deleted_hit');
      return { success: false, status: 'invalid' };
    }

    if (link.status === 'disabled') {
      await logAccessEventWithId(tx, link.id, ipHashed, userAgent, referer, 'disabled_hit');
      return { success: false, status: 'disabled' };
    }

    if (link.status === 'consumed') {
      await logAccessEventWithId(tx, link.id, ipHashed, userAgent, referer, 'consumed');
      return { success: false, status: 'consumed' };
    }

    if (link.expiresAt && new Date() > link.expiresAt) {
      await tx.link.update({
        where: { id: link.id },
        data: { status: 'expired' },
      });
      await logAccessEventWithId(tx, link.id, ipHashed, userAgent, referer, 'expired_hit');
      return { success: false, status: 'expired' };
    }

    if (link.status === 'expired') {
      await logAccessEventWithId(tx, link.id, ipHashed, userAgent, referer, 'expired_hit');
      return { success: false, status: 'expired' };
    }

    if (link.passwordHash) {
      return { success: false, status: 'password_required', requiresPassword: true };
    }

    const newViewCount = link.viewCount + 1;
    const newStatus = newViewCount >= link.maxViews ? 'consumed' : 'active';

    try {
      await tx.link.update({
        where: { id: link.id, viewCount: link.viewCount },
        data: {
          viewCount: newViewCount,
          status: newStatus as LinkStatus,
          consumedAt: newStatus === 'consumed' ? new Date() : link.consumedAt,
          lastAccessedAt: new Date(),
        },
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        const current = await tx.link.findUnique({ where: { slug } });
        const status = current?.status === 'consumed' ? 'consumed' : (current?.status || 'invalid');
        return { success: false, status };
      }
      throw err;
    }

    await logAccessEventWithId(tx, link.id, ipHashed, userAgent, referer, 'consumed');

    return { success: true, destinationUrl: link.destinationUrl };
  });
}

export async function consumeLinkWithPassword(
  slug: string,
  password: string,
  ip: string,
  userAgent: string | undefined,
  referer: string | undefined
): Promise<ConsumeResult> {
  const ipHashed = hashIp(ip);

  return await prisma.$transaction(async (tx) => {
    const link = await tx.link.findUnique({
      where: { slug },
    });

    if (!link || link.status === 'deleted') {
      return { success: false, status: 'invalid' };
    }

    if (link.status === 'disabled') {
      return { success: false, status: 'disabled' };
    }

    if (link.status === 'consumed') {
      return { success: false, status: 'consumed' };
    }

    if (link.expiresAt && new Date() > link.expiresAt) {
      await tx.link.update({
        where: { id: link.id },
        data: { status: 'expired' },
      });
      return { success: false, status: 'expired' };
    }

    if (!link.passwordHash) {
      return { success: false, status: 'invalid', error: 'Link does not require a password' };
    }

    const passwordValid = await bcrypt.compare(password, link.passwordHash);
    if (!passwordValid) {
      await logAccessEventWithId(tx, link.id, ipHashed, userAgent, referer, 'password_fail');
      return { success: false, status: 'password_required', error: 'Incorrect password' };
    }

    await logAccessEventWithId(tx, link.id, ipHashed, userAgent, referer, 'password_ok');

    const newViewCount = link.viewCount + 1;
    const newStatus = newViewCount >= link.maxViews ? 'consumed' : 'active';

    try {
      await tx.link.update({
        where: { id: link.id, viewCount: link.viewCount },
        data: {
          viewCount: newViewCount,
          status: newStatus as LinkStatus,
          consumedAt: newStatus === 'consumed' ? new Date() : link.consumedAt,
          lastAccessedAt: new Date(),
        },
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        const current = await tx.link.findUnique({ where: { slug } });
        const status = current?.status === 'consumed' ? 'consumed' : (current?.status || 'invalid');
        return { success: false, status };
      }
      throw err;
    }

    await logAccessEventWithId(tx, link.id, ipHashed, userAgent, referer, 'consumed');

    return { success: true, destinationUrl: link.destinationUrl };
  });
}

export async function consumeUniqueClient(
  slug: string,
  clientId: string,
  ipUaHash: string,
  ip: string,
  userAgent: string | undefined,
  referer: string | undefined
): Promise<ConsumeResult> {
  return consumeUniqueClientInternal({ slug, clientId, ipUaHash, ip, userAgent, referer });
}

export async function consumeUniqueClientWithPassword(
  slug: string,
  password: string,
  clientId: string,
  ipUaHash: string,
  ip: string,
  userAgent: string | undefined,
  referer: string | undefined
): Promise<ConsumeResult> {
  return consumeUniqueClientInternal({ slug, clientId, ipUaHash, ip, userAgent, referer, password });
}

async function consumeUniqueClientInternal(
  input: UniqueClientConsumeInput & { password?: string }
): Promise<ConsumeResult> {
  const ipHashed = hashIp(input.ip);

  for (let attempt = 0; attempt < RETRYABLE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const link = await tx.link.findUnique({
          where: { slug: input.slug },
        });

        if (!link) {
          await logAccessEvent(input.slug, ipHashed, input.userAgent, input.referer, 'invalid_hit');
          return { success: false, status: 'invalid' };
        }

        if (link.status === 'deleted') {
          await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'deleted_hit');
          return { success: false, status: 'invalid' };
        }

        if (link.status === 'disabled') {
          await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'disabled_hit');
          return { success: false, status: 'disabled' };
        }

        if (link.status === 'consumed') {
          await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'consumed');
          return { success: false, status: 'consumed' };
        }

        if (link.expiresAt && new Date() > link.expiresAt) {
          await tx.link.update({
            where: { id: link.id },
            data: { status: 'expired' },
          });
          await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'expired_hit');
          return { success: false, status: 'expired' };
        }

        if (link.status === 'expired') {
          await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'expired_hit');
          return { success: false, status: 'expired' };
        }

        const existing = await tx.linkRedemption.findFirst({
          where: {
            linkId: link.id,
            OR: [
              { clientId: input.clientId },
              { clientId: input.ipUaHash },
              { ipHash: input.ipUaHash },
            ],
          },
        });

        if (existing) {
          await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'already_redeemed');
          return { success: false, status: 'already_redeemed' };
        }

        if (link.passwordHash) {
          if (!input.password) {
            return { success: false, status: 'password_required', requiresPassword: true };
          }

          const passwordValid = await bcrypt.compare(input.password, link.passwordHash);
          if (!passwordValid) {
            await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'password_fail');
            return { success: false, status: 'password_required', error: 'Incorrect password' };
          }

          await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'password_ok');
        }

        if (link.viewCount >= link.maxViews) {
          await tx.link.update({
            where: { id: link.id },
            data: {
              status: 'consumed',
              consumedAt: link.consumedAt || new Date(),
              lastAccessedAt: new Date(),
            },
          });
          await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'consumed');
          return { success: false, status: 'consumed' };
        }

        try {
          await tx.linkRedemption.create({
            data: {
              linkId: link.id,
              clientId: input.clientId,
              ipHash: input.ipUaHash,
              userAgent: input.userAgent?.substring(0, 500) || null,
            },
          });
        } catch (err: unknown) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'already_redeemed');
            return { success: false, status: 'already_redeemed' };
          }
          throw err;
        }

        const newViewCount = link.viewCount + 1;
        const newStatus = newViewCount >= link.maxViews ? 'consumed' : 'active';

        try {
          await tx.link.update({
            where: { id: link.id, viewCount: link.viewCount },
            data: {
              viewCount: newViewCount,
              status: newStatus as LinkStatus,
              consumedAt: newStatus === 'consumed' ? new Date() : link.consumedAt,
              lastAccessedAt: new Date(),
            },
          });
        } catch (err: unknown) {
          if (err instanceof Prisma.PrismaClientKnownRequestError) {
            if (err.code === 'P2025') {
              throw err;
            }
            if (err.code === 'P2002') {
              await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'already_redeemed');
              return { success: false, status: 'already_redeemed' };
            }
          }
          throw err;
        }

        await logAccessEventWithId(tx, link.id, ipHashed, input.userAgent, input.referer, 'consumed');
        return { success: true, destinationUrl: link.destinationUrl };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') {
          return { success: false, status: 'already_redeemed' };
        }
        if (RETRYABLE_TRANSACTION_ERROR_CODES.has(err.code)) {
          if (attempt < RETRYABLE_MAX_ATTEMPTS - 1) {
            await retryDelay(attempt);
            continue;
          }
          throw err;
        }
      }

      const code = (err as { code?: string; cause?: { code?: string } })?.code || (err as { cause?: { code?: string } })?.cause?.code;
      if (code && RETRYABLE_TRANSACTION_ERROR_CODES.has(code)) {
        if (attempt < RETRYABLE_MAX_ATTEMPTS - 1) {
          await retryDelay(attempt);
          continue;
        }
      }

      throw err;
    }
  }

  throw new Error('Failed to consume unique client link after retries');
}

async function retryDelay(attempt: number) {
  const delay = 20 * (attempt + 1);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function logAccessEvent(
  slug: string,
  ipHash: string,
  userAgent: string | undefined,
  referer: string | undefined,
  eventType: EventType
) {
  try {
    const link = await prisma.link.findUnique({ where: { slug } });
    if (link) {
      await prisma.linkAccessEvent.create({
        data: {
          linkId: link.id,
          ipHash,
          userAgent: userAgent?.substring(0, 500) || null,
          referer: referer?.substring(0, 500) || null,
          eventType,
        },
      });
    }
  } catch (err) {
    logger.error({ err, slug }, 'Failed to log access event');
  }
}

async function logAccessEventWithId(
  tx: Prisma.TransactionClient,
  linkId: string,
  ipHash: string,
  userAgent: string | undefined,
  referer: string | undefined,
  eventType: EventType
) {
  await tx.linkAccessEvent.create({
    data: {
      linkId,
      ipHash,
      userAgent: userAgent?.substring(0, 500) || null,
      referer: referer?.substring(0, 500) || null,
      eventType,
    },
  });
}

export async function getLinkBySlug(slug: string) {
  return prisma.link.findUnique({ where: { slug } });
}

export async function getLinksForAdmin(params: {
  page: number;
  limit: number;
  search?: string;
  status?: string;
  sort?: string;
  order?: 'asc' | 'desc';
}) {
  const { page, limit, search, status, sort = 'createdAt', order = 'desc' } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.LinkWhereInput = {};

  if (status && status !== 'all') {
    where.status = status as LinkStatus;
  }

  if (search) {
    where.OR = [
      { slug: { contains: search, mode: 'insensitive' } },
      { destinationUrl: { contains: search, mode: 'insensitive' } },
      { label: { contains: search, mode: 'insensitive' } },
    ];
  }

  const orderBy: Record<string, string> = {};
  const allowedSorts = ['createdAt', 'slug', 'status', 'viewCount', 'expiresAt'];
  orderBy[allowedSorts.includes(sort) ? sort : 'createdAt'] = order;

  const [links, total] = await Promise.all([
    prisma.link.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: { createdBy: { select: { name: true, email: true } } },
    }),
    prisma.link.count({ where }),
  ]);

  return { links, total, pages: Math.ceil(total / limit) };
}

export async function getLinkDetails(id: string) {
  const link = await prisma.link.findUnique({
    where: { id },
    include: {
      createdBy: { select: { name: true, email: true } },
      accessEvents: {
        orderBy: { timestamp: 'desc' },
      },
      redemptions: {
        orderBy: { redeemedAt: 'desc' },
      },
    },
  });

  if (!link) {
    return null;
  }

  const batchLinks = link.batchId
    ? await prisma.link.findMany({
        where: { batchId: link.batchId },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  return {
    ...link,
    batchLinks,
  };
}

export async function toggleLinkStatus(id: string, enable: boolean) {
  return prisma.link.update({
    where: { id },
    data: { status: enable ? 'active' : 'disabled' },
  });
}

export async function softDeleteLink(id: string) {
  return prisma.link.update({
    where: { id },
    data: { status: 'deleted' },
  });
}

export async function extendLinkExpiry(id: string, newExpiresAt: Date) {
  return prisma.link.update({
    where: { id },
    data: { expiresAt: newExpiresAt },
  });
}

export async function regenerateLinkSlug(id: string) {
  let newSlug = generateSlug();
  while (await prisma.link.findUnique({ where: { slug: newSlug } })) {
    newSlug = generateSlug();
  }
  return prisma.link.update({
    where: { id },
    data: { slug: newSlug },
  });
}

export async function getDashboardStats() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [total, active, consumed, expired, disabled, clicksToday, clicksWeek] = await Promise.all([
    prisma.link.count({ where: { status: { not: 'deleted' } } }),
    prisma.link.count({ where: { status: 'active' } }),
    prisma.link.count({ where: { status: 'consumed' } }),
    prisma.link.count({ where: { status: 'expired' } }),
    prisma.link.count({ where: { status: 'disabled' } }),
    prisma.linkAccessEvent.count({
      where: { eventType: 'consumed', timestamp: { gte: today } },
    }),
    prisma.linkAccessEvent.count({
      where: { eventType: 'consumed', timestamp: { gte: sevenDaysAgo } },
    }),
  ]);

  return { total, active, consumed, expired, disabled, clicksToday, clicksWeek };
}
