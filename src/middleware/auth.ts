import { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    adminId?: string;
    adminEmail?: string;
    adminName?: string;
    adminRole?: string;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session.adminId) {
    res.redirect('/admin/login');
    return;
  }
  next();
}

export function setAdminLocals(req: Request, res: Response, next: NextFunction): void {
  if (req.session.adminId) {
    res.locals.admin = {
      id: req.session.adminId,
      email: req.session.adminEmail,
      name: req.session.adminName,
      role: req.session.adminRole,
    };
  }
  res.locals.isAuthenticated = !!req.session.adminId;
  next();
}
