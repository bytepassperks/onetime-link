import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { createLink } from '../services/link.service';
import { getEnv } from '../config/env';
import { getSettings } from '../services/admin.service';
import logger from '../config/logger';
import { createLinkRateLimit } from '../middleware/rate-limit';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const settings = await getSettings();
  res.render('pages/public/landing', {
    title: 'One-Time Link Converter',
    brandName: settings.brand_name || 'One-Time Link',
    brandTagline: settings.brand_tagline || 'Secure single-use redirect links',
    allowPublicCreation: settings.allow_public_creation !== 'false',
  });
});

router.get('/create', async (_req: Request, res: Response) => {
  const settings = await getSettings();
  if (settings.allow_public_creation === 'false') {
    res.status(403).render('pages/status/error', {
      title: 'Not Available',
      message: 'Public link creation is currently disabled.',
    });
    return;
  }
  const env = getEnv();
  res.render('pages/public/create', {
    title: 'Create One-Time Link',
    defaultExpiryHours: env.DEFAULT_LINK_EXPIRY_HOURS,
    csrfToken: res.locals.csrfToken,
    error: null,
    formData: null,
  });
});

const createLinkSchema = z.object({
  destinationUrl: z.string().min(1, 'Destination URL is required'),
  slug: z.string().optional().transform(v => v === '' ? undefined : v),
  label: z.string().optional().transform(v => v === '' ? undefined : v),
  password: z.string().optional().transform(v => v === '' ? undefined : v),
  notes: z.string().optional().transform(v => v === '' ? undefined : v),
  maxViews: z.string().optional().transform(v => {
    if (!v || v === '') return 1;
    const n = parseInt(v, 10);
    return isNaN(n) || n < 1 ? 1 : n;
  }),
  expiresAt: z.string().optional().transform(v => {
    if (!v || v === '') return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }),
  _honeypot: z.string().optional(),
});

router.post('/create', createLinkRateLimit(), async (req: Request, res: Response) => {
  try {
    const settings = await getSettings();
    if (settings.allow_public_creation === 'false') {
      res.status(403).render('pages/status/error', {
        title: 'Not Available',
        message: 'Public link creation is currently disabled.',
      });
      return;
    }

    if (req.body._honeypot && req.body._honeypot !== '') {
      logger.warn({ ip: req.ip }, 'Honeypot field triggered');
      res.status(400).render('pages/status/error', {
        title: 'Error',
        message: 'Invalid request.',
      });
      return;
    }

    const parsed = createLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      const env = getEnv();
      res.status(400).render('pages/public/create', {
        title: 'Create One-Time Link',
        defaultExpiryHours: env.DEFAULT_LINK_EXPIRY_HOURS,
        csrfToken: res.locals.csrfToken,
        error: parsed.error.issues[0]?.message || 'Invalid input',
        formData: req.body,
      });
      return;
    }

    const data = parsed.data;

    const link = await createLink({
      destinationUrl: data.destinationUrl,
      slug: data.slug,
      label: data.label,
      password: data.password,
      notes: data.notes,
      maxViews: data.maxViews,
      expiresAt: data.expiresAt,
      isPublic: true,
    });

    const env = getEnv();
    const shortUrl = `${env.APP_BASE_URL}/r/${link.slug}`;

    res.render('pages/public/success', {
      title: 'Link Created',
      shortUrl,
      slug: link.slug,
      expiresAt: link.expiresAt,
      maxViews: link.maxViews,
      hasPassword: !!link.passwordHash,
    });
  } catch (err: unknown) {
    const env = getEnv();
    const errorMessage = err instanceof Error ? err.message : 'Failed to create link';
    logger.error({ err }, 'Link creation error');
    res.status(400).render('pages/public/create', {
      title: 'Create One-Time Link',
      defaultExpiryHours: env.DEFAULT_LINK_EXPIRY_HOURS,
      csrfToken: res.locals.csrfToken,
      error: errorMessage,
      formData: req.body,
    });
  }
});

router.get('/privacy', (_req: Request, res: Response) => {
  res.render('pages/public/privacy', { title: 'Privacy Policy' });
});

router.get('/terms', (_req: Request, res: Response) => {
  res.render('pages/public/terms', { title: 'Terms of Service' });
});

export default router;
