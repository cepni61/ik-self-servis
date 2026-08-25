/**
 * Workflow motoru.
 *
 * Kapsam bilincli olarak sinirlidir: HR sureclerinin ihtiyaci olan sirali adim
 * yurutmesi. Paralel branch, retry, timeout engine, script node YOKTUR.
 *
 * Temel garantiler:
 *  1. VERSIYON SABITLIGI - instance her zaman kendi versionId'si uzerinden
 *     okunur; definition.activeVersionId ASLA runtime'da kullanilmaz. Boylece
 *     yeni versiyon yayinlandiginda acik kayitlar etkilenmez.
 *  2. TEK AKSIYON - (instanceId, idempotencyKey) unique kisiti + rowVersion CAS
 *     sayesinde cift tiklama iki aksiyon uretmez.
 *  3. BAYAT VERI - rowVersion uyusmazliginda islem uygulanmaz.
 *  4. BILDIRIM IZOLASYONU - bildirimler transaction disinda gonderilir.
 */

import { Prisma } from '@prisma/client';
import { prisma, type Db } from '../db';
import {
  ACTION_KIND,
  ASSIGNEE_TYPE,
  AUDIT_EVENT,
  AUDIT_VISIBILITY,
  INSTANCE_STATUS,
  NOTIFICATION_EVENT,
  SKIP_REASON,
  SLA_STATUS,
  STATUS,
  STEP_INSTANCE_STATUS,
  STEP_TYPE,
  TARGET_STEP_MODE,
  type ActionKind,
  type NotificationEvent,
} from '../domain/constants';
import {
  ConflictError,
  DuplicateActionError,
  ForbiddenError,
  InvalidTransitionError,
  NotFoundError,
  StaleDataError,
  WorkflowConfigError,
} from '../domain/errors';
import { evaluateCondition, parseConditionGroup, type ConditionContext } from '../domain/conditions';
import { calculateDueDate, evaluateSlaStatus, type SlaCalendarOptions } from '../domain/sla';
import { tryParseJson } from '../lib/json';
import { logger } from '../lib/logger';
import { writeAudit } from './audit.service';
import {
  canActOnStep,
  resolveStepAssignee,
  type AssigneeContext,
  type AssigneeResolution,
} from './assignee.service';
import type { NotificationIntent } from './notification.service';
import { getSlaAtRiskThreshold, getSlaCalendarOptions } from './settings.service';

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

export interface EngineActor {
  id: string;
  displayName: string;
  roles: string[];
  groupIds: string[];
  /** Audit'te gorunecek birincil rol. */
  primaryRole: string | null;
}

type VersionGraph = Prisma.WorkflowVersionGetPayload<{
  include: {
    steps: {
      include: { actions: true };
    };
  };
}>;

type StepNode = VersionGraph['steps'][number];
type ActionNode = StepNode['actions'][number];

export interface EngineOutcome {
  notifications: NotificationIntent[];
}

/** Sistem tarafindan sunulan, workflow konfigurasyonunda tanimlanmayan aksiyon. */
export const SYSTEM_ACTION = {
  /** "Ek Bilgi Iste" sonrasi talep sahibinin bilgiyi geri gonderme aksiyonu. */
  PROVIDE_INFO: 'PROVIDE_INFO',
} as const;

// ---------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------

export async function loadVersionGraph(db: Db, versionId: string): Promise<VersionGraph> {
  const version = await db.workflowVersion.findUnique({
    where: { id: versionId },
    include: {
      steps: {
        orderBy: { sequence: 'asc' },
        include: { actions: { orderBy: { sortOrder: 'asc' } } },
      },
    },
  });
  if (!version) {
    throw new WorkflowConfigError('Talebin bağlı olduğu iş akışı sürümü bulunamadı.');
  }
  return version;
}

/** Gelecek adimlar icin statik sorumlu etiketi (henuz cozumlenmedi). */
export function describeAssigneeType(step: {
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

export function buildConditionContext(input: {
  category: { code: string; name: string; requiresManagerApproval: boolean };
  request: { priority: string; subject: string };
  requester: {
    id: string;
    department: string | null;
    departmentCode: string | null;
    title: string | null;
    managerId: string | null;
  };
  formData: Record<string, unknown>;
}): ConditionContext {
  return {
    category: {
      code: input.category.code,
      name: input.category.name,
      requiresManagerApproval: input.category.requiresManagerApproval,
    },
    request: {
      priority: input.request.priority,
      departmentCode: input.requester.departmentCode,
      subject: input.request.subject,
    },
    requester: {
      id: input.requester.id,
      department: input.requester.department,
      departmentCode: input.requester.departmentCode,
      title: input.requester.title,
      hasManager: Boolean(input.requester.managerId),
    },
    form: input.formData,
  };
}

function isStepEligible(step: StepNode, ctx: ConditionContext): { eligible: boolean; reason?: string } {
  if (!step.isActive) {
    return { eligible: false, reason: SKIP_REASON.STEP_INACTIVE };
  }
  let group;
  try {
    group = parseConditionGroup(step.conditionJson);
  } catch (err) {
    // Bozuk kosul sessizce "true" kabul edilmez; konfigurasyon hatasi olarak yukselir.
    throw new WorkflowConfigError(
      `"${step.name}" adımının koşul tanımı geçersiz: ${
        err instanceof Error ? err.message : 'bilinmeyen hata'
      }`,
    );
  }
  if (!evaluateCondition(group, ctx)) {
    return { eligible: false, reason: SKIP_REASON.CONDITION_NOT_MET };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// Instance baslatma
// ---------------------------------------------------------------------------

export interface StartWorkflowParams {
  db: Db;
  request: {
    id: string;
    requestNo: string;
    subject: string;
    priority: string;
    requesterId: string;
    requesterManagerId: string | null;
    createdAt: Date;
  };
  category: {
    id: string;
    code: string;
    name: string;
    requiresManagerApproval: boolean;
    ownerRoleCode: string | null;
    ownerGroupId: string | null;
  };
  requester: {
    id: string;
    department: string | null;
    departmentCode: string | null;
    title: string | null;
    managerId: string | null;
  };
  formData: Record<string, unknown>;
  version: VersionGraph;
  actor: EngineActor;
  slaOptions: SlaCalendarOptions;
  atRiskThreshold: number;
  ipAddress?: string | null;
}

/**
 * Talep gonderildiginde cagrilir.
 * START adimi "tamamlanmis" olarak kaydedilir, sonraki uygun adim aktive edilir.
 */
export async function startWorkflow(params: StartWorkflowParams): Promise<EngineOutcome> {
  const { db, request, category, version, actor } = params;
  const now = new Date();

  const conditionCtx = buildConditionContext({
    category,
    request: { priority: request.priority, subject: request.subject },
    requester: params.requester,
    formData: params.formData,
  });

  const assigneeCtx: AssigneeContext = {
    requesterId: request.requesterId,
    requesterManagerId: request.requesterManagerId,
    categoryOwnerRoleCode: category.ownerRoleCode,
    categoryOwnerGroupId: category.ownerGroupId,
  };

  const instance = await db.workflowInstance.create({
    data: {
      requestId: request.id,
      definitionId: version.definitionId,
      versionId: version.id,
      status: INSTANCE_STATUS.RUNNING,
      startedAt: now,
    },
  });

  // 1) Tum adimlari materialize et. Kosulu saglanmayanlar SKIPPED olarak durur;
  //    boylece kullanici "hangi adimlar atlandi" bilgisini de gorebilir.
  const stepInstanceByStepId = new Map<string, { id: string; status: string }>();
  for (const step of version.steps) {
    const eligibility = isStepEligible(step, conditionCtx);
    const created = await db.stepInstance.create({
      data: {
        instanceId: instance.id,
        stepId: step.id,
        stepCode: step.code,
        stepName: step.name,
        stepType: step.type,
        sequence: step.sequence,
        status: eligibility.eligible
          ? STEP_INSTANCE_STATUS.PENDING
          : STEP_INSTANCE_STATUS.SKIPPED,
        skipReason: eligibility.reason ?? null,
        assigneeType: step.assigneeType,
        assigneeLabel: describeAssigneeType(step),
        statusCode: step.statusCode,
      },
    });
    stepInstanceByStepId.set(step.id, { id: created.id, status: created.status });
  }

  const notifications: NotificationIntent[] = [];

  // 2) START adimi varsa talep olusturma adimi olarak kapat.
  const startStep = version.steps.find((s) => s.type === STEP_TYPE.START);
  let cursorSequence = -1;
  if (startStep) {
    const startInstance = stepInstanceByStepId.get(startStep.id)!;
    const submitAction = startStep.actions.find(
      (a) => a.isActive && a.kind === ACTION_KIND.SUBMIT,
    );
    await db.stepInstance.update({
      where: { id: startInstance.id },
      data: {
        status: STEP_INSTANCE_STATUS.COMPLETED,
        assigneeId: request.requesterId,
        assigneeType: ASSIGNEE_TYPE.REQUESTER,
        assigneeLabel: actor.displayName,
        startedAt: request.createdAt,
        completedAt: now,
        completedById: actor.id,
        resultActionCode: submitAction?.code ?? ACTION_KIND.SUBMIT,
        isCurrent: false,
      },
    });
    cursorSequence = startStep.sequence;

    await db.workflowActionLog.create({
      data: {
        instanceId: instance.id,
        requestId: request.id,
        stepInstanceId: startInstance.id,
        actionCode: submitAction?.code ?? ACTION_KIND.SUBMIT,
        actionKind: ACTION_KIND.SUBMIT,
        actionName: submitAction?.name ?? 'Gönder',
        performedById: actor.id,
        performedByRole: actor.primaryRole,
        fromStatusCode: STATUS.DRAFT,
        toStatusCode: STATUS.SUBMITTED,
        fromStepId: startStep.id,
        fromStepName: startStep.name,
        idempotencyKey: `${startInstance.id}:SUBMIT:${actor.id}`,
      },
    });
  }

  // 3) Sonraki uygun adimi aktive et.
  const activation = await activateNextStep({
    db,
    instanceId: instance.id,
    version,
    afterSequence: cursorSequence,
    assigneeCtx,
    actor,
    slaOptions: params.slaOptions,
    atRiskThreshold: params.atRiskThreshold,
    request: {
      id: request.id,
      requestNo: request.requestNo,
      subject: request.subject,
      categoryName: category.name,
      requesterId: request.requesterId,
      requesterManagerId: request.requesterManagerId,
    },
    notifications,
    ipAddress: params.ipAddress,
  });

  if (!activation.activated) {
    // Uygun adim yok: akis dogrudan tamamlanmis kabul edilir.
    await closeInstance({
      db,
      instanceId: instance.id,
      requestId: request.id,
      instanceStatus: INSTANCE_STATUS.COMPLETED,
      now,
    });
  }

  return { notifications };
}

// ---------------------------------------------------------------------------
// Adim aktive etme
// ---------------------------------------------------------------------------

export interface ActivateParams {
  db: Db;
  instanceId: string;
  version: VersionGraph;
  /** Bu siradan SONRAKI uygun adim aranir. */
  afterSequence: number;
  /** Belirli bir adima gitmek icin (SPECIFIC mod / admin override). */
  targetStepId?: string | null;
  /**
   * Admin "Hedef Adima Tasi" ile tamamlanmis bir adima geri donebilir.
   * Bu durumda gecmis EZILMEZ; adim icin YENI bir StepInstance olusturulur.
   */
  allowRevisit?: boolean;
  /** Admin REASSIGN ile belirli bir kisiyi sorumlu yapabilir. */
  forcedAssigneeId?: string | null;
  assigneeCtx: AssigneeContext;
  actor: EngineActor;
  slaOptions: SlaCalendarOptions;
  atRiskThreshold: number;
  request: {
    id: string;
    requestNo: string;
    subject: string;
    categoryName: string;
    requesterId: string;
    requesterManagerId: string | null;
  };
  notifications: NotificationIntent[];
  ipAddress?: string | null;
  /** Aktive edilen adimin durum kodunu ezmek icin (aksiyonun targetStatusCode'u). */
  overrideStatusCode?: string | null;
}

export interface ActivationResult {
  activated: boolean;
  stepInstanceId?: string;
  step?: StepNode;
  assignee?: AssigneeResolution;
  statusCode?: string;
  dueAt?: Date | null;
}

/**
 * Sirada bekleyen uygun adimi bulur ve aktive eder.
 * END tipi adim eger tanimli aktif aksiyonu yoksa otomatik kapanir.
 */
export async function activateNextStep(params: ActivateParams): Promise<ActivationResult> {
  const { db, instanceId, version } = params;
  const now = new Date();

  const stepInstances = await db.stepInstance.findMany({
    where: { instanceId },
    orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
  });

  let candidate: (typeof stepInstances)[number] | undefined;

  if (params.targetStepId) {
    // Ayni adim birden fazla kez ziyaret edilmis olabilir; en yenisi esas alinir.
    const occurrences = stepInstances
      .filter((si) => si.stepId === params.targetStepId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const latest = occurrences[0];

    const stepDef = version.steps.find((s) => s.id === params.targetStepId);
    if (!stepDef) {
      throw new WorkflowConfigError('Hedef adım bu iş akışı sürümünde bulunamadı.');
    }

    if (latest && latest.status === STEP_INSTANCE_STATUS.PENDING) {
      candidate = latest;
    } else if (params.allowRevisit) {
      // Gecmis kayit korunur; adim icin yeni bir ornek olusturulur.
      candidate = await db.stepInstance.create({
        data: {
          instanceId,
          stepId: stepDef.id,
          stepCode: stepDef.code,
          stepName: stepDef.name,
          stepType: stepDef.type,
          sequence: stepDef.sequence,
          status: STEP_INSTANCE_STATUS.PENDING,
          assigneeType: stepDef.assigneeType,
          assigneeLabel: describeAssigneeType(stepDef),
          statusCode: stepDef.statusCode,
        },
      });
    } else if (latest) {
      throw new WorkflowConfigError(
        `"${stepDef.name}" adımı bu kayıtta ${latest.status} durumunda; tekrar başlatılamaz.`,
      );
    } else {
      throw new WorkflowConfigError('Hedef adım bu iş akışı örneğinde bulunamadı.');
    }
  } else {
    candidate = stepInstances.find(
      (si) =>
        si.sequence > params.afterSequence && si.status === STEP_INSTANCE_STATUS.PENDING,
    );
  }

  if (!candidate) return { activated: false };

  const step = version.steps.find((s) => s.id === candidate!.stepId);
  if (!step) {
    throw new WorkflowConfigError('Adım tanımı iş akışı sürümünde bulunamadı.');
  }

  // END adimi: aktif aksiyonu yoksa akis burada kapanir.
  const activeActions = step.actions.filter((a) => a.isActive);
  if (step.type === STEP_TYPE.END && activeActions.length === 0) {
    await db.stepInstance.update({
      where: { id: candidate.id },
      data: {
        status: STEP_INSTANCE_STATUS.COMPLETED,
        startedAt: now,
        completedAt: now,
        isCurrent: false,
        assigneeLabel: describeAssigneeType(step),
      },
    });
    return { activated: false };
  }

  let assignee = await resolveStepAssignee(db, step, params.assigneeCtx);

  // Admin belirli bir kisiyi sorumlu yaptiysa cozumlenen sorumlu ezilir.
  if (params.forcedAssigneeId) {
    const forced = await db.user.findFirst({
      where: { id: params.forcedAssigneeId, isActive: true },
      select: { id: true, displayName: true },
    });
    if (!forced) {
      throw new WorkflowConfigError('Seçilen sorumlu bulunamadı veya pasif durumda.');
    }
    assignee = {
      assigneeId: forced.id,
      assigneeType: ASSIGNEE_TYPE.USER,
      assigneeLabel: forced.displayName,
      roleCode: null,
      groupId: null,
      fallbackApplied: false,
      fallbackReason: null,
    };
  }

  const dueAt = step.slaEnabled
    ? calculateDueDate(now, step.slaHours, params.slaOptions)
    : null;
  const statusCode = params.overrideStatusCode ?? step.statusCode;

  await db.stepInstance.update({
    where: { id: candidate.id },
    data: {
      status: STEP_INSTANCE_STATUS.ACTIVE,
      isCurrent: true,
      startedAt: now,
      assigneeId: assignee.assigneeId,
      assigneeType: assignee.assigneeType,
      assigneeLabel: assignee.assigneeLabel,
      assigneeRoleCode: assignee.roleCode,
      assigneeGroupId: assignee.groupId,
      statusCode,
      dueAt,
      slaStatus: dueAt ? SLA_STATUS.ON_TRACK : SLA_STATUS.NA,
      skipReason: null,
    },
  });

  await writeAudit(db, {
    requestId: params.request.id,
    instanceId,
    eventType: AUDIT_EVENT.STEP_STARTED,
    actor: { id: params.actor.id, displayName: params.actor.displayName, role: params.actor.primaryRole },
    stepInstanceId: candidate.id,
    stepName: step.name,
    workflowVersionId: version.id,
    workflowVersionNumber: version.versionNumber,
    newStatusCode: statusCode,
    description: `"${step.name}" adımı başladı. Sorumlu: ${assignee.assigneeLabel}`,
    visibility: AUDIT_VISIBILITY.USER,
    ipAddress: params.ipAddress ?? null,
  });

  if (assignee.fallbackApplied) {
    await writeAudit(db, {
      requestId: params.request.id,
      instanceId,
      eventType: AUDIT_EVENT.ASSIGNEE_FALLBACK,
      actor: { id: null, displayName: 'Sistem', role: null },
      stepInstanceId: candidate.id,
      stepName: step.name,
      workflowVersionId: version.id,
      workflowVersionNumber: version.versionNumber,
      description: `Adımın asıl sorumlusu belirlenemedi (${assignee.fallbackReason}). Yedek sorumlu uygulandı: ${assignee.assigneeLabel}`,
      visibility: AUDIT_VISIBILITY.ADMIN,
    });
  }

  params.notifications.push({
    event: NOTIFICATION_EVENT.STEP_STARTED,
    requestId: params.request.id,
    requestNo: params.request.requestNo,
    subject: params.request.subject,
    categoryName: params.request.categoryName,
    versionId: version.id,
    requesterId: params.request.requesterId,
    requesterManagerId: params.request.requesterManagerId,
    currentAssigneeId: assignee.assigneeId,
    currentAssigneeRoleCode: assignee.roleCode,
    currentAssigneeGroupId: assignee.groupId,
    stepName: step.name,
    actorDisplayName: params.actor.displayName,
  });

  return {
    activated: true,
    stepInstanceId: candidate.id,
    step,
    assignee,
    statusCode,
    dueAt,
  };
}

// ---------------------------------------------------------------------------
// Instance kapatma
// ---------------------------------------------------------------------------

export interface CloseInstanceParams {
  db: Db;
  instanceId: string;
  requestId: string;
  instanceStatus: string;
  now: Date;
}

/** Kalan PENDING adimlari iptal eder ve instance'i kapatir. */
export async function closeInstance(params: CloseInstanceParams): Promise<void> {
  const { db, instanceId, now } = params;

  await db.stepInstance.updateMany({
    where: { instanceId, status: STEP_INSTANCE_STATUS.PENDING },
    data: { status: STEP_INSTANCE_STATUS.CANCELLED, skipReason: 'FLOW_CLOSED' },
  });

  await db.workflowInstance.update({
    where: { id: instanceId },
    data: {
      status: params.instanceStatus,
      completedAt: now,
      rowVersion: { increment: 1 },
    },
  });
}

// ---------------------------------------------------------------------------
// Aksiyon uygulama
// ---------------------------------------------------------------------------

export interface ExecuteActionParams {
  requestId: string;
  actionCode: string;
  actor: EngineActor;
  comment?: string | null;
  /** Ekrandaki rowVersion. Uyusmazsa islem uygulanmaz. */
  expectedRowVersion: number;
  idempotencyKey?: string | null;
  ipAddress?: string | null;
}

export interface ExecuteActionResult {
  requestId: string;
  statusCode: string;
  rowVersion: number;
  /** Ayni aksiyon daha once uygulanmissa true (yeni kayit olusturulmadi). */
  duplicate: boolean;
  currentStepName: string | null;
  currentAssigneeLabel: string | null;
}

export async function executeAction(
  params: ExecuteActionParams,
): Promise<ExecuteActionResult> {
  // --- Hazirlik (transaction disinda, salt okunur) ---
  const prepared = await prepareActionContext(params);
  const notifications: NotificationIntent[] = [];

  const result = await prisma.$transaction(async (tx) => {
    return applyAction(tx as unknown as Db, prepared, params, notifications);
  });

  // --- Bildirim: commit sonrasi, is akisini etkilemez ---
  if (notifications.length > 0) {
    const { dispatchNotifications } = await import('./notification.service');
    await dispatchNotifications(notifications);
  }

  return result;
}

interface PreparedAction {
  request: Prisma.RequestGetPayload<{
    include: {
      category: true;
      requester: true;
      instance: true;
    };
  }>;
  version: VersionGraph;
  slaOptions: SlaCalendarOptions;
  atRiskThreshold: number;
}

async function prepareActionContext(params: ExecuteActionParams): Promise<PreparedAction> {
  const request = await prisma.request.findUnique({
    where: { id: params.requestId },
    include: { category: true, requester: true, instance: true },
  });
  if (!request) throw new NotFoundError('Talep bulunamadı.');
  if (!request.instance) {
    throw new InvalidTransitionError(
      'Bu talep henüz gönderilmemiş; iş akışı başlatılmamış.',
    );
  }

  // ONEMLI: instance'in KENDI versiyonu okunur, aktif versiyon degil.
  const version = await loadVersionGraph(prisma, request.instance.versionId);
  const slaOptions = await getSlaCalendarOptions(version.slaCalendarMode);
  const atRiskThreshold = await getSlaAtRiskThreshold();

  return { request, version, slaOptions, atRiskThreshold };
}

async function applyAction(
  db: Db,
  prepared: PreparedAction,
  params: ExecuteActionParams,
  notifications: NotificationIntent[],
): Promise<ExecuteActionResult> {
  const { request, version } = prepared;
  const instance = request.instance!;
  const now = new Date();

  if (instance.status !== INSTANCE_STATUS.RUNNING) {
    throw new InvalidTransitionError(
      'Bu talep kapanmış durumda; yeni bir işlem uygulanamaz.',
    );
  }

  // --- Optimistic concurrency: atomik CAS ---
  //
  // ONEMLI: Bu kontrol adim/aksiyon cozumlemesinden ONCE yapilir. Aksi halde
  // cift tiklamada ikinci istek, birincinin ilerlettigi YENI adimi okur ve
  // "bu adimda boyle bir aksiyon yok" (422) gibi yanlis bir hata uretir.
  // Dogru cevap "veri bayat" (409) olmalidir.
  //
  // Transaction geri alinirsa artis da geri alinir; bu yuzden erken artirmak
  // guvenlidir.
  const casResult = await db.request.updateMany({
    where: { id: request.id, rowVersion: params.expectedRowVersion },
    data: { rowVersion: { increment: 1 } },
  });
  if (casResult.count === 0) {
    throw new StaleDataError();
  }
  const newRowVersion = params.expectedRowVersion + 1;

  const currentStepInstance = await db.stepInstance.findFirst({
    where: { instanceId: instance.id, isCurrent: true },
  });
  if (!currentStepInstance || currentStepInstance.status !== STEP_INSTANCE_STATUS.ACTIVE) {
    throw new ConflictError(
      'Talebin aktif bir adımı bulunamadı. Sayfayı yenileyip tekrar deneyin.',
    );
  }

  const step = version.steps.find((s) => s.id === currentStepInstance.stepId);
  if (!step) throw new WorkflowConfigError('Aktif adımın tanımı bulunamadı.');

  // --- Aksiyonu bul (sistem aksiyonu veya konfigurasyondan) ---
  const isProvideInfo = params.actionCode === SYSTEM_ACTION.PROVIDE_INFO;
  const action = isProvideInfo
    ? null
    : step.actions.find((a) => a.isActive && a.code === params.actionCode);

  if (!isProvideInfo && !action) {
    throw new InvalidTransitionError(
      `"${step.name}" adımında "${params.actionCode}" aksiyonu tanımlı değil.`,
    );
  }

  // --- Yetki: yalnizca adimin sorumlusu islem yapabilir ---
  if (isProvideInfo) {
    if (currentStepInstance.assigneeId !== params.actor.id) {
      throw new ForbiddenError('Ek bilgi yalnızca talebi gönderen kişi tarafından iletilebilir.');
    }
    if (!currentStepInstance.pendingInfoRequestedAt) {
      throw new InvalidTransitionError('Bu talep için ek bilgi beklenmiyor.');
    }
  } else {
    const allowed = canActOnStep(
      { id: params.actor.id, roles: params.actor.roles, groupIds: params.actor.groupIds },
      {
        assigneeId: currentStepInstance.assigneeId,
        assigneeType: currentStepInstance.assigneeType,
        roleCode: currentStepInstance.assigneeRoleCode,
        groupId: currentStepInstance.assigneeGroupId,
      },
    );
    if (!allowed) {
      throw new ForbiddenError(
        'Bu talep şu anda size yönlendirilmemiş; işlem yapma yetkiniz yok.',
      );
    }
  }

  // --- Aciklama zorunlulugu ---
  const comment = params.comment?.trim() || null;
  if (action?.commentRequired && !comment) {
    throw new InvalidTransitionError(
      `"${action.name}" işlemi için açıklama girilmesi zorunludur.`,
    );
  }

  // --- Idempotency: ayni aksiyon ikinci kez kayit uretmez ---
  const idempotencyKey =
    params.idempotencyKey?.trim() ||
    `${currentStepInstance.id}:${params.actionCode}:${params.actor.id}`;

  const actionKind: ActionKind = isProvideInfo
    ? ACTION_KIND.SUBMIT
    : (action!.kind as ActionKind);

  try {
    await db.workflowActionLog.create({
      data: {
        instanceId: instance.id,
        requestId: request.id,
        stepInstanceId: currentStepInstance.id,
        actionCode: params.actionCode,
        actionKind,
        actionName: isProvideInfo ? 'Ek Bilgi Gönderildi' : action!.name,
        performedById: params.actor.id,
        performedByRole: params.actor.primaryRole,
        comment,
        fromStatusCode: request.statusCode,
        fromStepId: step.id,
        fromStepName: step.name,
        idempotencyKey,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateActionError();
    }
    throw err;
  }

  // --- Ek bilgi geri donusu: adim askidan cikar, sorumlu geri yuklenir ---
  if (isProvideInfo) {
    return resumeAfterInfo({
      db,
      request,
      instance,
      version,
      step,
      currentStepInstance,
      actor: params.actor,
      comment,
      now,
      newRowVersion,
      notifications,
      ipAddress: params.ipAddress,
    });
  }

  return applyConfiguredAction({
    db,
    prepared,
    action: action!,
    step,
    currentStepInstance,
    actor: params.actor,
    comment,
    now,
    newRowVersion,
    notifications,
    ipAddress: params.ipAddress,
  });
}

// ---------------------------------------------------------------------------
// Konfigure edilmis aksiyonun uygulanmasi
// ---------------------------------------------------------------------------

interface ApplyConfiguredParams {
  db: Db;
  prepared: PreparedAction;
  action: ActionNode;
  step: StepNode;
  currentStepInstance: Prisma.StepInstanceGetPayload<{}>;
  actor: EngineActor;
  comment: string | null;
  now: Date;
  newRowVersion: number;
  notifications: NotificationIntent[];
  ipAddress?: string | null;
}

async function applyConfiguredAction(
  p: ApplyConfiguredParams,
): Promise<ExecuteActionResult> {
  const { db, prepared, action, step, currentStepInstance, actor, now } = p;
  const { request, version } = prepared;
  const instance = request.instance!;

  const assigneeCtx: AssigneeContext = {
    requesterId: request.requesterId,
    requesterManagerId: request.requesterManagerId,
    categoryOwnerRoleCode: request.category.ownerRoleCode,
    categoryOwnerGroupId: request.category.ownerGroupId,
  };

  // --- 1) "Ek Bilgi Iste": adim kapanmaz, askiya alinir ---
  if (action.targetStepMode === TARGET_STEP_MODE.REQUESTER) {
    return suspendForInfo(p, assigneeCtx);
  }

  // --- 2) Mevcut adimi kapat ---
  const closedSlaStatus = currentStepInstance.dueAt
    ? evaluateSlaStatus({
        startedAt: currentStepInstance.startedAt,
        dueAt: currentStepInstance.dueAt,
        closedAt: now,
      })
    : SLA_STATUS.NA;

  const staysOnSameStep = action.targetStepMode === TARGET_STEP_MODE.STAY;

  if (!staysOnSameStep) {
    await db.stepInstance.update({
      where: { id: currentStepInstance.id },
      data: {
        status: STEP_INSTANCE_STATUS.COMPLETED,
        completedAt: now,
        completedById: actor.id,
        resultActionCode: action.code,
        resultComment: p.comment,
        isCurrent: false,
        slaStatus: closedSlaStatus,
      },
    });

    await writeAudit(db, {
      requestId: request.id,
      instanceId: instance.id,
      eventType: AUDIT_EVENT.STEP_COMPLETED,
      actor: { id: actor.id, displayName: actor.displayName, role: actor.primaryRole },
      stepInstanceId: currentStepInstance.id,
      stepName: step.name,
      workflowVersionId: version.id,
      workflowVersionNumber: version.versionNumber,
      description: `"${step.name}" adımı "${action.name}" işlemi ile tamamlandı.`,
      visibility: AUDIT_VISIBILITY.USER,
      ipAddress: p.ipAddress ?? null,
    });
  }

  // --- 3) Aksiyon tipine gore is audit'i (Onay Gecmisi bu kayitlardan uretilir) ---
  const kindAuditType = auditTypeForKind(action.kind as ActionKind);
  if (kindAuditType) {
    await writeAudit(db, {
      requestId: request.id,
      instanceId: instance.id,
      eventType: kindAuditType,
      actor: { id: actor.id, displayName: actor.displayName, role: actor.primaryRole },
      stepInstanceId: currentStepInstance.id,
      stepName: step.name,
      workflowVersionId: version.id,
      workflowVersionNumber: version.versionNumber,
      description: p.comment,
      visibility: AUDIT_VISIBILITY.USER,
      ipAddress: p.ipAddress ?? null,
    });
  }

  // --- 4) Bekleyen adimlarin kosullarini yeniden degerlendir ---
  //     (Ek bilgi ile form verisi degismis olabilir.)
  await reevaluatePendingSteps({
    db,
    instanceId: instance.id,
    version,
    request,
    formData: tryParseJson<Record<string, unknown>>(request.formDataJson, {}),
  });

  // --- 5) Hedefi belirle ve aktive et ---
  let activation: ActivationResult = { activated: false };

  if (staysOnSameStep) {
    activation = {
      activated: true,
      stepInstanceId: currentStepInstance.id,
      step,
      statusCode: action.targetStatusCode ?? currentStepInstance.statusCode ?? request.statusCode,
      dueAt: currentStepInstance.dueAt,
      assignee: {
        assigneeId: currentStepInstance.assigneeId,
        assigneeType: (currentStepInstance.assigneeType ?? ASSIGNEE_TYPE.ROLE) as never,
        assigneeLabel: currentStepInstance.assigneeLabel ?? '-',
        roleCode: currentStepInstance.assigneeRoleCode,
        groupId: currentStepInstance.assigneeGroupId,
        fallbackApplied: false,
        fallbackReason: null,
      },
    };
  } else if (action.targetStepMode !== TARGET_STEP_MODE.END) {
    activation = await activateNextStep({
      db,
      instanceId: instance.id,
      version,
      afterSequence: step.sequence,
      targetStepId:
        action.targetStepMode === TARGET_STEP_MODE.SPECIFIC ? action.targetStepId : null,
      assigneeCtx,
      actor,
      slaOptions: prepared.slaOptions,
      atRiskThreshold: prepared.atRiskThreshold,
      request: {
        id: request.id,
        requestNo: request.requestNo,
        subject: request.subject,
        categoryName: request.category.name,
        requesterId: request.requesterId,
        requesterManagerId: request.requesterManagerId,
      },
      notifications: p.notifications,
      ipAddress: p.ipAddress,
      // Aksiyon bir hedef durum belirtmisse adimin varsayilan durumunu ezer.
      overrideStatusCode: action.targetStatusCode,
    });
  }

  // --- 6) Talebi guncelle ---
  const terminal = !activation.activated;
  const newStatus = resolveNewStatus({
    action,
    activation,
    version,
    fallback: request.statusCode,
  });

  const instanceStatus = terminal
    ? instanceStatusForKind(action.kind as ActionKind)
    : INSTANCE_STATUS.RUNNING;

  if (terminal) {
    await closeInstance({
      db,
      instanceId: instance.id,
      requestId: request.id,
      instanceStatus,
      now,
    });
  }

  const isFirstResponse =
    request.firstResponseAt === null && actor.id !== request.requesterId;

  const updated = await db.request.update({
    where: { id: request.id },
    data: {
      statusCode: newStatus,
      currentAssigneeId: terminal ? null : (activation.assignee?.assigneeId ?? null),
      currentAssigneeRoleCode: terminal ? null : (activation.assignee?.roleCode ?? null),
      currentAssigneeGroupId: terminal ? null : (activation.assignee?.groupId ?? null),
      currentAssigneeLabel: terminal ? null : (activation.assignee?.assigneeLabel ?? null),
      currentStepInstanceId: terminal ? null : (activation.stepInstanceId ?? null),
      currentStepCode: terminal ? null : (activation.step?.code ?? null),
      currentStepName: terminal ? null : (activation.step?.name ?? null),
      currentStepSequence: terminal ? null : (activation.step?.sequence ?? null),
      slaDueAt: terminal ? null : (activation.dueAt ?? null),
      slaStatus: terminal
        ? evaluateSlaStatus({
            startedAt: request.submittedAt,
            dueAt: request.slaDueAt,
            closedAt: now,
          })
        : activation.dueAt
          ? SLA_STATUS.ON_TRACK
          : SLA_STATUS.NA,
      ...(isFirstResponse ? { firstResponseAt: now } : {}),
      ...(terminal ? { closedAt: now } : {}),
      ...(terminal && instanceStatus === INSTANCE_STATUS.COMPLETED
        ? { completedAt: now }
        : {}),
    },
  });

  if (newStatus !== request.statusCode) {
    await writeAudit(db, {
      requestId: request.id,
      instanceId: instance.id,
      eventType: AUDIT_EVENT.STATUS_CHANGED,
      actor: { id: actor.id, displayName: actor.displayName, role: actor.primaryRole },
      stepInstanceId: currentStepInstance.id,
      stepName: step.name,
      workflowVersionId: version.id,
      workflowVersionNumber: version.versionNumber,
      oldStatusCode: request.statusCode,
      newStatusCode: newStatus,
      fieldName: 'statusCode',
      oldValue: request.statusCode,
      newValue: newStatus,
      description: 'Talep durumu güncellendi.',
      visibility: AUDIT_VISIBILITY.USER,
      ipAddress: p.ipAddress ?? null,
    });
  }

  // --- 7) Bildirim niyetleri ---
  const notifEvent = notificationEventForKind(action.kind as ActionKind, terminal);
  if (notifEvent) {
    p.notifications.push({
      event: notifEvent,
      requestId: request.id,
      requestNo: request.requestNo,
      subject: request.subject,
      categoryName: request.category.name,
      versionId: version.id,
      requesterId: request.requesterId,
      requesterManagerId: request.requesterManagerId,
      currentAssigneeId: updated.currentAssigneeId,
      currentAssigneeRoleCode: updated.currentAssigneeRoleCode,
      currentAssigneeGroupId: updated.currentAssigneeGroupId,
      stepName: activation.step?.name ?? step.name,
      actorDisplayName: actor.displayName,
      note: p.comment,
    });
  }

  return {
    requestId: request.id,
    statusCode: newStatus,
    rowVersion: p.newRowVersion,
    duplicate: false,
    currentStepName: updated.currentStepName,
    currentAssigneeLabel: updated.currentAssigneeLabel,
  };
}

// ---------------------------------------------------------------------------
// Ek bilgi isteme / geri donus
// ---------------------------------------------------------------------------

async function suspendForInfo(
  p: ApplyConfiguredParams,
  _assigneeCtx: AssigneeContext,
): Promise<ExecuteActionResult> {
  const { db, prepared, action, step, currentStepInstance, actor, now } = p;
  const { request, version } = prepared;
  const instance = request.instance!;

  const requester = await db.user.findUnique({
    where: { id: request.requesterId },
    select: { id: true, displayName: true },
  });

  const newStatus = action.targetStatusCode ?? STATUS.PENDING_INFO;

  await db.stepInstance.update({
    where: { id: currentStepInstance.id },
    data: {
      // Adim ACTIVE kalir; yalnizca sorumlu gecici olarak talep sahibine gecer.
      assigneeId: request.requesterId,
      assigneeType: ASSIGNEE_TYPE.REQUESTER,
      assigneeLabel: requester?.displayName ?? 'Talep Eden',
      assigneeRoleCode: null,
      assigneeGroupId: null,
      // Havuz gorevlerinde assigneeId NULL'dir; bu durumda bilgi geldiginde
      // sorumlu yeniden cozumlenir (gorev havuza geri doner).
      // "Ek bilgi bekleniyor" isareti pendingInfoRequestedAt alanidir.
      pendingInfoReturnAssigneeId: currentStepInstance.assigneeId ?? null,
      pendingInfoRequestedAt: now,
      statusCode: newStatus,
    },
  });

  const updated = await db.request.update({
    where: { id: request.id },
    data: {
      statusCode: newStatus,
      currentAssigneeId: request.requesterId,
      currentAssigneeRoleCode: null,
      currentAssigneeGroupId: null,
      currentAssigneeLabel: requester?.displayName ?? 'Talep Eden',
    },
  });

  await writeAudit(db, {
    requestId: request.id,
    instanceId: instance.id,
    eventType: AUDIT_EVENT.INFO_REQUESTED,
    actor: { id: actor.id, displayName: actor.displayName, role: actor.primaryRole },
    stepInstanceId: currentStepInstance.id,
    stepName: step.name,
    workflowVersionId: version.id,
    workflowVersionNumber: version.versionNumber,
    oldStatusCode: request.statusCode,
    newStatusCode: newStatus,
    description: p.comment
      ? `Talep sahibinden ek bilgi istendi: ${p.comment}`
      : 'Talep sahibinden ek bilgi istendi.',
    visibility: AUDIT_VISIBILITY.USER,
    ipAddress: p.ipAddress ?? null,
  });

  p.notifications.push({
    event: NOTIFICATION_EVENT.INFO_REQUESTED,
    requestId: request.id,
    requestNo: request.requestNo,
    subject: request.subject,
    categoryName: request.category.name,
    versionId: version.id,
    requesterId: request.requesterId,
    requesterManagerId: request.requesterManagerId,
    currentAssigneeId: request.requesterId,
    currentAssigneeRoleCode: null,
    currentAssigneeGroupId: null,
    stepName: step.name,
    actorDisplayName: actor.displayName,
    note: p.comment,
  });

  return {
    requestId: request.id,
    statusCode: newStatus,
    rowVersion: p.newRowVersion,
    duplicate: false,
    currentStepName: updated.currentStepName,
    currentAssigneeLabel: updated.currentAssigneeLabel,
  };
}

interface ResumeParams {
  db: Db;
  request: PreparedAction['request'];
  instance: NonNullable<PreparedAction['request']['instance']>;
  version: VersionGraph;
  step: StepNode;
  currentStepInstance: Prisma.StepInstanceGetPayload<{}>;
  actor: EngineActor;
  comment: string | null;
  now: Date;
  newRowVersion: number;
  notifications: NotificationIntent[];
  ipAddress?: string | null;
}

async function resumeAfterInfo(p: ResumeParams): Promise<ExecuteActionResult> {
  const { db, request, instance, version, step, currentStepInstance, actor, now } = p;

  const returnAssigneeId = currentStepInstance.pendingInfoReturnAssigneeId;
  const assigneeCtx: AssigneeContext = {
    requesterId: request.requesterId,
    requesterManagerId: request.requesterManagerId,
    categoryOwnerRoleCode: request.category.ownerRoleCode,
    categoryOwnerGroupId: request.category.ownerGroupId,
  };

  // Sorumluyu geri yukle: kisi atanmissa o kisi, havuz gorevi ise yeniden cozumle.
  let assignee: AssigneeResolution;
  if (returnAssigneeId) {
    const user = await db.user.findFirst({
      where: { id: returnAssigneeId, isActive: true },
      select: { id: true, displayName: true },
    });
    assignee = user
      ? {
          assigneeId: user.id,
          assigneeType: ASSIGNEE_TYPE.USER as never,
          assigneeLabel: user.displayName,
          roleCode: null,
          groupId: null,
          fallbackApplied: false,
          fallbackReason: null,
        }
      : await resolveStepAssignee(db, step, assigneeCtx);
  } else {
    assignee = await resolveStepAssignee(db, step, assigneeCtx);
  }

  await db.stepInstance.update({
    where: { id: currentStepInstance.id },
    data: {
      assigneeId: assignee.assigneeId,
      assigneeType: assignee.assigneeType,
      assigneeLabel: assignee.assigneeLabel,
      assigneeRoleCode: assignee.roleCode,
      assigneeGroupId: assignee.groupId,
      pendingInfoReturnAssigneeId: null,
      pendingInfoRequestedAt: null,
      statusCode: step.statusCode,
    },
  });

  const updated = await db.request.update({
    where: { id: request.id },
    data: {
      statusCode: step.statusCode,
      currentAssigneeId: assignee.assigneeId,
      currentAssigneeRoleCode: assignee.roleCode,
      currentAssigneeGroupId: assignee.groupId,
      currentAssigneeLabel: assignee.assigneeLabel,
    },
  });

  await writeAudit(db, {
    requestId: request.id,
    instanceId: instance.id,
    eventType: AUDIT_EVENT.STATUS_CHANGED,
    actor: { id: actor.id, displayName: actor.displayName, role: actor.primaryRole },
    stepInstanceId: currentStepInstance.id,
    stepName: step.name,
    workflowVersionId: version.id,
    workflowVersionNumber: version.versionNumber,
    oldStatusCode: request.statusCode,
    newStatusCode: step.statusCode,
    description: p.comment
      ? `Talep sahibi ek bilgi iletti: ${p.comment}`
      : 'Talep sahibi ek bilgi iletti.',
    visibility: AUDIT_VISIBILITY.USER,
    ipAddress: p.ipAddress ?? null,
  });

  p.notifications.push({
    event: NOTIFICATION_EVENT.STEP_STARTED,
    requestId: request.id,
    requestNo: request.requestNo,
    subject: request.subject,
    categoryName: request.category.name,
    versionId: version.id,
    requesterId: request.requesterId,
    requesterManagerId: request.requesterManagerId,
    currentAssigneeId: assignee.assigneeId,
    currentAssigneeRoleCode: assignee.roleCode,
    currentAssigneeGroupId: assignee.groupId,
    stepName: step.name,
    actorDisplayName: actor.displayName,
  });

  return {
    requestId: request.id,
    statusCode: step.statusCode,
    rowVersion: p.newRowVersion,
    duplicate: false,
    currentStepName: updated.currentStepName,
    currentAssigneeLabel: updated.currentAssigneeLabel,
  };
}

// ---------------------------------------------------------------------------
// Bekleyen adim kosullarini yeniden degerlendirme
// ---------------------------------------------------------------------------

interface ReevaluateParams {
  db: Db;
  instanceId: string;
  version: VersionGraph;
  request: PreparedAction['request'];
  formData: Record<string, unknown>;
}

/**
 * Sadece PENDING/SKIPPED(CONDITION_NOT_MET) adimlari etkiler.
 * Tamamlanmis adimlar asla degistirilmez.
 */
async function reevaluatePendingSteps(p: ReevaluateParams): Promise<void> {
  const { db, instanceId, version, request } = p;

  const ctx = buildConditionContext({
    category: request.category,
    request: { priority: request.priority, subject: request.subject },
    requester: {
      id: request.requester.id,
      department: request.requester.department,
      departmentCode: request.requester.departmentCode,
      title: request.requester.title,
      managerId: request.requesterManagerId,
    },
    formData: p.formData,
  });

  const open = await db.stepInstance.findMany({
    where: {
      instanceId,
      status: { in: [STEP_INSTANCE_STATUS.PENDING, STEP_INSTANCE_STATUS.SKIPPED] },
    },
  });

  for (const si of open) {
    // Admin tarafindan atlanmis adim yeniden acilmaz.
    if (si.skipReason === SKIP_REASON.ADMIN_OVERRIDE) continue;

    const step = version.steps.find((s) => s.id === si.stepId);
    if (!step) continue;

    const eligibility = isStepEligible(step, ctx);
    const desired = eligibility.eligible
      ? STEP_INSTANCE_STATUS.PENDING
      : STEP_INSTANCE_STATUS.SKIPPED;

    if (desired !== si.status) {
      await db.stepInstance.update({
        where: { id: si.id },
        data: { status: desired, skipReason: eligibility.reason ?? null },
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Eslemeler
// ---------------------------------------------------------------------------

function auditTypeForKind(kind: ActionKind) {
  switch (kind) {
    case ACTION_KIND.APPROVE:
      return AUDIT_EVENT.APPROVED;
    case ACTION_KIND.REJECT:
      return AUDIT_EVENT.REJECTED;
    case ACTION_KIND.COMPLETE:
      return AUDIT_EVENT.COMPLETED;
    case ACTION_KIND.CANCEL:
      return AUDIT_EVENT.CANCELLED;
    default:
      return null;
  }
}

function instanceStatusForKind(kind: ActionKind): string {
  switch (kind) {
    case ACTION_KIND.REJECT:
      return INSTANCE_STATUS.REJECTED;
    case ACTION_KIND.CANCEL:
      return INSTANCE_STATUS.CANCELLED;
    default:
      return INSTANCE_STATUS.COMPLETED;
  }
}

function notificationEventForKind(
  kind: ActionKind,
  terminal: boolean,
): NotificationEvent | null {
  switch (kind) {
    case ACTION_KIND.APPROVE:
      return NOTIFICATION_EVENT.APPROVED;
    case ACTION_KIND.REJECT:
      return NOTIFICATION_EVENT.REJECTED;
    case ACTION_KIND.CANCEL:
      return NOTIFICATION_EVENT.CANCELLED;
    case ACTION_KIND.COMPLETE:
      return terminal ? NOTIFICATION_EVENT.COMPLETED : null;
    default:
      return null;
  }
}

function resolveNewStatus(p: {
  action: ActionNode;
  activation: ActivationResult;
  version: VersionGraph;
  fallback: string;
}): string {
  // 1) Aksiyon acikca bir hedef durum belirttiyse o kullanilir.
  if (p.action.targetStatusCode) return p.action.targetStatusCode;
  // 2) Yeni adim aktive edildiyse adimin durumu.
  if (p.activation.activated && p.activation.statusCode) return p.activation.statusCode;
  // 3) Akis kapandiysa END adiminin durumu.
  const endStep = p.version.steps.find((s) => s.type === STEP_TYPE.END);
  if (endStep) return endStep.statusCode;
  return p.fallback;
}

// ---------------------------------------------------------------------------
// Ilerleme / sonraki adim bilgisi (kullanici sorularinin cevabi)
// ---------------------------------------------------------------------------

export interface ProgressStep {
  id: string;
  stepCode: string;
  stepName: string;
  stepType: string;
  sequence: number;
  status: string;
  /** past | current | future | skipped */
  phase: 'past' | 'current' | 'future' | 'skipped';
  assigneeLabel: string | null;
  statusCode: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  dueAt: Date | null;
  slaStatus: string;
  resultActionCode: string | null;
  resultComment: string | null;
  skipReason: string | null;
  isAwaitingInfo: boolean;
}

export function toProgressPhase(status: string, isCurrent: boolean): ProgressStep['phase'] {
  if (isCurrent) return 'current';
  if (status === STEP_INSTANCE_STATUS.COMPLETED) return 'past';
  if (
    status === STEP_INSTANCE_STATUS.SKIPPED ||
    status === STEP_INSTANCE_STATUS.CANCELLED
  ) {
    return 'skipped';
  }
  return 'future';
}

/**
 * "Talebim nerede? / Su anda kimde? / Bundan sonra ne olacak?" sorularinin
 * cevabini ureten yardimci.
 */
export async function getProgress(requestId: string): Promise<{
  steps: ProgressStep[];
  currentStep: ProgressStep | null;
  nextExpectedStep: { stepName: string; assigneeLabel: string | null } | null;
}> {
  const instance = await prisma.workflowInstance.findUnique({
    where: { requestId },
    include: { stepInstances: { orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }] } },
  });

  if (!instance) {
    return { steps: [], currentStep: null, nextExpectedStep: null };
  }

  const steps: ProgressStep[] = instance.stepInstances.map((si) => ({
    id: si.id,
    stepCode: si.stepCode,
    stepName: si.stepName,
    stepType: si.stepType,
    sequence: si.sequence,
    status: si.status,
    phase: toProgressPhase(si.status, si.isCurrent),
    assigneeLabel: si.assigneeLabel,
    statusCode: si.statusCode,
    startedAt: si.startedAt,
    completedAt: si.completedAt,
    dueAt: si.dueAt,
    slaStatus: si.slaStatus,
    resultActionCode: si.resultActionCode,
    resultComment: si.resultComment,
    skipReason: si.skipReason,
    isAwaitingInfo: Boolean(si.pendingInfoRequestedAt),
  }));

  const currentStep = steps.find((s) => s.phase === 'current') ?? null;

  // Sonraki beklenen adim: mevcut adimdan sonraki ilk PENDING adim.
  const next = currentStep
    ? instance.stepInstances.find(
        (si) =>
          si.sequence > currentStep.sequence && si.status === STEP_INSTANCE_STATUS.PENDING,
      )
    : undefined;

  return {
    steps,
    currentStep,
    nextExpectedStep: next
      ? { stepName: next.stepName, assigneeLabel: next.assigneeLabel }
      : null,
  };
}

/** Kullanicinin bu adimda yapabilecegi aksiyonlari dondurur (UI buton listesi). */
export async function getAvailableActions(
  requestId: string,
  actor: { id: string; roles: string[]; groupIds: string[] },
): Promise<
  Array<{
    code: string;
    name: string;
    kind: string;
    variant: string;
    commentRequired: boolean;
    confirmationRequired: boolean;
  }>
> {
  const instance = await prisma.workflowInstance.findUnique({
    where: { requestId },
    include: { stepInstances: { where: { isCurrent: true } } },
  });
  if (!instance || instance.status !== INSTANCE_STATUS.RUNNING) return [];

  const current = instance.stepInstances[0];
  if (!current || current.status !== STEP_INSTANCE_STATUS.ACTIVE) return [];

  // Ek bilgi bekleniyorsa talep sahibine sistem aksiyonu sunulur.
  if (current.pendingInfoRequestedAt) {
    if (current.assigneeId !== actor.id) return [];
    return [
      {
        code: SYSTEM_ACTION.PROVIDE_INFO,
        name: 'Ek Bilgiyi Gönder',
        kind: ACTION_KIND.SUBMIT,
        variant: 'PRIMARY',
        commentRequired: true,
        confirmationRequired: false,
      },
    ];
  }

  const allowed = canActOnStep(actor, {
    assigneeId: current.assigneeId,
    assigneeType: current.assigneeType,
    roleCode: current.assigneeRoleCode,
    groupId: current.assigneeGroupId,
  });
  if (!allowed) return [];

  const actions = await prisma.workflowAction.findMany({
    where: { stepId: current.stepId, isActive: true },
    orderBy: { sortOrder: 'asc' },
  });

  return actions
    .filter((a) => a.kind !== ACTION_KIND.SUBMIT) // SUBMIT yalnizca START adiminda
    .map((a) => ({
      code: a.code,
      name: a.name,
      kind: a.kind,
      variant: a.variant,
      commentRequired: a.commentRequired,
      confirmationRequired: a.confirmationRequired,
    }));
}

export { logger as engineLogger };
