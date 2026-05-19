import rateLimit from 'express-rate-limit';
import { getEnv } from '../config/env';

export function createLinkRateLimit() {
  const env = getEnv();
  return rateLimit({
    windowMs: parseInt(env.LINK_CREATION_RATE_LIMIT_WINDOW_MIN) * 60 * 1000,
    max: parseInt(env.LINK_CREATION_RATE_LIMIT_MAX),
    message: 'Too many link creation requests. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || 'unknown',
  });
}

export function createLoginRateLimit() {
  const env = getEnv();
  return rateLimit({
    windowMs: parseInt(env.ADMIN_LOGIN_RATE_LIMIT_WINDOW_MIN) * 60 * 1000,
    max: parseInt(env.ADMIN_LOGIN_RATE_LIMIT_MAX),
    message: 'Too many login attempts. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || 'unknown',
  });
}

export function createConsumeRateLimit() {
  return rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    message: 'Too many requests. Please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip || 'unknown',
  });
}
