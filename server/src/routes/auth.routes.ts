import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db';
import { env } from '../config/env';
import { signAccessToken } from '../auth/jwt';
import { currentUser, requireAuth } from '../auth/middleware';
import { asyncHandler } from '../middleware/error';
import { ForbiddenError, UnauthenticatedError } from '../domain/errors';
import { logger } from '../lib/logger';

export const authRoutes = Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Kullanıcı adı gerekli.'),
  password: z.string().min(1, 'Şifre gerekli.'),
});

/**
 * Yerel giris.
 * Kurumsal ortamda AUTH_PROVIDER=oidc ile Entra ID akisi devreye alinir;
 * bu endpoint o zaman devre disi kalir.
 */
authRoutes.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username: username.toLowerCase().trim() },
          { email: username.toLowerCase().trim() },
        ],
      },
      include: { roles: true },
    });

    // Kullanici yok / pasif / sifre yanlis ayrimi sizdirilmaz.
    const genericFailure = new UnauthenticatedError('Kullanıcı adı veya şifre hatalı.');

    if (!user || !user.isActive || !user.passwordHash) {
      logger.warn({ username }, 'Basarisiz giris denemesi');
      throw genericFailure;
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      logger.warn({ userId: user.id }, 'Basarisiz giris denemesi (sifre)');
      throw genericFailure;
    }

    const token = signAccessToken({ sub: user.id, username: user.username });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        roles: user.roles.map((r) => r.roleCode),
      },
    });
  }),
);

/**
 * Gelistirme kolayligi: parola sormadan kullanici secerek giris.
 * Production'da her zaman kapali (env.allowDevLogin false).
 */
authRoutes.post(
  '/dev-login',
  asyncHandler(async (req, res) => {
    if (!env.allowDevLogin) {
      throw new ForbiddenError('Geliştirici girişi bu ortamda kapalıdır.');
    }
    const schema = z.object({ userId: z.string().min(1) });
    const { userId } = schema.parse(req.body);

    const user = await prisma.user.findFirst({
      where: { id: userId, isActive: true },
      include: { roles: true },
    });
    if (!user) throw new UnauthenticatedError('Kullanıcı bulunamadı.');

    const token = signAccessToken({ sub: user.id, username: user.username });
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        roles: user.roles.map((r) => r.roleCode),
      },
    });
  }),
);

/** Dev login ekraninda gosterilecek ornek kullanicilar. */
authRoutes.get(
  '/dev-users',
  asyncHandler(async (_req, res) => {
    if (!env.allowDevLogin) {
      res.json({ enabled: false, users: [] });
      return;
    }
    const users = await prisma.user.findMany({
      where: { isActive: true },
      orderBy: { displayName: 'asc' },
      take: 50,
      include: { roles: true, manager: { select: { displayName: true } } },
    });
    res.json({
      enabled: true,
      users: users.map((u) => ({
        id: u.id,
        displayName: u.displayName,
        username: u.username,
        department: u.department,
        title: u.title,
        managerName: u.manager?.displayName ?? null,
        roles: u.roles.map((r) => r.roleCode),
      })),
    });
  }),
);

/** Oturum sahibinin profili. Roller her istekte DB'den okunur. */
authRoutes.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const manager = user.managerId
      ? await prisma.user.findUnique({
          where: { id: user.managerId },
          select: { id: true, displayName: true, title: true, email: true },
        })
      : null;

    res.json({
      id: user.id,
      username: user.username,
      email: user.email,
      displayName: user.displayName,
      department: user.department,
      departmentCode: user.departmentCode,
      title: user.title,
      manager,
      roles: user.roles,
      groupIds: user.groupIds,
      capabilities: {
        canCreateRequest: true,
        hasTasks: user.roles.some((r) =>
          ['MANAGER', 'HR_USER', 'HR_PROCESS_OWNER'].includes(r),
        ),
        isHr: user.roles.some((r) => ['HR_USER', 'HR_PROCESS_OWNER'].includes(r)),
        isAdmin: user.roles.includes('ADMIN'),
      },
    });
  }),
);

authRoutes.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    // Token stateless; istemci tarafinda silinir.
    res.json({ ok: true });
  }),
);
