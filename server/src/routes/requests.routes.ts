import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { currentUser, requireAuth } from '../auth/middleware';
import { asyncHandler } from '../middleware/error';
import { env } from '../config/env';
import {
  cancelRequest,
  createRequest,
  getRequestDetail,
  listMyTasks,
  listRequests,
  submitRequest,
  updateDraft,
} from '../services/request.service';
import { executeAction } from '../services/workflow-engine';
import {
  addComment,
  getAttachmentForDownload,
  listAttachments,
  listComments,
  removeAttachment,
  uploadAttachment,
} from '../services/attachment.service';
import { ValidationError } from '../domain/errors';

export const requestRoutes = Router();
requestRoutes.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.storage.maxFileSizeMb * 1024 * 1024, files: 1 },
});

// ---------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------

/** Virgulle ayrilmis veya tekrarlanan query parametresini diziye cevirir. */
function toArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const text = String(value).trim();
  if (!text) return undefined;
  return text.split(',').map((s) => s.trim()).filter(Boolean);
}

function toInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : undefined;
}

const rowVersionSchema = z
  .number({ invalid_type_error: 'Kayıt sürümü (rowVersion) gönderilmelidir.' })
  .int()
  .min(1);

// ---------------------------------------------------------------------------
// Liste ve gorev kutusu
// ---------------------------------------------------------------------------

requestRoutes.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const q = req.query;

    const result = await listRequests(user, {
      requestNo: q.requestNo ? String(q.requestNo) : undefined,
      categoryId: q.categoryId ? String(q.categoryId) : undefined,
      categoryCode: q.categoryCode ? String(q.categoryCode) : undefined,
      statusCode: toArray(q.statusCode),
      priority: toArray(q.priority),
      requesterId: q.requesterId ? String(q.requesterId) : undefined,
      departmentCode: q.departmentCode ? String(q.departmentCode) : undefined,
      managerId: q.managerId ? String(q.managerId) : undefined,
      assigneeId: q.assigneeId ? String(q.assigneeId) : undefined,
      slaStatus: toArray(q.slaStatus),
      createdFrom: q.createdFrom ? String(q.createdFrom) : undefined,
      createdTo: q.createdTo ? String(q.createdTo) : undefined,
      closedFrom: q.closedFrom ? String(q.closedFrom) : undefined,
      closedTo: q.closedTo ? String(q.closedTo) : undefined,
      scope: q.scope === 'open' || q.scope === 'closed' || q.scope === 'all' ? q.scope : undefined,
      search: q.search ? String(q.search) : undefined,
      onlyMine: q.onlyMine === 'true' || q.onlyMine === '1',
      page: toInt(q.page),
      pageSize: toInt(q.pageSize),
      sortBy:
        q.sortBy === 'createdAt' ||
        q.sortBy === 'updatedAt' ||
        q.sortBy === 'slaDueAt' ||
        q.sortBy === 'requestNo'
          ? q.sortBy
          : undefined,
      sortDir: q.sortDir === 'asc' ? 'asc' : q.sortDir === 'desc' ? 'desc' : undefined,
    });

    res.json(result);
  }),
);

/** Bana dusen, islem bekleyen talepler (Manager / HR gorev kutusu). */
requestRoutes.get(
  '/tasks/inbox',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const result = await listMyTasks(user, {
      page: toInt(req.query.page),
      pageSize: toInt(req.query.pageSize),
    });
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// Olusturma / guncelleme
// ---------------------------------------------------------------------------

const createSchema = z.object({
  categoryId: z.string().min(1, 'Kategori seçilmelidir.'),
  subject: z.string().min(3, 'Talep konusu en az 3 karakter olmalıdır.').max(200),
  description: z.string().max(4000).optional().nullable(),
  priority: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  formData: z.record(z.unknown()).optional(),
  submit: z.boolean().optional(),
});

requestRoutes.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = createSchema.parse(req.body);
    const result = await createRequest(user, input);
    res.status(201).json(result);
  }),
);

const updateSchema = z.object({
  subject: z.string().min(3).max(200).optional(),
  description: z.string().max(4000).optional().nullable(),
  priority: z.string().optional().nullable(),
  dueDate: z.string().optional().nullable(),
  formData: z.record(z.unknown()).optional(),
  expectedRowVersion: rowVersionSchema,
});

requestRoutes.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = updateSchema.parse(req.body);
    const result = await updateDraft(user, req.params.id, input);
    res.json(result);
  }),
);

requestRoutes.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { expectedRowVersion } = z
      .object({ expectedRowVersion: rowVersionSchema })
      .parse(req.body);
    const result = await submitRequest(user, req.params.id, expectedRowVersion);
    res.json(result);
  }),
);

requestRoutes.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z
      .object({
        expectedRowVersion: rowVersionSchema,
        comment: z.string().max(2000).optional().nullable(),
      })
      .parse(req.body);
    const result = await cancelRequest(user, req.params.id, input);
    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// Detay
// ---------------------------------------------------------------------------

requestRoutes.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const detail = await getRequestDetail(user, req.params.id);
    res.json(detail);
  }),
);

// ---------------------------------------------------------------------------
// Is aksiyonu (onayla / reddet / tamamla / ek bilgi ...)
//
// Serbest "status update" endpoint'i BILINCLI OLARAK YOKTUR.
// Durum yalnizca workflow konfigurasyonunda tanimli aksiyonlarla degisir.
// ---------------------------------------------------------------------------

const actionSchema = z.object({
  actionCode: z.string().min(1, 'İşlem kodu gerekli.'),
  comment: z.string().max(4000).optional().nullable(),
  expectedRowVersion: rowVersionSchema,
});

requestRoutes.post(
  '/:id/actions',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = actionSchema.parse(req.body);

    // Idempotency-Key basligi varsa cift gonderim ayni sonucu dondurur.
    const headerKey = req.header('Idempotency-Key');

    const result = await executeAction({
      requestId: req.params.id,
      actionCode: input.actionCode,
      actor: {
        id: user.id,
        displayName: user.displayName,
        roles: user.roles,
        groupIds: user.groupIds,
        primaryRole: user.roles[0] ?? null,
      },
      comment: input.comment ?? null,
      expectedRowVersion: input.expectedRowVersion,
      idempotencyKey: headerKey ?? null,
      ipAddress: req.ip ?? null,
    });

    res.json(result);
  }),
);

// ---------------------------------------------------------------------------
// Ek dosyalar
// ---------------------------------------------------------------------------

requestRoutes.get(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(await listAttachments(user, req.params.id));
  }),
);

requestRoutes.post(
  '/:id/attachments',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const file = (req as typeof req & { file?: Express.Multer.File }).file;
    if (!file) throw new ValidationError('Yüklenecek dosya bulunamadı.');

    const result = await uploadAttachment(user, req.params.id, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
    });
    res.status(201).json(result);
  }),
);

requestRoutes.get(
  '/attachments/:attachmentId/download',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const file = await getAttachmentForDownload(user, req.params.attachmentId);

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    // Tarayicida calistirilmasini engelle
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.download(file.absolutePath, file.fileName);
  }),
);

requestRoutes.delete(
  '/attachments/:attachmentId',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(await removeAttachment(user, req.params.attachmentId));
  }),
);

// ---------------------------------------------------------------------------
// Yorumlar
// ---------------------------------------------------------------------------

requestRoutes.get(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    res.json(await listComments(user, req.params.id));
  }),
);

requestRoutes.post(
  '/:id/comments',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const input = z
      .object({
        body: z.string().min(1, 'Yorum boş olamaz.').max(4000),
        isInternal: z.boolean().optional(),
      })
      .parse(req.body);
    res.status(201).json(await addComment(user, req.params.id, input));
  }),
);
