import { Router, Request, Response } from 'express';
import { consumeLink, consumeLinkWithPassword, getLinkBySlug } from '../services/link.service';
import { detectBot, hashIp } from '../utils/bot-detection';
import { getEnv } from '../config/env';
import { createConsumeRateLimit } from '../middleware/rate-limit';
import logger from '../config/logger';
import prisma from '../config/database';

const router = Router();

router.get('/r/:slug', createConsumeRateLimit(), async (req: Request, res: Response) => {
  const slug = req.params.slug as string;
  const userAgent = req.headers['user-agent'];
  const ip = req.ip || '0.0.0.0';
  const referer = (req.headers.referer || req.headers.referrer) as string | undefined;

  const botResult = detectBot(userAgent, req.method);

  if (botResult.isBot || botResult.isPreviewAgent) {
    logger.info({ slug, reason: botResult.reason }, 'Bot/preview request blocked');
    const ipHash = hashIp(ip);
    try {
      const link = await getLinkBySlug(slug);
      if (link) {
        await prisma.linkAccessEvent.create({
          data: {
            linkId: link.id,
            ipHash,
            userAgent: userAgent?.substring(0, 500) || null,
            referer: referer?.substring(0, 500) || null,
            eventType: 'preview_blocked',
          },
        });
      }
    } catch (e) {
      logger.error({ e }, 'Failed to log preview block event');
    }

    res.status(200).render('pages/status/preview-blocked', {
      title: 'One-Time Link',
      slug,
    });
    return;
  }

  const env = getEnv();
  if (env.REQUIRE_INTERSTITIAL_FOR_SUSPECT_UA === 'true' && botResult.isSuspicious) {
    res.render('pages/public/interstitial', {
      title: 'Continue to Link',
      slug,
      csrfToken: res.locals.csrfToken,
    });
    return;
  }

  try {
    const result = await consumeLink(slug, ip, userAgent, referer);

    if (!result.success) {
      if (result.requiresPassword) {
        res.render('pages/public/password', {
          title: 'Password Required',
          slug,
          error: null,
          csrfToken: res.locals.csrfToken,
        });
        return;
      }

      const statusPage = result.status || 'invalid';
      res.status(statusPage === 'invalid' ? 404 : 410).render(`pages/status/${statusPage}`, {
        title: getStatusTitle(statusPage),
      });
      return;
    }

    res.redirect(302, result.destinationUrl!);
  } catch (err) {
    logger.error({ err, slug }, 'Consume error');
    res.status(500).render('pages/status/error', {
      title: 'Error',
      message: 'An unexpected error occurred. Please try again.',
    });
  }
});

router.post('/r/:slug', createConsumeRateLimit(), async (req: Request, res: Response) => {
  const slug = req.params.slug as string;
  const userAgent = req.headers['user-agent'];
  const ip = req.ip || '0.0.0.0';
  const referer = (req.headers.referer || req.headers.referrer) as string | undefined;

  if (req.body._interstitial === 'true') {
    try {
      const result = await consumeLink(slug, ip, userAgent, referer);

      if (!result.success) {
        if (result.requiresPassword) {
          res.render('pages/public/password', {
            title: 'Password Required',
            slug,
            error: null,
            csrfToken: res.locals.csrfToken,
          });
          return;
        }

        const statusPage = result.status || 'invalid';
        res.status(statusPage === 'invalid' ? 404 : 410).render(`pages/status/${statusPage}`, {
          title: getStatusTitle(statusPage),
        });
        return;
      }

      res.redirect(302, result.destinationUrl!);
      return;
    } catch (err) {
      logger.error({ err, slug }, 'Interstitial consume error');
      res.status(500).render('pages/status/error', {
        title: 'Error',
        message: 'An unexpected error occurred.',
      });
      return;
    }
  }

  const { password } = req.body;
  if (!password) {
    res.render('pages/public/password', {
      title: 'Password Required',
      slug,
      error: 'Password is required',
      csrfToken: res.locals.csrfToken,
    });
    return;
  }

  try {
    const result = await consumeLinkWithPassword(slug, password, ip, userAgent, referer);

    if (!result.success) {
      if (result.status === 'password_required') {
        res.render('pages/public/password', {
          title: 'Password Required',
          slug,
          error: result.error || 'Incorrect password',
          csrfToken: res.locals.csrfToken,
        });
        return;
      }

      const statusPage = result.status || 'invalid';
      res.status(statusPage === 'invalid' ? 404 : 410).render(`pages/status/${statusPage}`, {
        title: getStatusTitle(statusPage),
      });
      return;
    }

    res.redirect(302, result.destinationUrl!);
  } catch (err) {
    logger.error({ err, slug }, 'Password consume error');
    res.status(500).render('pages/status/error', {
      title: 'Error',
      message: 'An unexpected error occurred.',
    });
  }
});

function getStatusTitle(status: string): string {
  switch (status) {
    case 'consumed': return 'Link Already Used';
    case 'expired': return 'Link Expired';
    case 'disabled': return 'Link Disabled';
    case 'invalid': return 'Link Not Found';
    default: return 'Link Unavailable';
  }
}

export default router;
