import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { createLoginRateLimit } from '../middleware/rate-limit';
import { attemptLogin, completeTotpLogin, logAuditEvent, getAuditLogs, getSettings, updateSettings } from '../services/admin.service';
import {
  getDashboardStats,
  getLinksForAdmin,
  getLinkDetails,
  toggleLinkStatus,
  softDeleteLink,
  extendLinkExpiry,
  regenerateLinkSlug,
  createLink,
} from '../services/link.service';
import {
  generateTotpSecret,
  verifyTotpToken,
  generateQrCodeDataUrl,
  enableTotp,
  disableTotp,
  getAdminTotpStatus,
} from '../services/totp.service';
import { hashIp } from '../utils/bot-detection';
import { getEnv } from '../config/env';
import { z } from 'zod';
import prisma from '../config/database';

const router = Router();

router.get('/login', (req: Request, res: Response) => {
  if (req.session.adminId) {
    res.redirect('/admin');
    return;
  }
  res.render('pages/admin/login', {
    title: 'Admin Login',
    error: null,
    csrfToken: res.locals.csrfToken,
  });
});

router.post('/login', createLoginRateLimit(), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).render('pages/admin/login', {
      title: 'Admin Login',
      error: 'Email and password are required',
      csrfToken: res.locals.csrfToken,
    });
    return;
  }

  const ip = req.ip || '0.0.0.0';
  const result = await attemptLogin(email, password, ip);

  if (!result.success) {
    res.status(401).render('pages/admin/login', {
      title: 'Admin Login',
      error: result.error,
      csrfToken: res.locals.csrfToken,
    });
    return;
  }

  if (result.requireTotp) {
    req.session.pendingTotpAdminId = result.admin!.id;
    req.session.save(() => {
      res.redirect('/admin/2fa/verify');
    });
    return;
  }

  req.session.adminId = result.admin!.id;
  req.session.adminEmail = result.admin!.email;
  req.session.adminName = result.admin!.name || undefined;
  req.session.adminRole = result.admin!.role;

  req.session.save(() => {
    res.redirect('/admin');
  });
});

// 2FA verification page (during login)
router.get('/2fa/verify', (req: Request, res: Response) => {
  if (!req.session.pendingTotpAdminId) {
    res.redirect('/admin/login');
    return;
  }
  res.render('pages/admin/totp-verify', {
    title: 'Two-Factor Authentication',
    error: null,
    csrfToken: res.locals.csrfToken,
  });
});

router.post('/2fa/verify', async (req: Request, res: Response) => {
  const adminId = req.session.pendingTotpAdminId;
  if (!adminId) {
    res.redirect('/admin/login');
    return;
  }

  const { token } = req.body;
  if (!token || token.length !== 6) {
    res.status(400).render('pages/admin/totp-verify', {
      title: 'Two-Factor Authentication',
      error: 'Please enter a valid 6-digit code',
      csrfToken: res.locals.csrfToken,
    });
    return;
  }

  const admin = await prisma.admin.findUnique({ where: { id: adminId } });
  if (!admin || !admin.totpSecret) {
    res.redirect('/admin/login');
    return;
  }

  const isValid = verifyTotpToken(admin.totpSecret, token);
  if (!isValid) {
    res.status(401).render('pages/admin/totp-verify', {
      title: 'Two-Factor Authentication',
      error: 'Invalid verification code. Please try again.',
      csrfToken: res.locals.csrfToken,
    });
    return;
  }

  const ip = req.ip || '0.0.0.0';
  const result = await completeTotpLogin(adminId, ip);

  if (!result.success || !result.admin) {
    res.redirect('/admin/login');
    return;
  }

  delete req.session.pendingTotpAdminId;
  req.session.adminId = result.admin.id;
  req.session.adminEmail = result.admin.email;
  req.session.adminName = result.admin.name || undefined;
  req.session.adminRole = result.admin.role;

  req.session.save(() => {
    res.redirect('/admin');
  });
});

// 2FA setup page (for authenticated admins)
router.get('/2fa/setup', requireAuth, async (req: Request, res: Response) => {
  const status = await getAdminTotpStatus(req.session.adminId!);

  if (status.enabled) {
    res.render('pages/admin/totp-manage', {
      title: 'Two-Factor Authentication',
      enabled: true,
      csrfToken: res.locals.csrfToken,
      success: null,
    });
    return;
  }

  const email = req.session.adminEmail || 'admin';
  const { secret, uri } = generateTotpSecret(email);
  const qrCodeDataUrl = await generateQrCodeDataUrl(uri);

  res.render('pages/admin/totp-setup', {
    title: 'Set Up Two-Factor Authentication',
    secret,
    qrCodeDataUrl,
    csrfToken: res.locals.csrfToken,
    error: null,
  });
});

router.post('/2fa/setup', requireAuth, async (req: Request, res: Response) => {
  const { secret, token } = req.body;

  if (!secret || !token) {
    res.redirect('/admin/2fa/setup');
    return;
  }

  const isValid = verifyTotpToken(secret, token);
  if (!isValid) {
    const email = req.session.adminEmail || 'admin';
    const { uri } = generateTotpSecret(email);
    const qrCodeDataUrl = await generateQrCodeDataUrl(uri);

    res.status(400).render('pages/admin/totp-setup', {
      title: 'Set Up Two-Factor Authentication',
      secret,
      qrCodeDataUrl,
      csrfToken: res.locals.csrfToken,
      error: 'Invalid code. Please scan the QR code again and enter the correct code.',
    });
    return;
  }

  await enableTotp(req.session.adminId!, secret);

  const ipHash = hashIp(req.ip || '0.0.0.0');
  await logAuditEvent(req.session.adminId || null, 'totp_setup', null, '2FA enabled', ipHash);

  res.render('pages/admin/totp-manage', {
    title: 'Two-Factor Authentication',
    enabled: true,
    csrfToken: res.locals.csrfToken,
    success: 'Two-factor authentication has been enabled successfully.',
  });
});

router.post('/2fa/disable', requireAuth, async (req: Request, res: Response) => {
  const { password } = req.body;

  const admin = await prisma.admin.findUnique({ where: { id: req.session.adminId } });
  if (!admin) {
    res.redirect('/admin/login');
    return;
  }

  const { default: bcryptLib } = await import('bcryptjs');
  const passwordValid = await bcryptLib.compare(password, admin.passwordHash);
  if (!passwordValid) {
    res.status(401).render('pages/admin/totp-manage', {
      title: 'Two-Factor Authentication',
      enabled: true,
      csrfToken: res.locals.csrfToken,
      success: null,
      error: 'Invalid password. 2FA was not disabled.',
    });
    return;
  }

  await disableTotp(req.session.adminId!);

  const ipHash = hashIp(req.ip || '0.0.0.0');
  await logAuditEvent(req.session.adminId || null, 'totp_disabled', null, '2FA disabled', ipHash);

  res.render('pages/admin/totp-manage', {
    title: 'Two-Factor Authentication',
    enabled: false,
    csrfToken: res.locals.csrfToken,
    success: 'Two-factor authentication has been disabled.',
  });
});

router.get('/logout', requireAuth, async (req: Request, res: Response) => {
  const adminId = req.session.adminId;
  const ip = req.ip || '0.0.0.0';
  const ipHash = hashIp(ip);

  await logAuditEvent(adminId || null, 'admin_logout', null, 'Admin logged out', ipHash);

  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

router.get('/', requireAuth, async (_req: Request, res: Response) => {
  const stats = await getDashboardStats();
  res.render('pages/admin/dashboard', {
    title: 'Admin Dashboard',
    stats,
  });
});

router.get('/links', requireAuth, async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = 20;
  const search = (req.query.search as string) || '';
  const status = (req.query.status as string) || 'all';
  const sort = (req.query.sort as string) || 'createdAt';
  const order = (req.query.order as string) === 'asc' ? 'asc' : 'desc';

  const result = await getLinksForAdmin({ page, limit, search, status, sort, order });
  const env = getEnv();

  res.render('pages/admin/links', {
    title: 'Manage Links',
    links: result.links,
    total: result.total,
    pages: result.pages,
    currentPage: page,
    search,
    status,
    sort,
    order,
    baseUrl: env.APP_BASE_URL,
  });
});

router.get('/links/create', requireAuth, (req: Request, res: Response) => {
  const env = getEnv();
  res.render('pages/admin/create-link', {
    title: 'Create Link (Admin)',
    defaultExpiryHours: env.DEFAULT_LINK_EXPIRY_HOURS,
    csrfToken: res.locals.csrfToken,
    error: null,
    formData: null,
  });
});

router.post('/links/create', requireAuth, async (req: Request, res: Response) => {
  try {
    const data = req.body;

    const link = await createLink({
      destinationUrl: data.destinationUrl,
      slug: data.slug || undefined,
      label: data.label || undefined,
      password: data.password || undefined,
      notes: data.notes || undefined,
      maxViews: parseInt(data.maxViews) || 1,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      createdById: req.session.adminId,
      isPublic: false,
    });

    const ipHash = hashIp(req.ip || '0.0.0.0');
    await logAuditEvent(req.session.adminId || null, 'link_created', link.slug, `Admin created link`, ipHash);

    res.redirect(`/admin/links/${link.id}`);
  } catch (err: unknown) {
    const env = getEnv();
    const errorMessage = err instanceof Error ? err.message : 'Failed to create link';
    res.status(400).render('pages/admin/create-link', {
      title: 'Create Link (Admin)',
      defaultExpiryHours: env.DEFAULT_LINK_EXPIRY_HOURS,
      csrfToken: res.locals.csrfToken,
      error: errorMessage,
      formData: req.body,
    });
  }
});

router.get('/links/:id', requireAuth, async (req: Request, res: Response) => {
  const link = await getLinkDetails(req.params.id as string);
  if (!link) {
    res.status(404).render('pages/status/error', {
      title: 'Not Found',
      message: 'Link not found.',
    });
    return;
  }

  const env = getEnv();
  res.render('pages/admin/link-detail', {
    title: `Link: ${link.slug}`,
    link,
    baseUrl: env.APP_BASE_URL,
    csrfToken: res.locals.csrfToken,
  });
});

router.post('/links/:id/toggle', requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { enable } = req.body;
  const shouldEnable = enable === 'true';

  await toggleLinkStatus(id, shouldEnable);

  const ipHash = hashIp(req.ip || '0.0.0.0');
  await logAuditEvent(
    req.session.adminId || null,
    shouldEnable ? 'link_enabled' : 'link_disabled',
    id,
    `Link ${shouldEnable ? 'enabled' : 'disabled'}`,
    ipHash
  );

  res.redirect(`/admin/links/${id}`);
});

router.post('/links/:id/delete', requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  await softDeleteLink(id);

  const ipHash = hashIp(req.ip || '0.0.0.0');
  await logAuditEvent(req.session.adminId || null, 'link_deleted', id, 'Link soft deleted', ipHash);

  res.redirect('/admin/links');
});

router.post('/links/:id/extend-expiry', requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { expiresAt } = req.body;

  if (!expiresAt) {
    res.redirect(`/admin/links/${id}`);
    return;
  }

  await extendLinkExpiry(id, new Date(expiresAt));

  const ipHash = hashIp(req.ip || '0.0.0.0');
  await logAuditEvent(req.session.adminId || null, 'link_expiry_extended', id, `Expiry extended to ${expiresAt}`, ipHash);

  res.redirect(`/admin/links/${id}`);
});

router.post('/links/:id/regenerate-slug', requireAuth, async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const updated = await regenerateLinkSlug(id);

  const ipHash = hashIp(req.ip || '0.0.0.0');
  await logAuditEvent(req.session.adminId || null, 'link_slug_regenerated', id, `New slug: ${updated.slug}`, ipHash);

  res.redirect(`/admin/links/${id}`);
});

router.get('/audit', requireAuth, async (req: Request, res: Response) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = 30;
  const action = (req.query.action as string) || 'all';

  const result = await getAuditLogs({ page, limit, action });

  res.render('pages/admin/audit', {
    title: 'Audit Logs',
    logs: result.logs,
    total: result.total,
    pages: result.pages,
    currentPage: page,
    action,
  });
});

router.get('/settings', requireAuth, async (_req: Request, res: Response) => {
  const settings = await getSettings();
  res.render('pages/admin/settings', {
    title: 'Settings',
    settings,
    csrfToken: res.locals.csrfToken,
    success: null,
  });
});

router.post('/settings', requireAuth, async (req: Request, res: Response) => {
  const settingsSchema = z.object({
    base_domain: z.string().optional(),
    default_expiry_hours: z.string().optional(),
    anti_bot_enabled: z.string().optional(),
    require_interstitial: z.string().optional(),
    allow_public_creation: z.string().optional(),
    registration_enabled: z.string().optional(),
    brand_name: z.string().optional(),
    brand_tagline: z.string().optional(),
  });

  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) {
    const settings = await getSettings();
    res.status(400).render('pages/admin/settings', {
      title: 'Settings',
      settings,
      csrfToken: res.locals.csrfToken,
      success: null,
    });
    return;
  }

  const updates: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) {
      updates[key] = value;
    }
  }

  const checkboxFields = ['anti_bot_enabled', 'require_interstitial', 'allow_public_creation', 'registration_enabled'];
  for (const field of checkboxFields) {
    if (!(field in updates)) {
      updates[field] = 'false';
    }
  }

  await updateSettings(updates);

  const ipHash = hashIp(req.ip || '0.0.0.0');
  await logAuditEvent(req.session.adminId || null, 'settings_updated', null, 'Settings updated', ipHash);

  const settings = await getSettings();
  res.render('pages/admin/settings', {
    title: 'Settings',
    settings,
    csrfToken: res.locals.csrfToken,
    success: 'Settings updated successfully',
  });
});

export default router;
