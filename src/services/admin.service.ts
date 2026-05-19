import prisma from '../config/database';
import bcrypt from 'bcryptjs';
import logger from '../config/logger';
import { hashIp } from '../utils/bot-detection';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export interface LoginResult {
  success: boolean;
  admin?: {
    id: string;
    email: string;
    name: string | null;
    role: string;
  };
  requireTotp?: boolean;
  error?: string;
}

export async function attemptLogin(email: string, password: string, ip: string): Promise<LoginResult> {
  const ipHash = hashIp(ip);

  const admin = await prisma.admin.findUnique({ where: { email } });

  if (!admin) {
    await logAuditEvent(null, 'admin_login_failed', email, `Failed login attempt for non-existent email`, ipHash);
    return { success: false, error: 'Invalid email or password' };
  }

  if (!admin.isActive) {
    await logAuditEvent(admin.id, 'admin_login_failed', email, 'Account is deactivated', ipHash);
    return { success: false, error: 'Account is deactivated' };
  }

  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    const remainingMs = admin.lockedUntil.getTime() - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    await logAuditEvent(admin.id, 'admin_login_failed', email, 'Account locked', ipHash);
    return { success: false, error: `Account is locked. Try again in ${remainingMin} minutes.` };
  }

  const passwordValid = await bcrypt.compare(password, admin.passwordHash);

  if (!passwordValid) {
    const newFailedCount = admin.failedLogins + 1;
    const updates: Record<string, unknown> = { failedLogins: newFailedCount };

    if (newFailedCount >= MAX_FAILED_LOGINS) {
      updates.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      logger.warn({ email }, `Admin account locked after ${MAX_FAILED_LOGINS} failed attempts`);
    }

    await prisma.admin.update({
      where: { id: admin.id },
      data: updates,
    });

    await logAuditEvent(admin.id, 'admin_login_failed', email, `Failed attempt ${newFailedCount}/${MAX_FAILED_LOGINS}`, ipHash);
    return { success: false, error: 'Invalid email or password' };
  }

  if (admin.totpEnabled && admin.totpSecret) {
    return {
      success: true,
      requireTotp: true,
      admin: {
        id: admin.id,
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    };
  }

  await prisma.admin.update({
    where: { id: admin.id },
    data: {
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });

  await logAuditEvent(admin.id, 'admin_login_success', email, 'Successful login', ipHash);

  return {
    success: true,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
  };
}

export async function completeTotpLogin(adminId: string, ip: string): Promise<LoginResult> {
  const ipHash = hashIp(ip);
  const admin = await prisma.admin.findUnique({ where: { id: adminId } });

  if (!admin) {
    return { success: false, error: 'Admin not found' };
  }

  await prisma.admin.update({
    where: { id: admin.id },
    data: {
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });

  await logAuditEvent(admin.id, 'admin_login_success', admin.email, 'Successful login (with 2FA)', ipHash);

  return {
    success: true,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
    },
  };
}

export async function logAuditEvent(
  adminId: string | null,
  action: string,
  target: string | null,
  details: string | null,
  ipHash: string | null
) {
  try {
    await prisma.auditLog.create({
      data: {
        adminId,
        action: action as any,
        target,
        details,
        ipHash,
      },
    });
  } catch (err) {
    logger.error({ err, action, target }, 'Failed to create audit log');
  }
}

export async function getAuditLogs(params: {
  page: number;
  limit: number;
  action?: string;
}) {
  const { page, limit, action } = params;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (action && action !== 'all') {
    where.action = action;
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      skip,
      take: limit,
      include: { admin: { select: { email: true, name: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total, pages: Math.ceil(total / limit) };
}

export async function getSettings() {
  const settings = await prisma.appSetting.findMany();
  const map: Record<string, string> = {};
  for (const s of settings) {
    map[s.key] = s.value;
  }
  return map;
}

export async function updateSettings(updates: Record<string, string>) {
  for (const [key, value] of Object.entries(updates)) {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
