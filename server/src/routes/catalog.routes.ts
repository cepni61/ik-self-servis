import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { currentUser, requireAuth } from '../auth/middleware';
import { asyncHandler } from '../middleware/error';
import {
  listActiveCategories,
  listGroups,
  listPriorities,
  listRoles,
  listStatuses,
} from '../services/catalog.service';
import { getCategoryFormFields } from '../services/form.service';
import {
  countUnread,
  listNotifications,
  markAllRead,
  markRead,
} from '../services/notification.service';
import { getExportRows, getReportSummary, toCsv } from '../services/report.service';
import { NotFoundError } from '../domain/errors';

export const catalogRoutes = Router();
catalogRoutes.use(requireAuth);

// ---------------------------------------------------------------------------
// Referans veriler
// ---------------------------------------------------------------------------

/** Talep olusturma ekraninin ihtiyac duydugu tum referans veri tek istekte. */
catalogRoutes.get(
  '/bootstrap',
  asyncHandler(async (_req, res) => {
    const [categories, statuses, priorities] = await Promise.all([
      listActiveCategories(),
      listStatuses(),
      listPriorities(),
    ]);
    res.json({ categories, statuses, priorities });
  }),
);

catalogRoutes.get(
  '/categories',
  asyncHandler(async (_req, res) => {
    res.json(await listActiveCategories());
  }),
);

/** Kategoriye ozel dinamik form alanlari. */
catalogRoutes.get(
  '/categories/:id/form-fields',
  asyncHandler(async (req, res) => {
    const category = await prisma.requestCategory.findFirst({
      where: { id: req.params.id, isActive: true },
      select: { id: true, name: true, defaultPriority: true, requiresManagerApproval: true },
    });
    if (!category) throw new NotFoundError('Kategori bulunamadı veya aktif değil.');

    res.json({
      category,
      fields: await getCategoryFormFields(category.id),
    });
  }),
);

catalogRoutes.get(
  '/statuses',
  asyncHandler(async (_req, res) => {
    res.json(await listStatuses());
  }),
);

catalogRoutes.get(
  '/priorities',
  asyncHandler(async (_req, res) => {
    res.json(await listPriorities());
  }),
);

catalogRoutes.get(
  '/roles',
  asyncHandler(async (_req, res) => {
    res.json(await listRoles());
  }),
);

catalogRoutes.get(
  '/groups',
  asyncHandler(async (_req, res) => {
    res.json(await listGroups());
  }),
);

/**
 * Kullanici arama (USER tipi form alanlari ve admin sorumlu secimi icin).
 * Yalnizca aktif kullanicilar, sinirli alanlar doner.
 */
catalogRoutes.get(
  '/users/search',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const roleCode = req.query.roleCode ? String(req.query.roleCode) : undefined;

    if (q.length < 2 && !roleCode) {
      res.json([]);
      return;
    }

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(q.length >= 2
          ? {
              OR: [
                { displayName: { contains: q } },
                { email: { contains: q } },
                { employeeNo: { contains: q } },
              ],
            }
          : {}),
        ...(roleCode ? { roles: { some: { roleCode } } } : {}),
      },
      orderBy: { displayName: 'asc' },
      take: 25,
      select: {
        id: true,
        displayName: true,
        email: true,
        department: true,
        title: true,
        employeeNo: true,
      },
    });
    res.json(users);
  }),
);

/** Secili kullanicinin gosterim bilgisi (form alanlari / admin secimleri icin). */
catalogRoutes.get(
  '/users/:id',
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findFirst({
      where: { id: req.params.id },
      select: {
        id: true,
        displayName: true,
        email: true,
        department: true,
        title: true,
        employeeNo: true,
        isActive: true,
      },
    });
    if (!user) throw new NotFoundError('Kullanıcı bulunamadı.');
    res.json(user);
  }),
);

// ---------------------------------------------------------------------------
// Bildirimler
// ---------------------------------------------------------------------------

catalogRoutes.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const unreadOnly = req.query.unreadOnly === 'true';
    const [items, unreadCount] = await Promise.all([
      listNotifications(user.id, { unreadOnly, limit: 50 }),
      countUnread(user.id),
    ]);
    res.json({ items, unreadCount });
  }),
);

catalogRoutes.post(
  '/notifications/read',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { ids } = z.object({ ids: z.array(z.string()).min(1) }).parse(req.body);
    res.json({ count: await markRead(user.id, ids) });
  }),
);

catalogRoutes.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json({ count: await markAllRead(user.id) });
  }),
);

// ---------------------------------------------------------------------------
// Raporlama
// ---------------------------------------------------------------------------

function parseReportFilters(query: Record<string, unknown>) {
  const toArray = (value: unknown): string[] | undefined => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
    const text = String(value).trim();
    return text ? text.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  };

  return {
    requestNo: query.requestNo ? String(query.requestNo) : undefined,
    categoryId: query.categoryId ? String(query.categoryId) : undefined,
    statusCode: toArray(query.statusCode),
    priority: toArray(query.priority),
    requesterId: query.requesterId ? String(query.requesterId) : undefined,
    departmentCode: query.departmentCode ? String(query.departmentCode) : undefined,
    managerId: query.managerId ? String(query.managerId) : undefined,
    slaStatus: toArray(query.slaStatus),
    createdFrom: query.createdFrom ? String(query.createdFrom) : undefined,
    createdTo: query.createdTo ? String(query.createdTo) : undefined,
    closedFrom: query.closedFrom ? String(query.closedFrom) : undefined,
    closedTo: query.closedTo ? String(query.closedTo) : undefined,
    scope:
      query.scope === 'open' || query.scope === 'closed' || query.scope === 'all'
        ? (query.scope as 'open' | 'closed' | 'all')
        : undefined,
    search: query.search ? String(query.search) : undefined,
  };
}

catalogRoutes.get(
  '/reports/summary',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const filters = parseReportFilters(req.query as Record<string, unknown>);
    res.json(await getReportSummary(user, filters));
  }),
);

catalogRoutes.get(
  '/reports/export',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const filters = parseReportFilters(req.query as Record<string, unknown>);
    const rows = await getExportRows(user, filters);

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="hr-talep-raporu-${stamp}.csv"`,
    );
    res.send(toCsv(rows));
  }),
);
