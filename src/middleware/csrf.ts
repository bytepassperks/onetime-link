import { doubleCsrf } from 'csrf-csrf';
import { getEnv } from '../config/env';

export function setupCsrf() {
  const env = getEnv();
  const isProd = env.NODE_ENV === 'production';

  const { doubleCsrfProtection, generateToken } = doubleCsrf({
    getSecret: () => env.SESSION_SECRET,
    cookieName: '_csrf',
    cookieOptions: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
    },
    getTokenFromRequest: (req) => {
      return req.body?._csrf || req.headers['x-csrf-token'] as string;
    },
  });

  return { doubleCsrfProtection, generateToken };
}
