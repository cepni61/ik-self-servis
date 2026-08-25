/**
 * Ek dosya servisi.
 *
 * Guvenlik notlari:
 *  - Dosyalar web root altinda DEGIL, ayri bir storage dizininde tutulur.
 *  - Indirme her zaman talep yetkisi kontrolunden gecer; dogrudan dosya yolu
 *    ile erisim mumkun degildir (saklanan ad rastgeledir).
 *  - Silme fiziksel degil soft delete'dir.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../db';
import type { AuthUser } from '../auth/auth-context';
import { isAdmin } from '../auth/auth-context';
import { env } from '../config/env';
import { AUDIT_EVENT, AUDIT_VISIBILITY, STATUS } from '../domain/constants';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors';
import { logger } from '../lib/logger';
import { writeAudit } from './audit.service';
import { getAttachmentLimits } from './settings.service';
import { buildVisibilityWhere } from './request.service';

async function ensureStorageDir(): Promise<string> {
  await fs.mkdir(env.storage.dir, { recursive: true });
  return env.storage.dir;
}

/** Kullanicinin bu talebi gorme yetkisi var mi (dosya erisimi icin on kosul). */
async function assertRequestAccess(user: AuthUser, requestId: string) {
  const request = await prisma.request.findFirst({
    where: { AND: [{ id: requestId }, buildVisibilityWhere(user)] },
    select: { id: true, requesterId: true, statusCode: true, requestNo: true },
  });
  if (!request) {
    throw new NotFoundError('Talep bulunamadı veya erişim yetkiniz yok.');
  }
  return request;
}

export interface UploadInput {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
}

export async function uploadAttachment(
  user: AuthUser,
  requestId: string,
  file: UploadInput,
) {
  const request = await assertRequestAccess(user, requestId);
  const limits = await getAttachmentLimits();

  const maxBytes = limits.maxSizeMb * 1024 * 1024;
  if (file.buffer.length === 0) {
    throw new ValidationError('Boş dosya yüklenemez.');
  }
  if (file.buffer.length > maxBytes) {
    throw new ValidationError(`Dosya boyutu en fazla ${limits.maxSizeMb} MB olabilir.`);
  }
  if (limits.allowedMimeTypes.length > 0 && !limits.allowedMimeTypes.includes(file.mimeType)) {
    throw new ValidationError('Bu dosya türü kabul edilmiyor.');
  }

  // Dosya adi kullanici girdisidir: yol bileseni temizlenir.
  const safeName = path.basename(file.originalName).replace(/[\r\n\t]/g, '').slice(0, 200);
  if (!safeName) throw new ValidationError('Geçersiz dosya adı.');

  const dir = await ensureStorageDir();
  const storedName = `${crypto.randomUUID()}${path.extname(safeName).slice(0, 12)}`;
  const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');

  await fs.writeFile(path.join(dir, storedName), file.buffer);

  try {
    const attachment = await prisma.attachment.create({
      data: {
        requestId,
        fileName: safeName,
        storedName,
        mimeType: file.mimeType,
        sizeBytes: file.buffer.length,
        checksum,
        uploadedById: user.id,
      },
      include: { uploadedBy: { select: { id: true, displayName: true } } },
    });

    await writeAudit(prisma, {
      requestId,
      eventType: AUDIT_EVENT.ATTACHMENT_ADDED,
      actor: { id: user.id, displayName: user.displayName, role: user.roles[0] ?? null },
      fieldName: 'attachment',
      newValue: safeName,
      description: `Dosya eklendi: ${safeName}`,
      visibility: AUDIT_VISIBILITY.USER,
    });

    return {
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      uploadedBy: attachment.uploadedBy,
      uploadedAt: attachment.uploadedAt,
    };
  } catch (err) {
    // DB kaydi olusmadiysa yazilan dosyayi birakma.
    await fs.unlink(path.join(dir, storedName)).catch(() => undefined);
    logger.error({ err, requestId }, 'Ek dosya kaydi olusturulamadi');
    throw err;
  }
}

export async function listAttachments(user: AuthUser, requestId: string) {
  await assertRequestAccess(user, requestId);
  const rows = await prisma.attachment.findMany({
    where: { requestId, isDeleted: false },
    orderBy: { uploadedAt: 'asc' },
    include: { uploadedBy: { select: { id: true, displayName: true } } },
  });
  return rows.map((a) => ({
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    uploadedBy: a.uploadedBy,
    uploadedAt: a.uploadedAt,
  }));
}

export interface DownloadResult {
  fileName: string;
  mimeType: string;
  absolutePath: string;
}

/** Indirme: attachment -> talep -> yetki zinciri kontrol edilir. */
export async function getAttachmentForDownload(
  user: AuthUser,
  attachmentId: string,
): Promise<DownloadResult> {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, isDeleted: false },
  });
  if (!attachment) throw new NotFoundError('Dosya bulunamadı.');

  // Baska talebin dosyasina erisim burada engellenir.
  await assertRequestAccess(user, attachment.requestId);

  const dir = await ensureStorageDir();
  const absolutePath = path.join(dir, attachment.storedName);

  // storedName uygulama tarafindan uretilir; yine de dizin disina cikis kontrolu.
  const normalized = path.normalize(absolutePath);
  if (!normalized.startsWith(path.normalize(dir))) {
    throw new ForbiddenError('Geçersiz dosya yolu.');
  }

  try {
    await fs.access(normalized);
  } catch {
    throw new NotFoundError('Dosya sunucuda bulunamadı.');
  }

  return {
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    absolutePath: normalized,
  };
}

/**
 * Soft delete. Yalnizca yukleyen kisi (talep hala aciksa) veya Admin kaldirabilir.
 * Fiziksel silme yapilmaz; audit izi korunur.
 */
export async function removeAttachment(user: AuthUser, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, isDeleted: false },
    include: { request: { select: { id: true, statusCode: true, requesterId: true } } },
  });
  if (!attachment) throw new NotFoundError('Dosya bulunamadı.');
  await assertRequestAccess(user, attachment.requestId);

  const admin = isAdmin(user);
  const isUploader = attachment.uploadedById === user.id;
  if (!admin && !isUploader) {
    throw new ForbiddenError('Bu dosyayı kaldırma yetkiniz yok.');
  }

  await prisma.attachment.update({
    where: { id: attachmentId },
    data: { isDeleted: true, deletedAt: new Date(), deletedById: user.id },
  });

  await writeAudit(prisma, {
    requestId: attachment.requestId,
    eventType: AUDIT_EVENT.ATTACHMENT_REMOVED,
    actor: { id: user.id, displayName: user.displayName, role: user.roles[0] ?? null },
    fieldName: 'attachment',
    oldValue: attachment.fileName,
    description: `Dosya kaldırıldı: ${attachment.fileName}`,
    visibility: AUDIT_VISIBILITY.USER,
  });

  return { id: attachmentId };
}

// ---------------------------------------------------------------------------
// Yorum
// ---------------------------------------------------------------------------

export async function addComment(
  user: AuthUser,
  requestId: string,
  input: { body: string; isInternal?: boolean },
) {
  const request = await assertRequestAccess(user, requestId);

  const body = (input.body ?? '').trim();
  if (body.length < 1) throw new ValidationError('Yorum boş olamaz.');
  if (body.length > 4000) throw new ValidationError('Yorum en fazla 4000 karakter olabilir.');

  // Dahili not yalnizca talep sahibi olmayan kullanicilar tarafindan eklenebilir.
  const isInternal = Boolean(input.isInternal) && request.requesterId !== user.id;

  const comment = await prisma.comment.create({
    data: { requestId, authorId: user.id, body, isInternal },
    include: { author: { select: { id: true, displayName: true, title: true } } },
  });

  await writeAudit(prisma, {
    requestId,
    eventType: AUDIT_EVENT.COMMENT_ADDED,
    actor: { id: user.id, displayName: user.displayName, role: user.roles[0] ?? null },
    description: isInternal ? 'Dahili not eklendi.' : body.slice(0, 500),
    visibility: isInternal ? AUDIT_VISIBILITY.ADMIN : AUDIT_VISIBILITY.USER,
  });

  return {
    id: comment.id,
    body: comment.body,
    author: comment.author,
    isInternal: comment.isInternal,
    createdAt: comment.createdAt,
  };
}

export async function listComments(user: AuthUser, requestId: string) {
  const request = await assertRequestAccess(user, requestId);
  const admin = isAdmin(user);
  const hideInternal = request.requesterId === user.id && !admin;

  const rows = await prisma.comment.findMany({
    where: { requestId, isDeleted: false, ...(hideInternal ? { isInternal: false } : {}) },
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, displayName: true, title: true } } },
  });

  return rows.map((c) => ({
    id: c.id,
    body: c.body,
    author: c.author,
    isInternal: c.isInternal,
    createdAt: c.createdAt,
  }));
}

export { STATUS as ATTACHMENT_STATUS_REF };
