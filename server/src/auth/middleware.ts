import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthenticatedError } from '../domain/errors';
import type { RoleCode } from '../domain/constants';
import { ROLES } from '../domain/constants';
import { loadAuthUser, type AuthUser } from './auth-context';
import { verifyAccessToken } from './jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies
    ?.access_token;
  return cookieToken ?? null;
}

/**
 * Token varsa req.auth doldurur, yoksa sessizce devam eder.
 * Yetki zorunlulugu requireAuth / requireRoles ile uygulanir.
 */
export async function attachAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractToken(req);
    if (!token) return next();
    const payload = verifyAccessToken(token);
    req.auth = await loadAuthUser(payload.sub);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(new UnauthenticatedError());
  next();
}

/** Belirtilen rollerden en az birine sahip olma zorunlulugu (backend seviyesinde). */
export function requireRoles(...roles: RoleCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(new UnauthenticatedError());
    const allowed = roles.some((role) => req.auth!.roles.includes(role));
    if (!allowed) {
      return next(
        new ForbiddenError(
          'Bu ekran veya islem icin gerekli role sahip degilsiniz.',
        ),
      );
    }
    next();
  };
}

/** Admin ekranlari icin. Frontend gizlemesi yeterli degildir. */
export const requireAdmin = requireRoles(ROLES.ADMIN);

/** Yardimci: req.auth'u kesin sekilde alir (route icinde requireAuth sonrasi). */
export function currentUser(req: Request): AuthUser {
  if (!req.auth) throw new UnauthenticatedError();
  return req.auth;
}
