/**
 * Talep servisi.
 *
 * Yetki kontrolu BURADA yapilir (frontend'e guvenilmez):
 *  - Employee yalnizca kendi kayitlarini gorur.
 *  - Manager yalnizca kendisine yonlenmis / gecmiste sorumlusu oldugu kayitlari gorur.
 *  - HR yalnizca kategori sahipligi kendisine ait olan kayitlari gorur.
 *  - Taslak kayitlar yalnizca sahibine (ve Admin'e) goruntulenir.
 */

import { Prisma } from '@prisma/client';
import { prisma, type Db } from '../db';
import type { AuthUser } from '../auth/auth-context';
import { isAdmin } from '../auth/auth-context';
import {
  ACTION_KIND,
  AUDIT_EVENT,
  AUDIT_VISIBILITY,
  HR_ROLE_CODES,
  INSTANCE_STATUS,
  NOTIFICATION_EVENT,
  PRIORITY,
  ROLES,
  SLA_STATUS,
  STATUS,
  STEP_INSTANCE_STATUS,
  type RoleCode,
} from '../domain/constants';
import {
  ConflictError,
  DuplicateActionError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  StaleDataError,
  ValidationError,
  WorkflowConfigError,
} from '../domain/errors';
import { describeRemaining, evaluateSlaStatus } from '../domain/sla';
import { stringifyJson, tryParseJson } from '../lib/json';
import { containsInsensitive } from '../lib/text-search';
import { writeAudit } from './audit.service';
import { describeStatus, getPriorityMap, getStatusMap } from './catalog.service';
import { getCategoryFormFields, validateFormData } from './form.service';
import {
  buildConditionContext,
  getAvailableActions,
  getProgress,
  loadVersionGraph,
  startWorkflow,
  type EngineActor,
} from './workflow-engine';
import { dispatchNotifications, type NotificationIntent } from './notification.service';
import { getSlaAtRiskThreshold, getSlaCalendarOptions } from './settings.service';

// ---------------------------------------------------------------------------
// Yetki / gorunurluk
// ---------------------------------------------------------------------------

function hrRolesOf(user: AuthUser): RoleCode[] {
  return user.roles.filter((r) => HR_ROLE_CODES.includes(r));
}

/**
 * Kullanicinin gorebilecegi taleplerin Prisma filtresi.
 * Tum liste/detay sorgulari bu filtreden gecer; boylece tek bir yetki noktasi olur.
 */
export function buildVisibilityWhere(user: AuthUser): Prisma.RequestWhereInput {
  // Admin canli operasyon ekranlari icin tum kayitlari gorur.
  if (isAdmin(user)) return {};

  const notDraft: Prisma.RequestWhereInput = { statusCode: { not: STATUS.DRAFT } };

  const clauses: Prisma.RequestWhereInput[] = [
    // Kendi talepleri (taslaklar dahil)
    { requesterId: user.id },
    // Su anda kendisine atanmis veya gecmiste sorumlusu oldugu talepler
    {
      AND: [
        notDraft,
        {
          OR: [
            { currentAssigneeId: user.id },
            { instance: { stepInstances: { some: { assigneeId: user.id } } } },
          ],
        },
      ],
    },
  ];

  // Havuz gorevleri: kullanicinin rol/grup uyelikleri
  if (user.roles.length > 0 || user.groupIds.length > 0) {
    clauses.push({
      AND: [
        notDraft,
        {
          OR: [
            ...(user.roles.length > 0
              ? [{ currentAssigneeRoleCode: { in: user.roles } }]
              : []),
            ...(user.groupIds.length > 0
              ? [{ currentAssigneeGroupId: { in: user.groupIds } }]
              : []),
          ],
        },
      ],
    });
  }

  // IK rolleri: kategori sahipligi kendilerine ait olan kayitlar.
  //
  // BUSINESS DECISION REQUIRED - IK ici gorunurluk hiyerarsisi:
  // Spec "HR yalnizca yetkili oldugu kayitlari islemeli" diyor ancak IK icindeki
  // rol/kategori eslesmesini netlestirmiyor. Uygulanan makul varsayim:
  //   - HR_PROCESS_OWNER (surec sahibi / ust seviye IK): IK'ya ait TUM
  //     kategorileri gorur. Aksi halde surec sahibi kendi ekibinin isini
  //     goremezdi.
  //   - HR_USER: yalnizca kendi rolune veya uyesi oldugu ekibe atanmis
  //     kategorileri gorur.
  // Daha dar/genis bir kural istenirse kategori "ownerRoleCode / ownerGroupId"
  // alanlari uzerinden konfigurasyonla ayarlanabilir.
  const hrRoles = hrRolesOf(user);
  if (user.roles.includes(ROLES.HR_PROCESS_OWNER)) {
    clauses.push({
      AND: [
        notDraft,
        {
          OR: [
            { category: { ownerRoleCode: null } },
            { category: { ownerRoleCode: { in: HR_ROLE_CODES } } },
          ],
        },
      ],
    });
  } else if (hrRoles.length > 0) {
    clauses.push({
      AND: [
        notDraft,
        {
          OR: [
            { category: { ownerRoleCode: null } },
            { category: { ownerRoleCode: { in: hrRoles } } },
            ...(user.groupIds.length > 0
              ? [{ category: { ownerGroupId: { in: user.groupIds } } }]
              : []),
          ],
        },
      ],
    });
  }

  return { OR: clauses };
}

async function findVisibleRequestOrThrow(user: AuthUser, requestId: string) {
  const request = await prisma.request.findFirst({
    where: { AND: [{ id: requestId }, buildVisibilityWhere(user)] },
    include: {
      category: true,
      requester: {
        select: {
          id: true,
          displayName: true,
          email: true,
          department: true,
          departmentCode: true,
          title: true,
          managerId: true,
        },
      },
      currentAssignee: { select: { id: true, displayName: true } },
      instance: { include: { version: { select: { id: true, versionNumber: true } }, definition: { select: { name: true, code: true } } } },
    },
  });

  if (!request) {
    // Kayit yok veya yetki yok - ayrimi sizdirmamak icin ayni hata.
    throw new NotFoundError('Talep bulunamadı veya görüntüleme yetkiniz yok.');
  }
  return request;
}

function toEngineActor(user: AuthUser): EngineActor {
  return {
    id: user.id,
    displayName: user.displayName,
    roles: user.roles,
    groupIds: user.groupIds,
    primaryRole: user.roles[0] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Talep numarasi
// ---------------------------------------------------------------------------

async function nextRequestNo(db: Db, prefix: string | null): Promise<string> {
  const safePrefix = (prefix ?? 'TLP').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'TLP';
  const year = new Date().getFullYear();
  const key = `${safePrefix}-${year}`;

  const seq = await db.requestSequence.upsert({
    where: { key },
    create: { key, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });

  return `${safePrefix}-${year}-${String(seq.lastValue).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Olusturma / guncelleme
// ---------------------------------------------------------------------------

export interface CreateRequestInput {
  categoryId: string;
  subject: string;
  description?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  formData?: Record<string, unknown>;
  /** true ise ayni islemde gonderilir. */
  submit?: boolean;
  idempotencyKey?: string | null;
}

async function loadCategoryOrThrow(categoryId: string) {
  const category = await prisma.requestCategory.findFirst({
    where: { id: categoryId, isActive: true },
  });
  if (!category) {
    throw new ValidationError('Seçilen talep kategorisi bulunamadı veya aktif değil.');
  }
  return category;
}

async function resolvePriority(input: string | null | undefined, fallback: string) {
  const priorities = await getPriorityMap();
  if (input && priorities.has(input)) return input;
  if (priorities.has(fallback)) return fallback;
  return PRIORITY.MEDIUM;
}

function parseDueDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('Beklenen termin tarihi geçersiz.');
  }
  return date;
}

export async function createRequest(user: AuthUser, input: CreateRequestInput) {
  const category = await loadCategoryOrThrow(input.categoryId);
  const subject = (input.subject ?? '').trim();
  if (subject.length < 3) {
    throw new ValidationError('Talep konusu en az 3 karakter olmalıdır.');
  }
  if (subject.length > 200) {
    throw new ValidationError('Talep konusu en fazla 200 karakter olabilir.');
  }

  const priority = await resolvePriority(input.priority, category.defaultPriority);
  const dueDate = parseDueDate(input.dueDate);

  const fields = await getCategoryFormFields(category.id);
  const conditionCtx = buildConditionContext({
    category,
    request: { priority, subject },
    requester: {
      id: user.id,
      department: user.department,
      departmentCode: user.departmentCode,
      title: user.title,
      managerId: user.managerId,
    },
    formData: input.formData ?? {},
  });

  const formData = await validateFormData(fields, input.formData ?? {}, conditionCtx, {
    partial: !input.submit,
  });

  const notifications: NotificationIntent[] = [];

  const created = await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const requestNo = await nextRequestNo(tx, category.requestNoPrefix);

    const request = await tx.request.create({
      data: {
        requestNo,
        categoryId: category.id,
        subject,
        description: input.description?.trim() || null,
        priority,
        dueDate,
        statusCode: STATUS.DRAFT,
        requesterId: user.id,
        requesterDepartment: user.department,
        requesterTitle: user.title,
        requesterManagerId: user.managerId,
        formDataJson: stringifyJson(formData),
      },
    });

    await writeAudit(tx, {
      requestId: request.id,
      eventType: AUDIT_EVENT.REQUEST_CREATED,
      actor: { id: user.id, displayName: user.displayName, role: user.roles[0] ?? null },
      newStatusCode: STATUS.DRAFT,
      description: `${category.name} talebi oluşturuldu.`,
      visibility: AUDIT_VISIBILITY.USER,
    });

    if (!input.submit) return request;

    return submitWithinTransaction({
      tx,
      user,
      request,
      category,
      formData,
      notifications,
    });
  });

  await dispatchNotifications(notifications);
  return { id: created.id, requestNo: created.requestNo, statusCode: created.statusCode };
}

export interface UpdateDraftInput {
  subject?: string;
  description?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  formData?: Record<string, unknown>;
  expectedRowVersion: number;
}

/** Yalnizca taslak durumdaki kendi talebi duzenlenebilir. */
export async function updateDraft(
  user: AuthUser,
  requestId: string,
  input: UpdateDraftInput,
) {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { category: true },
  });
  if (!request) throw new NotFoundError('Talep bulunamadı.');
  if (request.requesterId !== user.id) {
    throw new ForbiddenError('Yalnızca kendi taslak talebinizi düzenleyebilirsiniz.');
  }
  if (request.statusCode !== STATUS.DRAFT) {
    throw new InvalidTransitionError(
      'Gönderilmiş bir talep düzenlenemez. Değişiklik için ilgili adımda açıklama ekleyebilirsiniz.',
    );
  }

  const subject = input.subject !== undefined ? input.subject.trim() : request.subject;
  if (subject.length < 3) {
    throw new ValidationError('Talep konusu en az 3 karakter olmalıdır.');
  }
  const priority = await resolvePriority(input.priority, request.priority);
  const dueDate =
    input.dueDate !== undefined ? parseDueDate(input.dueDate) : request.dueDate;

  const fields = await getCategoryFormFields(request.categoryId);
  const mergedForm = {
    ...tryParseJson<Record<string, unknown>>(request.formDataJson, {}),
    ...(input.formData ?? {}),
  };
  const conditionCtx = buildConditionContext({
    category: request.category,
    request: { priority, subject },
    requester: {
      id: user.id,
      department: user.department,
      departmentCode: user.departmentCode,
      title: user.title,
      managerId: user.managerId,
    },
    formData: mergedForm,
  });
  const formData = await validateFormData(fields, mergedForm, conditionCtx, {
    partial: true,
  });

  const result = await prisma.request.updateMany({
    where: { id: requestId, rowVersion: input.expectedRowVersion },
    data: {
      subject,
      description:
        input.description !== undefined
          ? input.description?.trim() || null
          : request.description,
      priority,
      dueDate,
      formDataJson: stringifyJson(formData),
      rowVersion: { increment: 1 },
    },
  });
  if (result.count === 0) throw new StaleDataError();

  await writeAudit(prisma, {
    requestId,
    eventType: AUDIT_EVENT.REQUEST_UPDATED,
    actor: { id: user.id, displayName: user.displayName, role: user.roles[0] ?? null },
    description: 'Taslak talep güncellendi.',
    visibility: AUDIT_VISIBILITY.USER,
  });

  return { rowVersion: input.expectedRowVersion + 1 };
}

// ---------------------------------------------------------------------------
// Gonderim
// ---------------------------------------------------------------------------

interface SubmitWithinTxParams {
  tx: Db;
  user: AuthUser;
  request: Prisma.RequestGetPayload<{}>;
  category: Prisma.RequestCategoryGetPayload<{}>;
  formData: Record<string, unknown>;
  notifications: NotificationIntent[];
}

/**
 * ONEMLI: Workflow versiyonu GONDERIM aninda sabitlenir.
 * Taslak asamasinda versiyon baglanmaz; boylece taslak beklerken yayinlanan yeni
 * versiyon gecerli olur, ancak gonderilmis kayitlar kendi versiyonunda kalir.
 */
async function submitWithinTransaction(p: SubmitWithinTxParams) {
  const { tx, user, request, category } = p;

  if (!category.workflowDefinitionId) {
    throw new WorkflowConfigError(
      `"${category.name}" kategorisi için tanımlı bir iş akışı yok. Lütfen sistem yöneticisiyle iletişime geçin.`,
    );
  }

  const definition = await tx.workflowDefinition.findUnique({
    where: { id: category.workflowDefinitionId },
  });
  if (!definition || !definition.activeVersionId) {
    throw new WorkflowConfigError(
      `"${category.name}" kategorisinin iş akışı yayınlanmamış. Lütfen sistem yöneticisiyle iletişime geçin.`,
    );
  }

  const version = await loadVersionGraph(tx, definition.activeVersionId);
  const slaOptions = await getSlaCalendarOptions(version.slaCalendarMode);
  const atRiskThreshold = await getSlaAtRiskThreshold();

  const now = new Date();

  const outcome = await startWorkflow({
    db: tx,
    request: {
      id: request.id,
      requestNo: request.requestNo,
      subject: request.subject,
      priority: request.priority,
      requesterId: request.requesterId,
      requesterManagerId: request.requesterManagerId,
      createdAt: request.createdAt,
    },
    category: {
      id: category.id,
      code: category.code,
      name: category.name,
      requiresManagerApproval: category.requiresManagerApproval,
      ownerRoleCode: category.ownerRoleCode,
      ownerGroupId: category.ownerGroupId,
    },
    requester: {
      id: user.id,
      department: user.department,
      departmentCode: user.departmentCode,
      title: user.title,
      managerId: user.managerId,
    },
    formData: p.formData,
    version,
    actor: toEngineActor(user),
    slaOptions,
    atRiskThreshold,
  });

  p.notifications.push(...outcome.notifications);

  // Aktive edilen adima gore talebi guncelle.
  const current = await tx.stepInstance.findFirst({
    where: { instanceId: (await tx.workflowInstance.findUniqueOrThrow({ where: { requestId: request.id } })).id, isCurrent: true },
  });

  const updated = await tx.request.update({
    where: { id: request.id },
    data: {
      statusCode: current?.statusCode ?? STATUS.SUBMITTED,
      submittedAt: now,
      currentStepInstanceId: current?.id ?? null,
      currentStepCode: current?.stepCode ?? null,
      currentStepName: current?.stepName ?? null,
      currentStepSequence: current?.sequence ?? null,
      currentAssigneeId: current?.assigneeId ?? null,
      currentAssigneeRoleCode: current?.assigneeRoleCode ?? null,
      currentAssigneeGroupId: current?.assigneeGroupId ?? null,
      currentAssigneeLabel: current?.assigneeLabel ?? null,
      slaDueAt: current?.dueAt ?? null,
      slaStatus: current?.dueAt ? SLA_STATUS.ON_TRACK : SLA_STATUS.NA,
      rowVersion: { increment: 1 },
      ...(current
        ? {}
        : { completedAt: now, closedAt: now, statusCode: STATUS.COMPLETED }),
    },
  });

  await writeAudit(tx, {
    requestId: request.id,
    instanceId: (await tx.workflowInstance.findUniqueOrThrow({ where: { requestId: request.id } })).id,
    eventType: AUDIT_EVENT.REQUEST_SUBMITTED,
    actor: { id: user.id, displayName: user.displayName, role: user.roles[0] ?? null },
    workflowVersionId: version.id,
    workflowVersionNumber: version.versionNumber,
    oldStatusCode: STATUS.DRAFT,
    newStatusCode: updated.statusCode,
    description: 'Talep gönderildi ve iş akışı başlatıldı.',
    visibility: AUDIT_VISIBILITY.USER,
  });

  p.notifications.push({
    event: NOTIFICATION_EVENT.REQUEST_SUBMITTED,
    requestId: request.id,
    requestNo: request.requestNo,
    subject: request.subject,
    categoryName: category.name,
    versionId: version.id,
    requesterId: request.requesterId,
    requesterManagerId: request.requesterManagerId,
    currentAssigneeId: updated.currentAssigneeId,
    currentAssigneeRoleCode: updated.currentAssigneeRoleCode,
    currentAssigneeGroupId: updated.currentAssigneeGroupId,
    stepName: updated.currentStepName,
    actorDisplayName: user.displayName,
  });

  return updated;
}

/** Taslak halindeki talebi gonderir. */
export async function submitRequest(
  user: AuthUser,
  requestId: string,
  expectedRowVersion: number,
) {
  const existing = await prisma.request.findUnique({
    where: { id: requestId },
    include: { category: true },
  });
  if (!existing) throw new NotFoundError('Talep bulunamadı.');
  if (existing.requesterId !== user.id) {
    throw new ForbiddenError('Yalnızca kendi talebinizi gönderebilirsiniz.');
  }
  if (existing.statusCode !== STATUS.DRAFT) {
    // Cift gonderim: ikinci istek yeni bir is akisi baslatmaz.
    throw new DuplicateActionError('Bu talep zaten gönderilmiş.');
  }

  // Gonderimde zorunlu alanlar tam olarak dogrulanir.
  const fields = await getCategoryFormFields(existing.categoryId);
  const formDataRaw = tryParseJson<Record<string, unknown>>(existing.formDataJson, {});
  const conditionCtx = buildConditionContext({
    category: existing.category,
    request: { priority: existing.priority, subject: existing.subject },
    requester: {
      id: user.id,
      department: user.department,
      departmentCode: user.departmentCode,
      title: user.title,
      managerId: user.managerId,
    },
    formData: formDataRaw,
  });
  const formData = await validateFormData(fields, formDataRaw, conditionCtx);

  const notifications: NotificationIntent[] = [];

  const result = await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;

    // Atomik durum gecisi: yalnizca hala DRAFT ve rowVersion uyusuyorsa devam.
    const cas = await tx.request.updateMany({
      where: {
        id: requestId,
        statusCode: STATUS.DRAFT,
        rowVersion: expectedRowVersion,
      },
      data: { formDataJson: stringifyJson(formData) },
    });
    if (cas.count === 0) {
      throw new StaleDataError(
        'Talep bu arada değişmiş olabilir. Sayfayı yenileyip tekrar deneyin.',
      );
    }

    const fresh = await tx.request.findUniqueOrThrow({ where: { id: requestId } });
    return submitWithinTransaction({
      tx,
      user,
      request: fresh,
      category: existing.category,
      formData,
      notifications,
    });
  });

  await dispatchNotifications(notifications);
  return {
    id: result.id,
    statusCode: result.statusCode,
    rowVersion: result.rowVersion,
    currentStepName: result.currentStepName,
    currentAssigneeLabel: result.currentAssigneeLabel,
  };
}

// ---------------------------------------------------------------------------
// Iptal
// ---------------------------------------------------------------------------

/**
 * Talep sahibinin kendi talebini iptal etmesi.
 * Adim aksiyonu degildir; kayit sahibine tanimli ayri bir is aksiyonudur.
 */
export async function cancelRequest(
  user: AuthUser,
  requestId: string,
  input: { expectedRowVersion: number; comment?: string | null },
) {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: { category: true, instance: true },
  });
  if (!request) throw new NotFoundError('Talep bulunamadı.');
  if (request.requesterId !== user.id) {
    throw new ForbiddenError('Yalnızca kendi talebinizi iptal edebilirsiniz.');
  }

  const statuses = await getStatusMap();
  const currentStatus = statuses.get(request.statusCode);
  if (currentStatus?.isTerminal) {
    throw new InvalidTransitionError('Kapanmış bir talep iptal edilemez.');
  }

  const now = new Date();
  const notifications: NotificationIntent[] = [];

  await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;

    const cas = await tx.request.updateMany({
      where: { id: requestId, rowVersion: input.expectedRowVersion },
      data: { rowVersion: { increment: 1 } },
    });
    if (cas.count === 0) throw new StaleDataError();

    if (request.instance) {
      // Cift iptal koruması
      try {
        await tx.workflowActionLog.create({
          data: {
            instanceId: request.instance.id,
            requestId: request.id,
            actionCode: 'CANCEL_REQUEST',
            actionKind: ACTION_KIND.CANCEL,
            actionName: 'Talebi İptal Et',
            performedById: user.id,
            performedByRole: user.roles[0] ?? null,
            comment: input.comment?.trim() || null,
            fromStatusCode: request.statusCode,
            toStatusCode: STATUS.CANCELLED,
            idempotencyKey: `CANCEL:${user.id}`,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new DuplicateActionError('Bu talep zaten iptal edilmiş.');
        }
        throw err;
      }

      await tx.stepInstance.updateMany({
        where: {
          instanceId: request.instance.id,
          status: { in: [STEP_INSTANCE_STATUS.PENDING, STEP_INSTANCE_STATUS.ACTIVE] },
        },
        data: {
          status: STEP_INSTANCE_STATUS.CANCELLED,
          isCurrent: false,
          skipReason: 'REQUEST_CANCELLED',
          completedAt: now,
        },
      });

      await tx.workflowInstance.update({
        where: { id: request.instance.id },
        data: {
          status: INSTANCE_STATUS.CANCELLED,
          completedAt: now,
          rowVersion: { increment: 1 },
        },
      });
    }

    await tx.request.update({
      where: { id: requestId },
      data: {
        statusCode: STATUS.CANCELLED,
        closedAt: now,
        currentAssigneeId: null,
        currentAssigneeRoleCode: null,
        currentAssigneeGroupId: null,
        currentAssigneeLabel: null,
        currentStepInstanceId: null,
        currentStepCode: null,
        currentStepName: null,
        currentStepSequence: null,
        slaDueAt: null,
        slaStatus: SLA_STATUS.NA,
      },
    });

    await writeAudit(tx, {
      requestId,
      instanceId: request.instance?.id ?? null,
      eventType: AUDIT_EVENT.CANCELLED,
      actor: { id: user.id, displayName: user.displayName, role: user.roles[0] ?? null },
      oldStatusCode: request.statusCode,
      newStatusCode: STATUS.CANCELLED,
      description: input.comment?.trim() || 'Talep, talep sahibi tarafından iptal edildi.',
      visibility: AUDIT_VISIBILITY.USER,
    });

    if (request.instance) {
      notifications.push({
        event: NOTIFICATION_EVENT.CANCELLED,
        requestId,
        requestNo: request.requestNo,
        subject: request.subject,
        categoryName: request.category.name,
        versionId: request.instance.versionId,
        requesterId: request.requesterId,
        requesterManagerId: request.requesterManagerId,
        currentAssigneeId: null,
        currentAssigneeRoleCode: null,
        currentAssigneeGroupId: null,
        actorDisplayName: user.displayName,
        note: input.comment?.trim() || null,
      });
    }
  });

  await dispatchNotifications(notifications);
  return { statusCode: STATUS.CANCELLED, rowVersion: input.expectedRowVersion + 1 };
}

// ---------------------------------------------------------------------------
// Listeleme
// ---------------------------------------------------------------------------

export interface RequestListFilters {
  requestNo?: string;
  categoryId?: string;
  categoryCode?: string;
  statusCode?: string[];
  priority?: string[];
  requesterId?: string;
  departmentCode?: string;
  managerId?: string;
  assigneeId?: string;
  slaStatus?: string[];
  createdFrom?: string;
  createdTo?: string;
  closedFrom?: string;
  closedTo?: string;
  /** 'open' | 'closed' | 'all' */
  scope?: 'open' | 'closed' | 'all';
  search?: string;
  /** Yalnizca kendi taleplerim */
  onlyMine?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'slaDueAt' | 'requestNo';
  sortDir?: 'asc' | 'desc';
}

function parseDateBoundary(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
}

export async function buildFilterWhere(
  user: AuthUser,
  filters: RequestListFilters,
): Promise<Prisma.RequestWhereInput> {
  const and: Prisma.RequestWhereInput[] = [buildVisibilityWhere(user)];

  if (filters.onlyMine) and.push({ requesterId: user.id });
  if (filters.requestNo) {
    and.push({ requestNo: containsInsensitive(filters.requestNo.trim()) });
  }
  if (filters.categoryId) and.push({ categoryId: filters.categoryId });
  if (filters.categoryCode) and.push({ category: { code: filters.categoryCode } });
  if (filters.statusCode?.length) and.push({ statusCode: { in: filters.statusCode } });
  if (filters.priority?.length) and.push({ priority: { in: filters.priority } });
  if (filters.requesterId) and.push({ requesterId: filters.requesterId });
  if (filters.departmentCode) {
    and.push({ requester: { departmentCode: filters.departmentCode } });
  }
  if (filters.managerId) and.push({ requesterManagerId: filters.managerId });
  if (filters.assigneeId) and.push({ currentAssigneeId: filters.assigneeId });
  if (filters.slaStatus?.length) and.push({ slaStatus: { in: filters.slaStatus } });

  const createdFrom = parseDateBoundary(filters.createdFrom, false);
  const createdTo = parseDateBoundary(filters.createdTo, true);
  if (createdFrom || createdTo) {
    and.push({ createdAt: { ...(createdFrom ? { gte: createdFrom } : {}), ...(createdTo ? { lte: createdTo } : {}) } });
  }
  const closedFrom = parseDateBoundary(filters.closedFrom, false);
  const closedTo = parseDateBoundary(filters.closedTo, true);
  if (closedFrom || closedTo) {
    and.push({ closedAt: { ...(closedFrom ? { gte: closedFrom } : {}), ...(closedTo ? { lte: closedTo } : {}) } });
  }

  if (filters.scope === 'open' || filters.scope === 'closed') {
    const statuses = await getStatusMap();
    const codes = [...statuses.values()]
      .filter((s) => (filters.scope === 'open' ? !s.isTerminal : s.isTerminal))
      .map((s) => s.code);
    and.push({ statusCode: { in: codes } });
  }

  if (filters.search?.trim()) {
    const q = filters.search.trim();
    and.push({
      OR: [
        { requestNo: containsInsensitive(q) },
        { subject: containsInsensitive(q) },
        { description: containsInsensitive(q) },
        { requester: { displayName: containsInsensitive(q) } },
      ],
    });
  }

  return { AND: and };
}

export async function listRequests(user: AuthUser, filters: RequestListFilters) {
  const where = await buildFilterWhere(user, filters);
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
  const sortBy = filters.sortBy ?? 'createdAt';
  const sortDir = filters.sortDir ?? 'desc';

  const [total, rows, statuses, priorities] = await Promise.all([
    prisma.request.count({ where }),
    prisma.request.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: { select: { id: true, code: true, name: true } },
        requester: { select: { id: true, displayName: true, department: true } },
      },
    }),
    getStatusMap(),
    getPriorityMap(),
  ]);

  const now = new Date();

  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map((r) => ({
      id: r.id,
      requestNo: r.requestNo,
      subject: r.subject,
      category: r.category,
      requester: r.requester,
      status: statuses.get(r.statusCode) ?? { code: r.statusCode, name: r.statusCode, tone: 'neutral' },
      priority: priorities.get(r.priority) ?? { code: r.priority, name: r.priority, tone: 'neutral' },
      currentStepName: r.currentStepName,
      currentAssigneeLabel: r.currentAssigneeLabel,
      dueDate: r.dueDate,
      slaDueAt: r.slaDueAt,
      slaStatus: r.slaStatus,
      slaRemainingText: describeRemaining(r.slaDueAt, now),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      submittedAt: r.submittedAt,
      closedAt: r.closedAt,
      rowVersion: r.rowVersion,
    })),
  };
}

// ---------------------------------------------------------------------------
// Gorev kutusu (Manager / HR)
// ---------------------------------------------------------------------------

/** Kullaniciya dusen, islem bekleyen talepler. */
export async function listMyTasks(user: AuthUser, options: { page?: number; pageSize?: number } = {}) {
  const or: Prisma.RequestWhereInput[] = [{ currentAssigneeId: user.id }];
  if (user.roles.length > 0) {
    or.push({ currentAssigneeRoleCode: { in: user.roles } });
  }
  if (user.groupIds.length > 0) {
    or.push({ currentAssigneeGroupId: { in: user.groupIds } });
  }

  const statuses = await getStatusMap();
  const openCodes = [...statuses.values()].filter((s) => !s.isTerminal).map((s) => s.code);

  const where: Prisma.RequestWhereInput = {
    AND: [
      { OR: or },
      { statusCode: { in: openCodes } },
      { instance: { status: INSTANCE_STATUS.RUNNING } },
    ],
  };

  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));

  const [total, rows, priorities] = await Promise.all([
    prisma.request.count({ where }),
    prisma.request.findMany({
      where,
      orderBy: [{ slaDueAt: 'asc' }, { createdAt: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: { select: { id: true, code: true, name: true } },
        requester: { select: { id: true, displayName: true, department: true } },
      },
    }),
    getPriorityMap(),
  ]);

  const now = new Date();

  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map((r) => ({
      id: r.id,
      requestNo: r.requestNo,
      subject: r.subject,
      category: r.category,
      requester: r.requester,
      status: statuses.get(r.statusCode) ?? { code: r.statusCode, name: r.statusCode, tone: 'neutral' },
      priority: priorities.get(r.priority) ?? { code: r.priority, name: r.priority, tone: 'neutral' },
      currentStepName: r.currentStepName,
      currentAssigneeLabel: r.currentAssigneeLabel,
      /** Havuz gorevi mi, kisisel gorev mi */
      isPoolTask: r.currentAssigneeId === null,
      slaDueAt: r.slaDueAt,
      slaStatus: r.slaStatus,
      slaRemainingText: describeRemaining(r.slaDueAt, now),
      submittedAt: r.submittedAt,
      rowVersion: r.rowVersion,
    })),
  };
}

// ---------------------------------------------------------------------------
// Detay
// ---------------------------------------------------------------------------

const TIMELINE_LABELS: Record<string, string> = {
  REQUEST_CREATED: 'Talep oluşturuldu',
  REQUEST_UPDATED: 'Talep güncellendi',
  REQUEST_SUBMITTED: 'Talep gönderildi',
  STEP_STARTED: 'Adım başladı',
  STEP_COMPLETED: 'Adım tamamlandı',
  STEP_SKIPPED: 'Adım atlandı',
  ASSIGNED: 'Sorumlu atandı',
  STATUS_CHANGED: 'Durum değişti',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  INFO_REQUESTED: 'Ek bilgi istendi',
  COMMENT_ADDED: 'Yorum eklendi',
  ATTACHMENT_ADDED: 'Dosya eklendi',
  ATTACHMENT_REMOVED: 'Dosya kaldırıldı',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal edildi',
  ADMIN_OVERRIDE: 'Sistem yöneticisi müdahalesi',
  SLA_WARNING: 'SLA uyarısı',
  SLA_BREACH: 'SLA aşıldı',
  ASSIGNEE_FALLBACK: 'Yedek sorumlu uygulandı',
};

export async function getRequestDetail(user: AuthUser, requestId: string) {
  const request = await findVisibleRequestOrThrow(user, requestId);
  const admin = isAdmin(user);

  const [statuses, priorities, progress, availableActions, formFields] = await Promise.all([
    getStatusMap(),
    getPriorityMap(),
    getProgress(requestId),
    getAvailableActions(requestId, {
      id: user.id,
      roles: user.roles,
      groupIds: user.groupIds,
    }),
    getCategoryFormFields(request.categoryId),
  ]);

  const [auditRows, actionLogs, attachments, comments, manager] = await Promise.all([
    prisma.auditEvent.findMany({
      where: {
        requestId,
        ...(admin ? {} : { visibility: AUDIT_VISIBILITY.USER }),
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: 500,
    }),
    prisma.workflowActionLog.findMany({
      where: {
        requestId,
        actionKind: {
          in: [
            ACTION_KIND.APPROVE,
            ACTION_KIND.REJECT,
            ACTION_KIND.COMPLETE,
            ACTION_KIND.REQUEST_INFO,
            ACTION_KIND.CANCEL,
          ],
        },
      },
      orderBy: { createdAt: 'asc' },
      include: { performedBy: { select: { id: true, displayName: true, title: true } } },
    }),
    prisma.attachment.findMany({
      where: { requestId, isDeleted: false },
      orderBy: { uploadedAt: 'asc' },
      include: { uploadedBy: { select: { id: true, displayName: true } } },
    }),
    prisma.comment.findMany({
      where: {
        requestId,
        isDeleted: false,
        // Dahili notlar talep sahibine gosterilmez.
        ...(request.requesterId === user.id && !admin ? { isInternal: false } : {}),
      },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, displayName: true, title: true } } },
    }),
    request.requester.managerId
      ? prisma.user.findUnique({
          where: { id: request.requester.managerId },
          select: { id: true, displayName: true, title: true },
        })
      : Promise.resolve(null),
  ]);

  const status = statuses.get(request.statusCode);
  const isTerminal = status?.isTerminal ?? false;
  const isOwner = request.requesterId === user.id;
  const canAct = availableActions.length > 0;

  // "Su anda kimde?" - kapali kayitlarda sorumlu yoktur.
  const whoHasIt = isTerminal
    ? null
    : (request.currentAssigneeLabel ?? progress.currentStep?.assigneeLabel ?? null);

  return {
    id: request.id,
    requestNo: request.requestNo,
    subject: request.subject,
    description: request.description,
    category: {
      id: request.category.id,
      code: request.category.code,
      name: request.category.name,
      requiresManagerApproval: request.category.requiresManagerApproval,
    },
    status: status ?? { code: request.statusCode, name: request.statusCode, tone: 'neutral', phase: 'OPEN', isTerminal: false },
    priority: priorities.get(request.priority) ?? { code: request.priority, name: request.priority, tone: 'neutral' },
    requester: {
      id: request.requester.id,
      displayName: request.requester.displayName,
      email: request.requester.email,
      department: request.requester.department,
      title: request.requester.title,
    },
    manager,
    dueDate: request.dueDate,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
    submittedAt: request.submittedAt,
    completedAt: request.completedAt,
    closedAt: request.closedAt,

    sla: {
      dueAt: request.slaDueAt,
      status: request.slaStatus,
      remainingText: describeRemaining(request.slaDueAt),
    },

    workflow: request.instance
      ? {
          instanceId: request.instance.id,
          definitionName: request.instance.definition.name,
          definitionCode: request.instance.definition.code,
          versionId: request.instance.versionId,
          versionNumber: request.instance.version.versionNumber,
          instanceStatus: request.instance.status,
          startedAt: request.instance.startedAt,
        }
      : null,

    // Kullanicinin uc sorusu
    currentStep: progress.currentStep,
    whoHasIt,
    nextExpectedStep: progress.nextExpectedStep,
    progress: progress.steps,

    timeline: auditRows.map((a) => ({
      id: a.id,
      eventType: a.eventType,
      label: TIMELINE_LABELS[a.eventType] ?? a.eventType,
      occurredAt: a.occurredAt,
      userDisplayName: a.userDisplayName,
      userRole: a.userRole,
      stepName: a.stepName,
      oldStatusName: statuses.get(a.oldStatusCode ?? '')?.name ?? null,
      newStatusName: statuses.get(a.newStatusCode ?? '')?.name ?? null,
      description: a.description,
      visibility: a.visibility,
    })),

    approvalHistory: actionLogs.map((l) => ({
      id: l.id,
      stepName: l.fromStepName,
      actionName: l.actionName,
      actionKind: l.actionKind,
      performedBy: l.performedBy,
      performedByRole: l.performedByRole,
      comment: l.comment,
      createdAt: l.createdAt,
    })),

    attachments: attachments.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      uploadedBy: a.uploadedBy,
      uploadedAt: a.uploadedAt,
    })),

    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      author: c.author,
      isInternal: c.isInternal,
      createdAt: c.createdAt,
    })),

    formFields,
    formData: tryParseJson<Record<string, unknown>>(request.formDataJson, {}),

    availableActions,
    rowVersion: request.rowVersion,

    permissions: {
      canEdit: isOwner && request.statusCode === STATUS.DRAFT,
      canSubmit: isOwner && request.statusCode === STATUS.DRAFT,
      canCancel: isOwner && !isTerminal,
      canComment: !isTerminal,
      canUpload: !isTerminal && (isOwner || canAct),
      canAct,
      canViewInternalNotes: !isOwner || admin,
      isOwner,
      isAdmin: admin,
    },
  };
}

/** Detay ekrani icin salt okunur ozet (bildirim tiklamasi vb.). */
export async function assertCanViewRequest(user: AuthUser, requestId: string): Promise<void> {
  await findVisibleRequestOrThrow(user, requestId);
}
