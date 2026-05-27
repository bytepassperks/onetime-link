import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import { getEnv } from './config/env';
import { setupCsrf } from './middleware/csrf';
import { setAdminLocals } from './middleware/auth';
import logger from './config/logger';
import publicRoutes from './routes/public.routes';
import consumeRoutes from './routes/consume.routes';
import adminRoutes from './routes/admin.routes';

export function createApp() {
  const env = getEnv();
  const app = express();

  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'none'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }));

  app.use(cors({ origin: env.APP_BASE_URL, credentials: true }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use(express.static(path.join(__dirname, '..', 'src', 'public'), {
    maxAge: env.NODE_ENV === 'production' ? '1d' : 0,
  }));

  const PgStore = connectPgSimple(session);

  app.use(session({
    store: new PgStore({
      conString: env.DATABASE_URL,
      tableName: 'sessions',
      createTableIfMissing: true,
      pruneSessionInterval: 60 * 15,
    }),
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'otl.sid',
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    },
  }));

  const { doubleCsrfProtection, generateToken } = setupCsrf();

  app.use((req, res, next) => {
    res.locals.csrfToken = generateToken(req, res);
    next();
  });

  app.use(setAdminLocals);

  // EJS setup with layouts
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'src', 'views'));

  // Simple layout support
  app.use((req, res, next) => {
    const originalRender = res.render.bind(res);
    res.render = function(view: string, options?: Record<string, unknown>, callback?: (err: Error, html: string) => void) {
      const opts = options || {};
      let layoutName: string | null = null;

      originalRender(view, { ...opts, layout: (name: string) => { layoutName = name; } }, (err: Error | null, viewHtml: string) => {
        if (err) {
          if (callback) return callback(err, '');
          return next(err);
        }
        if (layoutName) {
          originalRender(layoutName, { ...opts, body: viewHtml }, (err2: Error | null, html: string) => {
            if (err2) {
              if (callback) return callback(err2, '');
              return next(err2);
            }
            if (callback) return callback(null as unknown as Error, html);
            res.send(html);
          });
        } else {
          if (callback) return callback(null as unknown as Error, viewHtml);
          res.send(viewHtml);
        }
      });
    } as typeof res.render;
    next();
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(consumeRoutes);

  app.use((req, res, next) => {
    if (req.path.startsWith('/r/')) {
      return next();
    }
    doubleCsrfProtection(req, res, next);
  });

  app.use('/', publicRoutes);
  app.use('/admin', adminRoutes);

  app.use((_req, res) => {
    res.status(404).render('pages/status/error', {
      title: 'Page Not Found',
      message: 'The page you are looking for does not exist.',
    });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err: err.message, stack: err.stack }, 'Unhandled error');

    if (err.message === 'CSRF token validation failed' || err.message?.includes('csrf')) {
      res.status(403).render('pages/status/error', {
        title: 'Security Error',
        message: 'Your session has expired or the form submission was invalid. Please go back and try again.',
      });
      return;
    }

    res.status(500).render('pages/status/error', {
      title: 'Server Error',
      message: 'An unexpected error occurred. Please try again later.',
    });
  });

  return app;
}
