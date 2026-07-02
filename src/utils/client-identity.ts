import type { Request, Response } from 'express';
import { nanoid } from 'nanoid';
import crypto from 'crypto';
import { hashIp } from './bot-detection';

const CLIENT_COOKIE_NAME = 'loc_cid';
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function hashUserAgent(userAgent: string | undefined): string {
  return crypto.createHash('sha256').update(userAgent || '').digest('hex').substring(0, 16);
}

export function hashClientFingerprint(ip: string, userAgent: string | undefined): string {
  const combined = `${hashIp(ip)}:${hashUserAgent(userAgent)}`;
  return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
}

export function getClientIdentity(req: Request, res: Response): { clientId: string; ipUaHash: string } {
  const existingClientId = req.cookies?.[CLIENT_COOKIE_NAME] as string | undefined;
  const clientId = existingClientId || nanoid();

  if (!existingClientId) {
    res.cookie(CLIENT_COOKIE_NAME, clientId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ONE_YEAR_MS,
      path: '/',
    });
  }

  return {
    clientId,
    ipUaHash: hashClientFingerprint(req.ip || '0.0.0.0', req.headers['user-agent'] as string | undefined),
  };
}
