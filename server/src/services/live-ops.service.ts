/**
 * Admin Live Operations servisi (spec 03).
 *
 * Bu servis CALISAN kayitlara mudahale eder; surec TANIMINI degistirmez.
 * (Tanim degisiklikleri workflow-admin.service.ts icindedir ve buradan erisilemez.)
 *
 * Kurallar:
 *  - Yalnizca ADMIN rolu. Yetki route seviyesinde + burada bir kez daha.
 *  - Her mudahale ADMIN_OVERRIDE business action'idir; normal status update DEGIL.
 *  - Neden (reasonCode) zorunludur.
 *  - Uygulamadan once Impact Preview uretilir, sonra confirm ile uygulanir.
 *  - Serbest metin status YOK; yalnizca allowAdminOverride=true durumlar.
 *  - rowVersion kontrolu: kayit degismisse islem uygulanmaz.
 *  - Audit hem teknik (ADMIN) hem kullanici dostu (USER) olarak yazilir.
 */

import { Prisma } from '@prisma/client';
import { prisma, type Db } from '../db';
import type { AuthUser } from '../auth/auth-context';
import { isAdmin } from '../auth/auth-context';
import {
  ASSIGNEE_TYPE,
  AUDIT_EVENT,
  AUDIT_VISIBILITY,
  INSTANCE_STATUS,
  NOTIFICATION_EVENT,
  OVERRIDE_REASON_LABELS,
  OVERRIDE_REASONS,
  OVERRIDE_TYPE,
  OVERRIDE_TYPES,
  SKIP_REASON,
  SLA_STATUS,
  STEP_INSTANCE_STATUS,
  STEP_TYPE,
  type OverrideReason,
  type OverrideType,
} from '../domain/constants';
import {
  ConflictError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  StaleDataError,
  ValidationError,
} from '../domain/errors';
import { describeRemaining, evaluateSlaStatus } from '../domain/sla';
import { writeAudit } from './audit.service';
import { getPriorityMap, getStatusMap } from './catalog.service';
import { dispatchNotifications, type NotificationIntent } from './notification.service';
import { getSlaAtRiskThreshold, getSlaCalendarOptions } from './settings.service';
import {
  activateNextStep,
  buildConditionContext,
  closeInstance,
  loadVersionGraph,
  type ActivationResult,
  type EngineActor,
} from './workflow-engine';
import { tryParseJson } from '../lib/json';

function assertAdmin(user: AuthUser): void {
  if (!isAdmin(user)) {
    throw new ForbiddenError('Bu ekran yalnızca sistem yöneticileri tarafından kullanılabilir.');
  }
}

// ---------------------------------------------------------------------------
// Canli surecler listesi (spec 03 - §3)
// ---------------------------------------------------------------------------

export interface LiveOpsFilters {
  requestNo?: string;
  requesterId?: string;
  definitionId?: string;
  versionId?: string;
  categoryId?: string;
  statusCode?: string[];
  stepCode?: string;
  assigneeId?: string;
  slaStatus?: string[];
  instanceStatus?: string[];
  startedFrom?: string;
  startedTo?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listLiveInstances(user: AuthUser, filters: LiveOpsFilters) {
  assertAdmin(user);

  const and: Prisma.WorkflowInstanceWhereInput[] = [];

  if (filters.definitionId) and.push({ definitionId: filters.definitionId });
  if (filters.versionId) and.push({ versionId: filters.versionId });
  if (filters.instanceStatus?.length) {
    and.push({ status: { in: filters.instanceStatus } });
  } else {
    // Varsayilan: yalnizca calisan kayitlar
    and.push({ status: INSTANCE_STATUS.RUNNING });
  }

  const requestWhere: Prisma.RequestWhereInput = {};
  if (filters.requestNo) requestWhere.requestNo = { contains: filters.requestNo.trim() };
  if (filters.requesterId) requestWhere.requesterId = filters.requesterId;
  if (filters.categoryId) requestWhere.categoryId = filters.categoryId;
  if (filters.statusCode?.length) requestWhere.statusCode = { in: filters.statusCode };
  if (filters.slaStatus?.length) requestWhere.slaStatus = { in: filters.slaStatus };
  if (filters.assigneeId) requestWhere.currentAssigneeId = filters.assigneeId;
  if (filters.stepCode) requestWhere.currentStepCode = filters.stepCode;
  if (filters.search?.trim()) {
    const q = filters.search.trim();
    requestWhere.OR = [
      { requestNo: { contains: q } },
      { subject: { contains: q } },
      { requester: { displayName: { contains: q } } },
    ];
  }
  if (Object.keys(requestWhere).length > 0) and.push({ request: requestWhere });

  if (filters.startedFrom || filters.startedTo) {
    const gte = filters.startedFrom ? new Date(filters.startedFrom) : undefined;
    const lte = filters.startedTo ? new Date(filters.startedTo) : undefined;
    if (lte) lte.setHours(23, 59, 59, 999);
    and.push({
      startedAt: {
        ...(gte && !Number.isNaN(gte.getTime()) ? { gte } : {}),
        ...(lte && !Number.isNaN(lte.getTime()) ? { lte } : {}),
      },
    });
  }

  const where: Prisma.WorkflowInstanceWhereInput = and.length ? { AND: and } : {};
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 25));

  const [total, rows, statuses] = await Promise.all([
    prisma.workflowInstance.count({ where }),
    prisma.workflowInstance.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        request: {
          include: {
            category: { select: { id: true, code: true, name: true } },
            requester: { select: { id: true, displayName: true, department: true } },
          },
        },
        definition: { select: { id: true, code: true, name: true } },
        version: { select: { id: true, versionNumber: true, status: true } },
      },
    }),
    getStatusMap(),
  ]);

  // Son aksiyonlar
  const instanceIds = rows.map((r) => r.id);
  const lastActions = instanceIds.length
    ? await prisma.workflowActionLog.findMany({
        where: { instanceId: { in: instanceIds } },
        orderBy: { createdAt: 'desc' },
        include: { performedBy: { select: { displayName: true } } },
      })
    : [];
  const lastActionMap = new Map<string, (typeof lastActions)[number]>();
  for (const a of lastActions) {
    if (!lastActionMap.has(a.instanceId)) lastActionMap.set(a.instanceId, a);
  }

  const now = new Date();

  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map((r) => {
      const last = lastActionMap.get(r.id);
      return {
        instanceId: r.id,
        requestId: r.requestId,
        requestNo: r.request.requestNo,
        subject: r.request.subject,
        requester: r.request.requester,
        category: r.request.category,
        workflow: r.definition,
        workflowVersion: r.version.versionNumber,
        workflowVersionId: r.version.id,
        workflowVersionStatus: r.version.status,
        currentStepCode: r.request.currentStepCode,
        currentStepName: r.request.currentStepName,
        currentStatus:
          statuses.get(r.request.statusCode) ?? {
            code: r.request.statusCode,
            name: r.request.statusCode,
            tone: 'neutral',
          },
        currentAssigneeLabel: r.request.currentAssigneeLabel,
        currentAssigneeId: r.request.currentAssigneeId,
        isPoolTask: r.request.currentAssigneeId === null,
        instanceStatus: r.status,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        lastAction: last
          ? {
              actionName: last.actionName,
              at: last.createdAt,
              byName: last.performedBy.displayName,
            }
          : null,
        slaDueAt: r.request.slaDueAt,
        slaStatus: r.request.slaStatus,
        slaRemainingText: describeRemaining(r.request.slaDueAt, now),
        rowVersion: r.request.rowVersion,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Canli kayit detayi (spec 03 - §4)
// ---------------------------------------------------------------------------

export async function getLiveInstanceDetail(user: AuthUser, requestId: string) {
  assertAdmin(user);

  const request = await prisma.request.findUnique({
    where: { id: requestId },
    include: {
      category: true,
      requester: {
        select: {
          id: true,
          displayName: true,
          email: true,
          department: true,
          title: true,
          managerId: true,
          isActive: true,
        },
      },
      instance: {
        include: {
          definition: true,
          version: true,
          stepInstances: { orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }] },
        },
      },
      overrides: {
        orderBy: { createdAt: 'desc' },
        include: { adminUser: { select: { id: true, displayName: true } } },
      },
    },
  });

  if (!request) throw new NotFoundError('Talep bulunamadı.');
  if (!request.instance) {
    throw new InvalidTransitionError(
      'Bu talep henüz gönderilmemiş (taslak). Canlı süreç kaydı bulunmuyor.',
    );
  }

  const [statuses, priorities, auditRows, actionLogs, overrideStatuses] = await Promise.all([
    getStatusMap(),
    getPriorityMap(),
    prisma.auditEvent.findMany({
      where: { requestId },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.workflowActionLog.findMany({
      where: { requestId },
      orderBy: { createdAt: 'asc' },
      include: { performedBy: { select: { id: true, displayName: true, title: true } } },
    }),
    getStatusMap().then((m) => [...m.values()].filter((s) => s.allowAdminOverride)),
  ]);

  const stepInstances = request.instance.stepInstances;
  const current = stepInstances.find((si) => si.isCurrent) ?? null;
  const completed = stepInstances.filter(
    (si) => si.status === STEP_INSTANCE_STATUS.COMPLETED,
  );
  const previous = completed.length > 0 ? completed[completed.length - 1] : null;
  const nextExpected = current
    ? (stepInstances.find(
        (si) => si.sequence > current.sequence && si.status === STEP_INSTANCE_STATUS.PENDING,
      ) ?? null)
    : null;

  // Mudahale icin secilebilir hedef adimlar (mevcut adim disinda, START haric)
  const version = await loadVersionGraph(prisma, request.instance.versionId);
  const moveTargets = version.steps
    .filter((s) => s.type !== STEP_TYPE.START && s.id !== current?.stepId)
    .map((s) => ({
      stepId: s.id,
      code: s.code,
      name: s.name,
      type: s.type,
      sequence: s.sequence,
      statusCode: s.statusCode,
      assigneeType: s.assigneeType,
      isRevisit: stepInstances.some(
        (si) => si.stepId === s.id && si.status !== STEP_INSTANCE_STATUS.PENDING,
      ),
    }));

  return {
    request: {
      id: request.id,
      requestNo: request.requestNo,
      subject: request.subject,
      description: request.description,
      category: request.category,
      requester: request.requester,
      priority: priorities.get(request.priority) ?? null,
      status: statuses.get(request.statusCode) ?? null,
      createdAt: request.createdAt,
      submittedAt: request.submittedAt,
      closedAt: request.closedAt,
      formData: tryParseJson<Record<string, unknown>>(request.formDataJson, {}),
      rowVersion: request.rowVersion,
    },

    workflow: {
      instanceId: request.instance.id,
      definitionId: request.instance.definitionId,
      definitionName: request.instance.definition.name,
      definitionCode: request.instance.definition.code,
      versionId: request.instance.versionId,
      versionNumber: request.instance.version.versionNumber,
      versionStatus: request.instance.version.status,
      /** Aktif surum baska ise bu kayit eski surumde calisiyor demektir. */
      isRunningOnSupersededVersion:
        request.instance.definition.activeVersionId !== request.instance.versionId,
      instanceStatus: request.instance.status,
      startedAt: request.instance.startedAt,
      completedAt: request.instance.completedAt,
      slaCalendarMode: request.instance.version.slaCalendarMode,
    },

    currentStep: current
      ? {
          stepInstanceId: current.id,
          stepId: current.stepId,
          code: current.stepCode,
          name: current.stepName,
          type: current.stepType,
          sequence: current.sequence,
          status: current.status,
          statusCode: current.statusCode,
          assigneeId: current.assigneeId,
          assigneeLabel: current.assigneeLabel,
          assigneeType: current.assigneeType,
          assigneeRoleCode: current.assigneeRoleCode,
          assigneeGroupId: current.assigneeGroupId,
          startedAt: current.startedAt,
          dueAt: current.dueAt,
          slaStatus: current.slaStatus,
          isAwaitingInfo: Boolean(current.pendingInfoRequestedAt),
        }
      : null,

    previousStep: previous
      ? { name: previous.stepName, completedAt: previous.completedAt, resultActionCode: previous.resultActionCode }
      : null,
    nextExpectedStep: nextExpected
      ? { stepId: nextExpected.stepId, name: nextExpected.stepName, assigneeLabel: nextExpected.assigneeLabel }
      : null,

    operations: {
      slaDueAt: request.slaDueAt,
      slaStatus: request.slaStatus,
      slaRemainingText: describeRemaining(request.slaDueAt),
      stepStartedAt: current?.startedAt ?? null,
      lastAction:
        actionLogs.length > 0
          ? {
              actionName: actionLogs[actionLogs.length - 1].actionName,
              at: actionLogs[actionLogs.length - 1].createdAt,
              byName: actionLogs[actionLogs.length - 1].performedBy.displayName,
            }
          : null,
    },

    timeline: stepInstances.map((si) => ({
      stepInstanceId: si.id,
      stepId: si.stepId,
      code: si.stepCode,
      name: si.stepName,
      type: si.stepType,
      sequence: si.sequence,
      status: si.status,
      assigneeLabel: si.assigneeLabel,
      startedAt: si.startedAt,
      completedAt: si.completedAt,
      dueAt: si.dueAt,
      slaStatus: si.slaStatus,
      resultActionCode: si.resultActionCode,
      resultComment: si.resultComment,
      skipReason: si.skipReason,
      isCurrent: si.isCurrent,
    })),

    approvalHistory: actionLogs.map((l) => ({
      id: l.id,
      stepName: l.fromStepName,
      actionName: l.actionName,
      actionKind: l.actionKind,
      performedBy: l.performedBy,
      performedByRole: l.performedByRole,
      comment: l.comment,
      fromStatusCode: l.fromStatusCode,
      toStatusCode: l.toStatusCode,
      createdAt: l.createdAt,
    })),

    auditTrail: auditRows.map((a) => ({
      id: a.id,
      eventType: a.eventType,
      occurredAt: a.occurredAt,
      userDisplayName: a.userDisplayName,
      userRole: a.userRole,
      stepName: a.stepName,
      oldStatusCode: a.oldStatusCode,
      newStatusCode: a.newStatusCode,
      fieldName: a.fieldName,
      oldValue: a.oldValue,
      newValue: a.newValue,
      description: a.description,
      visibility: a.visibility,
      workflowVersionNumber: a.workflowVersionNumber,
      metadata: tryParseJson<Record<string, unknown>>(a.metadataJson, {}),
    })),

    overrideHistory: request.overrides.map((o) => ({
      id: o.id,
      overrideType: o.overrideType,
      reasonCode: o.reasonCode,
      reasonLabel: OVERRIDE_REASON_LABELS[o.reasonCode as OverrideReason] ?? o.reasonCode,
      reasonNote: o.reasonNote,
      fromStepName: o.fromStepName,
      toStepName: o.toStepName,
      fromStatusCode: o.fromStatusCode,
      toStatusCode: o.toStatusCode,
      adminUser: o.adminUser,
      createdAt: o.createdAt,
      workflowVersionNumber: o.workflowVersionNumber,
    })),

    /** Override formunda kullanilacak secenekler */
    overrideOptions: {
      types: OVERRIDE_TYPES,
      reasons: OVERRIDE_REASONS.map((code) => ({
        code,
        label: OVERRIDE_REASON_LABELS[code],
      })),
      allowedStatuses: overrideStatuses.map((s) => ({
        code: s.code,
        name: s.name,
        tone: s.tone,
      })),
      moveTargets,
      canOverride: request.instance.status === INSTANCE_STATUS.RUNNING,
    },
  };
}

// ---------------------------------------------------------------------------
// Override girdisi ve dogrulama
// ---------------------------------------------------------------------------

export interface OverrideInput {
  requestId: string;
  overrideType: OverrideType;
  reasonCode: OverrideReason;
  reasonNote?: string | null;
  /** REASSIGN icin */
  targetAssigneeId?: string | null;
  /** MOVE_TO_STEP icin */
  targetStepId?: string | null;
  /** CHANGE_STATUS icin */
  targetStatusCode?: string | null;
  expectedRowVersion: number;
}

interface OverrideContext {
  request: Prisma.RequestGetPayload<{
    include: {
      category: true;
      requester: true;
      instance: { include: { definition: true; version: true } };
    };
  }>;
  currentStepInstance: Prisma.StepInstanceGetPayload<{}> | null;
  version: Awaited<ReturnType<typeof loadVersionGraph>>;
}

async function loadOverrideContext(input: OverrideInput): Promise<OverrideContext> {
  const request = await prisma.request.findUnique({
    where: { id: input.requestId },
    include: {
      category: true,
      requester: true,
      instance: { include: { definition: true, version: true } },
    },
  });
  if (!request) throw new NotFoundError('Talep bulunamadı.');
  if (!request.instance) {
    throw new InvalidTransitionError(
      'Taslak talep üzerinde müdahale yapılamaz; iş akışı henüz başlamamış.',
    );
  }
  if (request.instance.status !== INSTANCE_STATUS.RUNNING) {
    throw new InvalidTransitionError(
      'Kapanmış bir kayıt üzerinde müdahale yapılamaz.',
    );
  }

  const currentStepInstance = await prisma.stepInstance.findFirst({
    where: { instanceId: request.instance.id, isCurrent: true },
  });

  // ONEMLI: kaydin kendi versiyonu okunur, aktif versiyon degil.
  const version = await loadVersionGraph(prisma, request.instance.versionId);

  return { request, currentStepInstance, version };
}

async function validateOverrideInput(input: OverrideInput, ctx: OverrideContext) {
  if (!OVERRIDE_TYPES.includes(input.overrideType)) {
    throw new ValidationError('Geçersiz müdahale tipi.');
  }
  if (!OVERRIDE_REASONS.includes(input.reasonCode)) {
    throw new ValidationError('Müdahale nedeni seçilmelidir.');
  }
  const note = input.reasonNote?.trim() || null;
  if (input.reasonCode === 'OTHER' && !note) {
    throw new ValidationError('"Diğer" nedeni seçildiğinde açıklama zorunludur.');
  }
  if (note && note.length > 2000) {
    throw new ValidationError('Açıklama en fazla 2000 karakter olabilir.');
  }

  switch (input.overrideType) {
    case OVERRIDE_TYPE.REASSIGN: {
      if (!ctx.currentStepInstance) {
        throw new InvalidTransitionError('Aktif adım bulunamadığı için sorumlu değiştirilemez.');
      }
      if (!input.targetAssigneeId) {
        throw new ValidationError('Yeni sorumlu seçilmelidir.');
      }
      const target = await prisma.user.findFirst({
        where: { id: input.targetAssigneeId, isActive: true },
        select: { id: true },
      });
      if (!target) {
        throw new ValidationError('Seçilen kullanıcı bulunamadı veya pasif durumda.');
      }
      if (ctx.currentStepInstance.assigneeId === input.targetAssigneeId) {
        throw new ValidationError('Seçilen kullanıcı zaten bu adımın sorumlusu.');
      }
      break;
    }

    case OVERRIDE_TYPE.SKIP_STEP: {
      if (!ctx.currentStepInstance) {
        throw new InvalidTransitionError('Atlanacak aktif bir adım yok.');
      }
      if (ctx.currentStepInstance.stepType === STEP_TYPE.END) {
        throw new InvalidTransitionError('Bitiş adımı atlanamaz.');
      }
      break;
    }

    case OVERRIDE_TYPE.MOVE_TO_STEP: {
      if (!input.targetStepId) {
        throw new ValidationError('Hedef adım seçilmelidir.');
      }
      const target = ctx.version.steps.find((s) => s.id === input.targetStepId);
      if (!target) {
        throw new ValidationError(
          'Hedef adım bu kaydın iş akışı sürümünde bulunmuyor.',
        );
      }
      if (target.type === STEP_TYPE.START) {
        throw new ValidationError('Kayıt başlangıç adımına geri taşınamaz.');
      }
      if (!target.isActive) {
        throw new ValidationError('Pasif bir adıma taşıma yapılamaz.');
      }
      if (ctx.currentStepInstance?.stepId === input.targetStepId) {
        throw new ValidationError('Kayıt zaten bu adımda.');
      }
      break;
    }

    case OVERRIDE_TYPE.CHANGE_STATUS: {
      if (!input.targetStatusCode) {
        throw new ValidationError('Yeni durum seçilmelidir.');
      }
      const statuses = await getStatusMap();
      const status = statuses.get(input.targetStatusCode);
      if (!status) {
        // Serbest metin status kabul edilmez.
        throw new ValidationError('Tanımsız durum kodu.');
      }
      if (!status.allowAdminOverride) {
        throw new ValidationError(
          `"${status.name}" durumu yönetici müdahalesi ile seçilemez.`,
        );
      }
      if (ctx.request.statusCode === input.targetStatusCode) {
        throw new ValidationError('Kayıt zaten bu durumda.');
      }
      break;
    }
  }

  return { reasonNote: note };
}

// ---------------------------------------------------------------------------
// Impact Preview (spec 03 - §7)
// ---------------------------------------------------------------------------

export interface ImpactPreview {
  requestId: string;
  requestNo: string;
  requesterName: string;
  categoryName: string;
  workflowName: string;
  workflowVersionNumber: number;

  operationLabel: string;
  reasonLabel: string;
  reasonNote: string | null;

  currentStepName: string | null;
  currentStatusName: string | null;
  currentAssigneeLabel: string | null;

  newStepName: string | null;
  newStatusName: string | null;
  newAssigneeLabel: string | null;

  taskToClose: string | null;
  taskToCreate: string | null;

  notificationImpact: string[];
  slaImpact: string;

  warnings: string[];
  /** Uygulama sirasinda bu deger gonderilir; degismisse islem reddedilir. */
  rowVersion: number;
  requiresConfirmation: true;
}

const OPERATION_LABELS: Record<OverrideType, string> = {
  REASSIGN: 'Sorumlu Değiştir',
  SKIP_STEP: 'Adımı Atla',
  MOVE_TO_STEP: 'Hedef Adıma Taşı',
  CHANGE_STATUS: 'Statü Değiştir',
};

export async function previewOverride(
  user: AuthUser,
  input: OverrideInput,
): Promise<ImpactPreview> {
  assertAdmin(user);
  const ctx = await loadOverrideContext(input);
  const { reasonNote } = await validateOverrideInput(input, ctx);

  const statuses = await getStatusMap();
  const request = ctx.request;
  const current = ctx.currentStepInstance;
  const warnings: string[] = [];
  const notificationImpact: string[] = [];

  if (request.rowVersion !== input.expectedRowVersion) {
    warnings.push(
      'Bu kayıt siz görüntülerken güncellenmiş. Onaylamadan önce sayfayı yenilemeniz gerekir.',
    );
  }
  if (request.instance!.definition.activeVersionId !== request.instance!.versionId) {
    warnings.push(
      `Bu kayıt v${request.instance!.version.versionNumber} sürümünde çalışıyor; iş akışının güncel sürümü farklı. Müdahale kaydın kendi sürümü üzerinden uygulanacak.`,
    );
  }

  let newStepName: string | null = current?.stepName ?? null;
  let newStatusCode: string | null = request.statusCode;
  let newAssigneeLabel: string | null = request.currentAssigneeLabel;
  let taskToClose: string | null = null;
  let taskToCreate: string | null = null;
  let slaImpact = 'SLA değişmeyecek.';

  switch (input.overrideType) {
    case OVERRIDE_TYPE.REASSIGN: {
      const target = await prisma.user.findUniqueOrThrow({
        where: { id: input.targetAssigneeId! },
        select: { displayName: true, title: true, department: true },
      });
      newAssigneeLabel = target.displayName;
      taskToClose = null;
      taskToCreate = `${current!.stepName} → ${target.displayName}`;
      slaImpact =
        'Aynı adımda kalındığı için mevcut adım SLA süresi kesintisiz devam edecek.';
      notificationImpact.push(`${target.displayName} kişisine görev bildirimi gönderilecek.`);
      if (current?.pendingInfoRequestedAt) {
        warnings.push(
          'Bu adımda talep sahibinden ek bilgi bekleniyor. Sorumlu değişikliği ek bilgi beklemesini sonlandırmaz.',
        );
      }
      break;
    }

    case OVERRIDE_TYPE.SKIP_STEP: {
      const nextInstance = await prisma.stepInstance.findFirst({
        where: {
          instanceId: request.instance!.id,
          sequence: { gt: current!.sequence },
          status: STEP_INSTANCE_STATUS.PENDING,
        },
        orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
      });

      taskToClose = `${current!.stepName} (${current!.assigneeLabel ?? '-'})`;

      if (!nextInstance) {
        newStepName = null;
        newStatusCode = ctx.version.steps.find((s) => s.type === STEP_TYPE.END)?.statusCode ?? 'COMPLETED';
        newAssigneeLabel = null;
        taskToCreate = null;
        slaImpact = 'Kayıt kapanacağı için SLA takibi sona erecek.';
        warnings.push(
          'Atlanacak adımdan sonra bekleyen başka adım yok; bu işlem talebi kapatacak.',
        );
        notificationImpact.push('Talep sahibine kapanış bildirimi gönderilecek.');
      } else {
        const stepDef = ctx.version.steps.find((s) => s.id === nextInstance.stepId);
        newStepName = nextInstance.stepName;
        newStatusCode = stepDef?.statusCode ?? request.statusCode;
        newAssigneeLabel = nextInstance.assigneeLabel;
        taskToCreate = `${nextInstance.stepName} (${nextInstance.assigneeLabel ?? '-'})`;
        slaImpact = stepDef?.slaEnabled
          ? `Yeni adımın SLA süresi (${stepDef.slaHours} saat) müdahale anından itibaren başlatılacak.`
          : 'Yeni adımda SLA tanımlı olmadığı için SLA takibi durdurulacak.';
        notificationImpact.push(
          `Yeni adım sorumlusuna (${nextInstance.assigneeLabel ?? 'ilgili rol'}) görev bildirimi gönderilecek.`,
        );
      }
      break;
    }

    case OVERRIDE_TYPE.MOVE_TO_STEP: {
      const target = ctx.version.steps.find((s) => s.id === input.targetStepId)!;
      taskToClose = current ? `${current.stepName} (${current.assigneeLabel ?? '-'})` : null;

      const isEndWithoutActions =
        target.type === STEP_TYPE.END && target.actions.filter((a) => a.isActive).length === 0;

      if (isEndWithoutActions) {
        newStepName = target.name;
        newStatusCode = target.statusCode;
        newAssigneeLabel = null;
        taskToCreate = null;
        slaImpact = 'Kayıt kapanacağı için SLA takibi sona erecek.';
        warnings.push('Hedef adım bir bitiş adımı; bu işlem talebi kapatacak.');
      } else {
        newStepName = target.name;
        newStatusCode = target.statusCode;
        newAssigneeLabel = describeTargetAssignee(target);
        taskToCreate = `${target.name} (${newAssigneeLabel})`;
        slaImpact = target.slaEnabled
          ? `Hedef adımın SLA süresi (${target.slaHours} saat) müdahale anından itibaren başlatılacak.`
          : 'Hedef adımda SLA tanımlı olmadığı için SLA takibi durdurulacak.';
        notificationImpact.push(
          `Hedef adım sorumlusuna (${newAssigneeLabel}) görev bildirimi gönderilecek.`,
        );
      }

      if (current && target.sequence < current.sequence) {
        warnings.push(
          `Kayıt geriye taşınıyor (${current.stepName} → ${target.name}). Geçmiş adım kayıtları silinmeyecek; hedef adım için yeni bir görev kaydı oluşturulacak.`,
        );
      }
      break;
    }

    case OVERRIDE_TYPE.CHANGE_STATUS: {
      const status = statuses.get(input.targetStatusCode!)!;
      newStatusCode = status.code;
      newStepName = current?.stepName ?? null;
      newAssigneeLabel = request.currentAssigneeLabel;
      taskToClose = null;
      taskToCreate = null;

      if (status.isTerminal) {
        newStepName = null;
        newAssigneeLabel = null;
        taskToClose = current ? `${current.stepName} (${current.assigneeLabel ?? '-'})` : null;
        slaImpact = 'Kayıt kapanacağı için SLA takibi sona erecek.';
        warnings.push(
          `"${status.name}" kapanış durumudur; bu işlem talebi kapatacak ve bekleyen adımlar iptal edilecek.`,
        );
        notificationImpact.push('Talep sahibine durum bildirimi gönderilecek.');
      } else {
        slaImpact = 'Adım değişmediği için mevcut adım SLA süresi kesintisiz devam edecek.';
        notificationImpact.push('Talep sahibine durum değişikliği bildirimi gönderilecek.');
        warnings.push(
          'Bu işlem yalnızca talebin görünen durumunu değiştirir; iş akışı adımı ve sorumlusu aynı kalır.',
        );
      }
      break;
    }
  }

  notificationImpact.push(
    'Müdahale, talep sahibinin gördüğü işlem geçmişinde anlaşılır bir kayıt olarak görünecek.',
  );

  return {
    requestId: request.id,
    requestNo: request.requestNo,
    requesterName: request.requester.displayName,
    categoryName: request.category.name,
    workflowName: request.instance!.definition.name,
    workflowVersionNumber: request.instance!.version.versionNumber,

    operationLabel: OPERATION_LABELS[input.overrideType],
    reasonLabel: OVERRIDE_REASON_LABELS[input.reasonCode],
    reasonNote,

    currentStepName: current?.stepName ?? null,
    currentStatusName: statuses.get(request.statusCode)?.name ?? request.statusCode,
    currentAssigneeLabel: request.currentAssigneeLabel,

    newStepName,
    newStatusName: newStatusCode ? (statuses.get(newStatusCode)?.name ?? newStatusCode) : null,
    newAssigneeLabel,

    taskToClose,
    taskToCreate,

    notificationImpact,
    slaImpact,
    warnings,
    rowVersion: request.rowVersion,
    requiresConfirmation: true,
  };
}

function describeTargetAssignee(step: {
  assigneeType: string;
  assigneeRoleCode: string | null;
}): string {
  switch (step.assigneeType) {
    case ASSIGNEE_TYPE.REQUESTER:
      return 'Talep Eden';
    case ASSIGNEE_TYPE.REQUESTER_MANAGER:
      return 'Talep Edenin Yöneticisi';
    case ASSIGNEE_TYPE.HR_USER:
      return 'İnsan Kaynakları';
    case ASSIGNEE_TYPE.HR_PROCESS_OWNER:
      return 'İK Süreç Sahibi';
    case ASSIGNEE_TYPE.ROLE:
      return step.assigneeRoleCode ?? 'Rol';
    case ASSIGNEE_TYPE.GROUP:
      return 'Ekip';
    case ASSIGNEE_TYPE.USER:
      return 'Belirli Kullanıcı';
    default:
      return 'Tanımsız';
  }
}

// ---------------------------------------------------------------------------
// Override uygulama (spec 03 - §5, §8)
// ---------------------------------------------------------------------------

export interface ApplyOverrideResult {
  requestId: string;
  overrideId: string;
  statusCode: string;
  currentStepName: string | null;
  currentAssigneeLabel: string | null;
  rowVersion: number;
}

export async function applyOverride(
  user: AuthUser,
  input: OverrideInput,
): Promise<ApplyOverrideResult> {
  assertAdmin(user);

  const ctx = await loadOverrideContext(input);
  const { reasonNote } = await validateOverrideInput(input, ctx);

  const statuses = await getStatusMap();
  const slaOptions = await getSlaCalendarOptions(ctx.request.instance!.version.slaCalendarMode);
  const atRiskThreshold = await getSlaAtRiskThreshold();

  const actor: EngineActor = {
    id: user.id,
    displayName: user.displayName,
    roles: user.roles,
    groupIds: user.groupIds,
    primaryRole: 'ADMIN',
  };

  const notifications: NotificationIntent[] = [];
  const now = new Date();

  const result = await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const request = ctx.request;
    const instance = request.instance!;

    // --- Concurrency: kayit degismisse islem uygulanmaz (spec 03 - §12) ---
    const cas = await tx.request.updateMany({
      where: { id: request.id, rowVersion: input.expectedRowVersion },
      data: { rowVersion: { increment: 1 } },
    });
    if (cas.count === 0) {
      throw new StaleDataError(
        'Kayıt siz görüntülerken değişti. Müdahale uygulanmadı; güncel veriyi yükleyip tekrar deneyin.',
      );
    }
    const newRowVersion = input.expectedRowVersion + 1;

    // Aktif adimi transaction icinde tekrar oku (yaris korumasi)
    const current = await tx.stepInstance.findFirst({
      where: { instanceId: instance.id, isCurrent: true },
    });

    const beforeStepId = current?.stepId ?? null;
    const beforeStepName = current?.stepName ?? null;
    const beforeStatus = request.statusCode;
    const beforeAssigneeId = request.currentAssigneeId;
    const beforeAssigneeLabel = request.currentAssigneeLabel;

    let afterStepId: string | null = beforeStepId;
    let afterStepName: string | null = beforeStepName;
    let afterStatus = beforeStatus;
    let afterAssigneeId: string | null = beforeAssigneeId;
    let afterAssigneeLabel: string | null = beforeAssigneeLabel;
    let userFacingDescription = '';

    const assigneeCtx = {
      requesterId: request.requesterId,
      requesterManagerId: request.requesterManagerId,
      categoryOwnerRoleCode: request.category.ownerRoleCode,
      categoryOwnerGroupId: request.category.ownerGroupId,
    };

    switch (input.overrideType) {
      // ----------------------------------------------------------------
      case OVERRIDE_TYPE.REASSIGN: {
        if (!current) throw new ConflictError('Aktif adım bulunamadı.');
        const target = await tx.user.findFirstOrThrow({
          where: { id: input.targetAssigneeId!, isActive: true },
          select: { id: true, displayName: true },
        });

        // Ayni adimda kalinir; SLA (dueAt) DEGISMEZ (spec 03 - §11).
        await tx.stepInstance.update({
          where: { id: current.id },
          data: {
            assigneeId: target.id,
            assigneeType: ASSIGNEE_TYPE.USER,
            assigneeLabel: target.displayName,
            assigneeRoleCode: null,
            assigneeGroupId: null,
          },
        });

        afterAssigneeId = target.id;
        afterAssigneeLabel = target.displayName;
        userFacingDescription = `Sürecin bu adımdaki sorumlusu sistem yöneticisi tarafından ${target.displayName} olarak güncellendi.`;

        notifications.push(
          buildIntent(request, instance, NOTIFICATION_EVENT.ADMIN_OVERRIDE, {
            assigneeId: target.id,
            stepName: current.stepName,
            actorName: user.displayName,
            note: reasonNote,
          }),
        );
        break;
      }

      // ----------------------------------------------------------------
      case OVERRIDE_TYPE.SKIP_STEP:
      case OVERRIDE_TYPE.MOVE_TO_STEP: {
        // Mevcut adimi kapat (atlandi olarak isaretlenir, gecmis korunur).
        if (current) {
          await tx.stepInstance.update({
            where: { id: current.id },
            data: {
              status: STEP_INSTANCE_STATUS.SKIPPED,
              isCurrent: false,
              completedAt: now,
              completedById: user.id,
              skipReason: SKIP_REASON.ADMIN_OVERRIDE,
              resultComment: reasonNote,
              slaStatus: current.dueAt
                ? evaluateSlaStatus({
                    startedAt: current.startedAt,
                    dueAt: current.dueAt,
                    closedAt: now,
                  })
                : SLA_STATUS.NA,
            },
          });
        }

        const activation: ActivationResult = await activateNextStep({
          db: tx,
          instanceId: instance.id,
          version: ctx.version,
          afterSequence: current?.sequence ?? -1,
          targetStepId:
            input.overrideType === OVERRIDE_TYPE.MOVE_TO_STEP ? input.targetStepId : null,
          allowRevisit: input.overrideType === OVERRIDE_TYPE.MOVE_TO_STEP,
          assigneeCtx,
          actor,
          slaOptions,
          atRiskThreshold,
          request: {
            id: request.id,
            requestNo: request.requestNo,
            subject: request.subject,
            categoryName: request.category.name,
            requesterId: request.requesterId,
            requesterManagerId: request.requesterManagerId,
          },
          notifications,
        });

        if (activation.activated) {
          afterStepId = activation.step!.id;
          afterStepName = activation.step!.name;
          afterStatus = activation.statusCode ?? afterStatus;
          afterAssigneeId = activation.assignee?.assigneeId ?? null;
          afterAssigneeLabel = activation.assignee?.assigneeLabel ?? null;
          userFacingDescription =
            input.overrideType === OVERRIDE_TYPE.SKIP_STEP
              ? `Süreç sistem yöneticisi tarafından "${afterStepName}" adımına yönlendirildi (önceki adım atlandı).`
              : `Süreç sistem yöneticisi tarafından "${afterStepName}" adımına taşındı.`;
        } else {
          // Ilerlenecek adim yok -> akis kapanir.
          const endStep = ctx.version.steps.find((s) => s.type === STEP_TYPE.END);
          afterStepId = null;
          afterStepName = null;
          afterStatus = endStep?.statusCode ?? 'COMPLETED';
          afterAssigneeId = null;
          afterAssigneeLabel = null;
          await closeInstance({
            db: tx,
            instanceId: instance.id,
            requestId: request.id,
            instanceStatus: INSTANCE_STATUS.COMPLETED,
            now,
          });
          userFacingDescription =
            'Süreç sistem yöneticisi tarafından sonlandırıldı ve talep kapatıldı.';
        }
        break;
      }

      // ----------------------------------------------------------------
      case OVERRIDE_TYPE.CHANGE_STATUS: {
        const status = statuses.get(input.targetStatusCode!)!;
        afterStatus = status.code;

        if (status.isTerminal) {
          if (current) {
            await tx.stepInstance.update({
              where: { id: current.id },
              data: {
                status: STEP_INSTANCE_STATUS.CANCELLED,
                isCurrent: false,
                completedAt: now,
                completedById: user.id,
                skipReason: SKIP_REASON.ADMIN_OVERRIDE,
                resultComment: reasonNote,
              },
            });
          }
          await closeInstance({
            db: tx,
            instanceId: instance.id,
            requestId: request.id,
            instanceStatus:
              status.code === 'REJECTED'
                ? INSTANCE_STATUS.REJECTED
                : status.code === 'CANCELLED'
                  ? INSTANCE_STATUS.CANCELLED
                  : INSTANCE_STATUS.COMPLETED,
            now,
          });
          afterStepId = null;
          afterStepName = null;
          afterAssigneeId = null;
          afterAssigneeLabel = null;
        } else if (current) {
          // Adim ayni kalir, yalnizca gorunen durum degisir.
          await tx.stepInstance.update({
            where: { id: current.id },
            data: { statusCode: status.code },
          });
        }

        userFacingDescription = `Talebin durumu sistem yöneticisi tarafından "${status.name}" olarak güncellendi.`;

        notifications.push(
          buildIntent(request, instance, NOTIFICATION_EVENT.ADMIN_OVERRIDE, {
            assigneeId: afterAssigneeId,
            stepName: afterStepName,
            actorName: user.displayName,
            note: reasonNote,
          }),
        );
        break;
      }
    }

    // --- Talebi guncelle ---
    const closing = afterStepId === null && afterStepName === null;
    const newStatusInfo = statuses.get(afterStatus);

    await tx.request.update({
      where: { id: request.id },
      data: {
        statusCode: afterStatus,
        currentStepInstanceId: closing ? null : undefined,
        currentStepCode: closing
          ? null
          : (ctx.version.steps.find((s) => s.id === afterStepId)?.code ?? undefined),
        currentStepName: closing ? null : (afterStepName ?? undefined),
        currentStepSequence: closing
          ? null
          : (ctx.version.steps.find((s) => s.id === afterStepId)?.sequence ?? undefined),
        currentAssigneeId: closing ? null : afterAssigneeId,
        currentAssigneeLabel: closing ? null : afterAssigneeLabel,
        currentAssigneeRoleCode: closing
          ? null
          : ((await tx.stepInstance.findFirst({
              where: { instanceId: instance.id, isCurrent: true },
              select: { assigneeRoleCode: true },
            }))?.assigneeRoleCode ?? null),
        currentAssigneeGroupId: closing
          ? null
          : ((await tx.stepInstance.findFirst({
              where: { instanceId: instance.id, isCurrent: true },
              select: { assigneeGroupId: true },
            }))?.assigneeGroupId ?? null),
        slaDueAt: closing
          ? null
          : ((await tx.stepInstance.findFirst({
              where: { instanceId: instance.id, isCurrent: true },
              select: { dueAt: true },
            }))?.dueAt ?? null),
        slaStatus: closing
          ? evaluateSlaStatus({
              startedAt: request.submittedAt,
              dueAt: request.slaDueAt,
              closedAt: now,
            })
          : undefined,
        ...(closing ? { closedAt: now } : {}),
        ...(closing && newStatusInfo?.code === 'COMPLETED' ? { completedAt: now } : {}),
      },
    });

    // --- AdminOverride kaydi (spec 03 - §8) ---
    const override = await tx.adminOverride.create({
      data: {
        requestId: request.id,
        instanceId: instance.id,
        overrideType: input.overrideType,
        reasonCode: input.reasonCode,
        reasonNote,
        fromStepId: beforeStepId,
        fromStepName: beforeStepName,
        toStepId: afterStepId,
        toStepName: afterStepName,
        fromStatusCode: beforeStatus,
        toStatusCode: afterStatus,
        fromAssigneeId: beforeAssigneeId,
        toAssigneeId: afterAssigneeId,
        workflowVersionId: instance.versionId,
        workflowVersionNumber: instance.version.versionNumber,
        adminUserId: user.id,
        impactJson: JSON.stringify({
          operationLabel: OPERATION_LABELS[input.overrideType],
          beforeAssigneeLabel,
          afterAssigneeLabel,
          targetStepId: input.targetStepId ?? null,
          targetStatusCode: input.targetStatusCode ?? null,
          targetAssigneeId: input.targetAssigneeId ?? null,
        }),
      },
    });

    // --- Audit: teknik detay (yalnizca admin gorur) ---
    await writeAudit(tx, {
      requestId: request.id,
      instanceId: instance.id,
      eventType: AUDIT_EVENT.ADMIN_OVERRIDE,
      actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
      stepInstanceId: current?.id ?? null,
      stepName: beforeStepName,
      workflowVersionId: instance.versionId,
      workflowVersionNumber: instance.version.versionNumber,
      oldStatusCode: beforeStatus,
      newStatusCode: afterStatus,
      fieldName: input.overrideType,
      oldValue: JSON.stringify({
        step: beforeStepName,
        status: beforeStatus,
        assigneeId: beforeAssigneeId,
        assigneeLabel: beforeAssigneeLabel,
      }),
      newValue: JSON.stringify({
        step: afterStepName,
        status: afterStatus,
        assigneeId: afterAssigneeId,
        assigneeLabel: afterAssigneeLabel,
      }),
      description: `${OPERATION_LABELS[input.overrideType]} | Neden: ${
        OVERRIDE_REASON_LABELS[input.reasonCode]
      }${reasonNote ? ` | Açıklama: ${reasonNote}` : ''}`,
      visibility: AUDIT_VISIBILITY.ADMIN,
      metadata: { overrideId: override.id, overrideType: input.overrideType },
    });

    // --- Audit: kullanici dostu timeline kaydi (spec 03 - §9) ---
    await writeAudit(tx, {
      requestId: request.id,
      instanceId: instance.id,
      eventType: AUDIT_EVENT.ADMIN_OVERRIDE,
      actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
      stepName: afterStepName ?? beforeStepName,
      workflowVersionId: instance.versionId,
      workflowVersionNumber: instance.version.versionNumber,
      oldStatusCode: beforeStatus,
      newStatusCode: afterStatus,
      description: userFacingDescription,
      visibility: AUDIT_VISIBILITY.USER,
      metadata: { overrideId: override.id },
    });

    return {
      requestId: request.id,
      overrideId: override.id,
      statusCode: afterStatus,
      currentStepName: closing ? null : afterStepName,
      currentAssigneeLabel: closing ? null : afterAssigneeLabel,
      rowVersion: newRowVersion,
    };
  });

  // Bildirim: transaction disinda, hata is akisini bozmaz (spec 03 - §10)
  await dispatchNotifications(notifications);

  return result;
}

function buildIntent(
  request: OverrideContext['request'],
  instance: NonNullable<OverrideContext['request']['instance']>,
  event: (typeof NOTIFICATION_EVENT)[keyof typeof NOTIFICATION_EVENT],
  extra: {
    assigneeId: string | null;
    stepName: string | null;
    actorName: string;
    note: string | null;
  },
): NotificationIntent {
  return {
    event,
    requestId: request.id,
    requestNo: request.requestNo,
    subject: request.subject,
    categoryName: request.category.name,
    versionId: instance.versionId,
    requesterId: request.requesterId,
    requesterManagerId: request.requesterManagerId,
    currentAssigneeId: extra.assigneeId,
    currentAssigneeRoleCode: null,
    currentAssigneeGroupId: null,
    stepName: extra.stepName,
    actorDisplayName: extra.actorName,
    note: extra.note,
  };
}

// ---------------------------------------------------------------------------
// Admin audit sorgusu
// ---------------------------------------------------------------------------

export async function listOverrides(
  user: AuthUser,
  filters: { requestId?: string; adminUserId?: string; overrideType?: string; page?: number; pageSize?: number },
) {
  assertAdmin(user);

  const where: Prisma.AdminOverrideWhereInput = {};
  if (filters.requestId) where.requestId = filters.requestId;
  if (filters.adminUserId) where.adminUserId = filters.adminUserId;
  if (filters.overrideType) where.overrideType = filters.overrideType;

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filters.pageSize ?? 50));

  const [total, rows] = await Promise.all([
    prisma.adminOverride.count({ where }),
    prisma.adminOverride.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        adminUser: { select: { id: true, displayName: true } },
        request: { select: { id: true, requestNo: true, subject: true } },
      },
    }),
  ]);

  return {
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map((o) => ({
      id: o.id,
      request: o.request,
      overrideType: o.overrideType,
      operationLabel: OPERATION_LABELS[o.overrideType as OverrideType] ?? o.overrideType,
      reasonCode: o.reasonCode,
      reasonLabel: OVERRIDE_REASON_LABELS[o.reasonCode as OverrideReason] ?? o.reasonCode,
      reasonNote: o.reasonNote,
      fromStepName: o.fromStepName,
      toStepName: o.toStepName,
      fromStatusCode: o.fromStatusCode,
      toStatusCode: o.toStatusCode,
      adminUser: o.adminUser,
      workflowVersionNumber: o.workflowVersionNumber,
      createdAt: o.createdAt,
    })),
  };
}
