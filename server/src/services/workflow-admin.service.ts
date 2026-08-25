/**
 * Admin Workflow Configuration servisi (spec 02).
 *
 * DEGISMEZ KURAL: yayinlanmis (ACTIVE/SUPERSEDED) bir versiyon asla degistirilmez.
 * Degisiklik icin "Revizyon Olustur" ile yeni bir DRAFT versiyon uretilir.
 * Tum mutasyon fonksiyonlari assertDraft() ile bu kurali zorlar.
 *
 * Kapsam disi (bilincli): BPMN editor, drag-drop canvas, generic node engine,
 * genel amacli rule engine, paralel branch, simulation, version diff, otomatik
 * migration, script node.
 */

import { Prisma } from '@prisma/client';
import { prisma, type Db } from '../db';
import type { AuthUser } from '../auth/auth-context';
import {
  ACTION_KIND,
  ACTION_KINDS,
  ASSIGNEE_TYPE,
  ASSIGNEE_TYPES,
  AUDIT_EVENT,
  AUDIT_VISIBILITY,
  INSTANCE_STATUS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_RECIPIENT_TYPES,
  SLA_CALENDAR_MODE,
  STEP_TYPE,
  STEP_TYPES,
  TARGET_STEP_MODE,
  TARGET_STEP_MODES,
  WORKFLOW_DEFINITION_STATUS,
  WORKFLOW_VERSION_STATUS,
} from '../domain/constants';
import {
  ConflictError,
  NotFoundError,
  StaleDataError,
  ValidationError,
  WorkflowConfigError,
} from '../domain/errors';
import { checkConditionGroup, describeCondition, parseConditionGroup } from '../domain/conditions';
import { writeAudit } from './audit.service';
import { getStatusMap, invalidateCatalogCache } from './catalog.service';
import { tryParseJson } from '../lib/json';

// ---------------------------------------------------------------------------
// Kod normalizasyonu
// ---------------------------------------------------------------------------

function normalizeCode(input: string, fieldLabel: string): string {
  const code = (input ?? '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (code.length < 2) {
    throw new ValidationError(`${fieldLabel} en az 2 karakter olmalıdır.`);
  }
  if (code.length > 50) {
    throw new ValidationError(`${fieldLabel} en fazla 50 karakter olabilir.`);
  }
  return code;
}

function requireText(value: unknown, fieldLabel: string, max = 150): string {
  const text = String(value ?? '').trim();
  if (text.length < 2) throw new ValidationError(`${fieldLabel} zorunludur.`);
  if (text.length > max) {
    throw new ValidationError(`${fieldLabel} en fazla ${max} karakter olabilir.`);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Ortak kontroller
// ---------------------------------------------------------------------------

async function loadVersionOrThrow(versionId: string) {
  const version = await prisma.workflowVersion.findUnique({
    where: { id: versionId },
    include: { definition: true },
  });
  if (!version) throw new NotFoundError('İş akışı sürümü bulunamadı.');
  return version;
}

/** Yayinlanmis versiyon uzerinde degisiklige izin verilmez. */
async function assertDraft(versionId: string, expectedRowVersion?: number) {
  const version = await loadVersionOrThrow(versionId);
  if (version.status !== WORKFLOW_VERSION_STATUS.DRAFT) {
    throw new ConflictError(
      `Bu sürüm ${version.status} durumunda ve doğrudan değiştirilemez. Değişiklik için "Revizyon Oluştur" ile yeni bir taslak sürüm oluşturun.`,
    );
  }
  if (expectedRowVersion !== undefined && version.rowVersion !== expectedRowVersion) {
    throw new StaleDataError(
      'İş akışı taslağı başka bir kullanıcı tarafından güncellendi. Sayfayı yenileyip tekrar deneyin.',
    );
  }
  return version;
}

async function touchVersion(db: Db, versionId: string) {
  await db.workflowVersion.update({
    where: { id: versionId },
    data: { rowVersion: { increment: 1 } },
  });
}

// ---------------------------------------------------------------------------
// Liste ekrani (spec 02 - §4)
// ---------------------------------------------------------------------------

export async function listDefinitions(options: { includeArchived?: boolean } = {}) {
  const rows = await prisma.workflowDefinition.findMany({
    where: options.includeArchived ? {} : { isArchived: false },
    orderBy: { name: 'asc' },
    include: {
      activeVersion: { select: { id: true, versionNumber: true, publishedAt: true } },
      categories: { select: { id: true, code: true, name: true } },
      versions: { select: { id: true, versionNumber: true, status: true } },
    },
  });

  const counts = await prisma.workflowInstance.groupBy({
    by: ['definitionId'],
    where: { status: INSTANCE_STATUS.RUNNING },
    _count: { _all: true },
  });
  const countMap = new Map(counts.map((c) => [c.definitionId, c._count._all]));

  const updaterIds = [...new Set(rows.map((r) => r.updatedById).filter(Boolean))] as string[];
  const updaters = updaterIds.length
    ? await prisma.user.findMany({
        where: { id: { in: updaterIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const updaterMap = new Map(updaters.map((u) => [u.id, u.displayName]));

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    status: r.status,
    categories: r.categories,
    activeVersion: r.activeVersion,
    /** Uzerinde calisilan taslak sürüm varsa. */
    draftVersion:
      r.versions.find((v) => v.status === WORKFLOW_VERSION_STATUS.DRAFT) ?? null,
    versionCount: r.versions.length,
    updatedAt: r.updatedAt,
    updatedByName: r.updatedById ? (updaterMap.get(r.updatedById) ?? null) : null,
    activeInstanceCount: countMap.get(r.id) ?? 0,
  }));
}

export async function listVersions(definitionId: string) {
  const definition = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
  });
  if (!definition) throw new NotFoundError('İş akışı bulunamadı.');

  const versions = await prisma.workflowVersion.findMany({
    where: { definitionId },
    orderBy: { versionNumber: 'desc' },
    include: { _count: { select: { instances: true, steps: true } } },
  });

  const userIds = [
    ...new Set(versions.flatMap((v) => [v.createdById, v.publishedById]).filter(Boolean)),
  ] as string[];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const nameMap = new Map(users.map((u) => [u.id, u.displayName]));

  const runningCounts = await prisma.workflowInstance.groupBy({
    by: ['versionId'],
    where: { definitionId, status: INSTANCE_STATUS.RUNNING },
    _count: { _all: true },
  });
  const runningMap = new Map(runningCounts.map((c) => [c.versionId, c._count._all]));

  return {
    definition: {
      id: definition.id,
      code: definition.code,
      name: definition.name,
      status: definition.status,
      activeVersionId: definition.activeVersionId,
    },
    versions: versions.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      changeDescription: v.changeDescription,
      slaCalendarMode: v.slaCalendarMode,
      createdAt: v.createdAt,
      createdByName: v.createdById ? (nameMap.get(v.createdById) ?? null) : null,
      publishedAt: v.publishedAt,
      publishedByName: v.publishedById ? (nameMap.get(v.publishedById) ?? null) : null,
      stepCount: v._count.steps,
      totalInstanceCount: v._count.instances,
      runningInstanceCount: runningMap.get(v.id) ?? 0,
      isActive: definition.activeVersionId === v.id,
      rowVersion: v.rowVersion,
    })),
  };
}

// ---------------------------------------------------------------------------
// Editor payload (spec 02 - §5, §6)
// ---------------------------------------------------------------------------

export async function getVersionDetail(versionId: string) {
  const version = await prisma.workflowVersion.findUnique({
    where: { id: versionId },
    include: {
      definition: {
        include: { categories: { select: { id: true, code: true, name: true } } },
      },
      steps: {
        orderBy: { sequence: 'asc' },
        include: { actions: { orderBy: { sortOrder: 'asc' } } },
      },
      notificationRules: true,
      _count: { select: { instances: true } },
    },
  });
  if (!version) throw new NotFoundError('İş akışı sürümü bulunamadı.');

  const stepNameById = new Map(version.steps.map((s) => [s.id, s.name]));
  const runningCount = await prisma.workflowInstance.count({
    where: { versionId, status: INSTANCE_STATUS.RUNNING },
  });

  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    changeDescription: version.changeDescription,
    slaCalendarMode: version.slaCalendarMode,
    createdAt: version.createdAt,
    publishedAt: version.publishedAt,
    rowVersion: version.rowVersion,
    isEditable: version.status === WORKFLOW_VERSION_STATUS.DRAFT,
    runningInstanceCount: runningCount,
    totalInstanceCount: version._count.instances,

    definition: {
      id: version.definition.id,
      code: version.definition.code,
      name: version.definition.name,
      description: version.definition.description,
      status: version.definition.status,
      activeVersionId: version.definition.activeVersionId,
      categories: version.definition.categories,
    },

    steps: version.steps.map((s) => {
      const conditionCheck = checkConditionGroup(s.conditionJson);
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        description: s.description,
        type: s.type,
        sequence: s.sequence,
        assigneeType: s.assigneeType,
        assigneeRoleCode: s.assigneeRoleCode,
        assigneeGroupId: s.assigneeGroupId,
        assigneeUserId: s.assigneeUserId,
        statusCode: s.statusCode,
        slaEnabled: s.slaEnabled,
        slaHours: s.slaHours,
        slaReminderHours: s.slaReminderHours,
        slaEscalationHours: s.slaEscalationHours,
        conditionJson: s.conditionJson,
        conditionSummary: conditionCheck.valid
          ? describeCondition(
              s.conditionJson ? tryParseJson(s.conditionJson, null) : null,
            )
          : 'Geçersiz koşul',
        conditionValid: conditionCheck.valid,
        isActive: s.isActive,
        actions: s.actions.map((a) => ({
          id: a.id,
          code: a.code,
          name: a.name,
          kind: a.kind,
          targetStepMode: a.targetStepMode,
          targetStepId: a.targetStepId,
          targetStepName: a.targetStepId ? (stepNameById.get(a.targetStepId) ?? null) : null,
          targetStatusCode: a.targetStatusCode,
          commentRequired: a.commentRequired,
          confirmationRequired: a.confirmationRequired,
          notify: a.notify,
          variant: a.variant,
          sortOrder: a.sortOrder,
          isActive: a.isActive,
        })),
      };
    }),

    notificationRules: version.notificationRules.map((r) => ({
      id: r.id,
      event: r.event,
      recipientType: r.recipientType,
      recipientRoleCode: r.recipientRoleCode,
      recipientGroupId: r.recipientGroupId,
      channel: r.channel,
      isActive: r.isActive,
    })),
  };
}

// ---------------------------------------------------------------------------
// Definition olusturma / kopyalama / durum
// ---------------------------------------------------------------------------

export interface CreateDefinitionInput {
  code: string;
  name: string;
  description?: string | null;
  /** Bos ise iskelet adimlar olusturulmaz. */
  useStarterTemplate?: boolean;
}

export async function createDefinition(user: AuthUser, input: CreateDefinitionInput) {
  const code = normalizeCode(input.code, 'İş akışı kodu');
  const name = requireText(input.name, 'İş akışı adı');

  const existing = await prisma.workflowDefinition.findUnique({ where: { code } });
  if (existing) {
    throw new ConflictError(`"${code}" kodlu bir iş akışı zaten var.`);
  }

  return prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;

    const definition = await tx.workflowDefinition.create({
      data: {
        code,
        name,
        description: input.description?.trim() || null,
        status: WORKFLOW_DEFINITION_STATUS.DRAFT,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const version = await tx.workflowVersion.create({
      data: {
        definitionId: definition.id,
        versionNumber: 1,
        status: WORKFLOW_VERSION_STATUS.DRAFT,
        changeDescription: 'İlk sürüm',
        createdById: user.id,
      },
    });

    if (input.useStarterTemplate !== false) {
      await createStarterSteps(tx, version.id);
      await createDefaultNotificationRules(tx, version.id);
    }

    await writeAudit(tx, {
      eventType: AUDIT_EVENT.WORKFLOW_CREATED,
      actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
      workflowVersionId: version.id,
      workflowVersionNumber: 1,
      newValue: `${name} (${code})`,
      description: `Yeni iş akışı oluşturuldu: ${name}`,
      visibility: AUDIT_VISIBILITY.ADMIN,
      metadata: { definitionId: definition.id },
    });

    return { definitionId: definition.id, versionId: version.id };
  });
}

/** Yeni workflow icin makul bir baslangic iskeleti (Start / Approval / Review / End). */
async function createStarterSteps(db: Db, versionId: string) {
  const start = await db.workflowStep.create({
    data: {
      versionId,
      code: 'TALEP_OLUSTURMA',
      name: 'Talep Oluşturma',
      type: STEP_TYPE.START,
      sequence: 1,
      assigneeType: ASSIGNEE_TYPE.REQUESTER,
      statusCode: 'DRAFT',
    },
  });
  const hrReview = await db.workflowStep.create({
    data: {
      versionId,
      code: 'HR_KONTROL',
      name: 'İK Kontrol',
      type: STEP_TYPE.REVIEW,
      sequence: 2,
      assigneeType: ASSIGNEE_TYPE.HR_USER,
      statusCode: 'HR_REVIEW',
      slaEnabled: true,
      slaHours: 72,
    },
  });
  const end = await db.workflowStep.create({
    data: {
      versionId,
      code: 'TAMAMLANDI',
      name: 'Tamamlandı',
      type: STEP_TYPE.END,
      sequence: 3,
      assigneeType: ASSIGNEE_TYPE.HR_USER,
      statusCode: 'COMPLETED',
    },
  });

  await db.workflowAction.createMany({
    data: [
      {
        stepId: start.id,
        code: 'GONDER',
        name: 'Gönder',
        kind: ACTION_KIND.SUBMIT,
        targetStepMode: TARGET_STEP_MODE.NEXT,
        targetStatusCode: null,
        variant: 'PRIMARY',
        sortOrder: 1,
      },
      {
        stepId: hrReview.id,
        code: 'TAMAMLA',
        name: 'Tamamla',
        kind: ACTION_KIND.COMPLETE,
        targetStepMode: TARGET_STEP_MODE.NEXT,
        targetStatusCode: 'COMPLETED',
        variant: 'PRIMARY',
        sortOrder: 1,
      },
      {
        stepId: hrReview.id,
        code: 'REDDET',
        name: 'Reddet',
        kind: ACTION_KIND.REJECT,
        targetStepMode: TARGET_STEP_MODE.END,
        targetStatusCode: 'REJECTED',
        commentRequired: true,
        confirmationRequired: true,
        variant: 'DANGER',
        sortOrder: 2,
      },
    ],
  });

  void end;
}

async function createDefaultNotificationRules(db: Db, versionId: string) {
  await db.notificationRule.createMany({
    data: [
      { versionId, event: 'STEP_STARTED', recipientType: 'CURRENT_ASSIGNEE' },
      { versionId, event: 'APPROVED', recipientType: 'REQUESTER' },
      { versionId, event: 'REJECTED', recipientType: 'REQUESTER' },
      { versionId, event: 'COMPLETED', recipientType: 'REQUESTER' },
      { versionId, event: 'INFO_REQUESTED', recipientType: 'REQUESTER' },
      { versionId, event: 'SLA_WARNING', recipientType: 'CURRENT_ASSIGNEE' },
      { versionId, event: 'SLA_BREACH', recipientType: 'CURRENT_ASSIGNEE' },
      { versionId, event: 'ADMIN_OVERRIDE', recipientType: 'CURRENT_ASSIGNEE' },
    ],
  });
}

/**
 * Revizyon olustur: aktif (yoksa en yuksek numarali) versiyonu derin kopyalar.
 * Kaynak versiyon HIC DEGISMEZ; production onun uzerinde calismaya devam eder.
 */
export async function createRevision(
  user: AuthUser,
  definitionId: string,
  input: { changeDescription?: string | null } = {},
) {
  const definition = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
    include: { versions: { orderBy: { versionNumber: 'desc' } } },
  });
  if (!definition) throw new NotFoundError('İş akışı bulunamadı.');

  const existingDraft = definition.versions.find(
    (v) => v.status === WORKFLOW_VERSION_STATUS.DRAFT,
  );
  if (existingDraft) {
    throw new ConflictError(
      `Bu iş akışında zaten yayınlanmamış bir taslak sürüm var (v${existingDraft.versionNumber}). Önce onu yayınlayın veya silin.`,
    );
  }

  const source =
    definition.versions.find((v) => v.id === definition.activeVersionId) ??
    definition.versions[0];
  if (!source) {
    throw new WorkflowConfigError('Kopyalanacak bir sürüm bulunamadı.');
  }

  const nextNumber = Math.max(...definition.versions.map((v) => v.versionNumber)) + 1;

  return prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;

    const newVersion = await tx.workflowVersion.create({
      data: {
        definitionId,
        versionNumber: nextNumber,
        status: WORKFLOW_VERSION_STATUS.DRAFT,
        changeDescription:
          input.changeDescription?.trim() || `v${source.versionNumber} sürümünden revizyon`,
        createdById: user.id,
        slaCalendarMode: source.slaCalendarMode,
      },
    });

    await copyVersionContents(tx, source.id, newVersion.id);

    await tx.workflowDefinition.update({
      where: { id: definitionId },
      data: { updatedById: user.id },
    });

    await writeAudit(tx, {
      eventType: AUDIT_EVENT.WORKFLOW_REVISION_CREATED,
      actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
      workflowVersionId: newVersion.id,
      workflowVersionNumber: nextNumber,
      oldValue: `v${source.versionNumber}`,
      newValue: `v${nextNumber}`,
      description: `${definition.name} için v${nextNumber} taslak sürümü oluşturuldu (kaynak: v${source.versionNumber}). Mevcut sürüm değişmedi.`,
      visibility: AUDIT_VISIBILITY.ADMIN,
      metadata: { definitionId },
    });

    return { versionId: newVersion.id, versionNumber: nextNumber };
  });
}

/** Adim + aksiyon + bildirim kurallarini yeni versiyona kopyalar, hedefleri remap eder. */
async function copyVersionContents(db: Db, sourceVersionId: string, targetVersionId: string) {
  const steps = await db.workflowStep.findMany({
    where: { versionId: sourceVersionId },
    orderBy: { sequence: 'asc' },
    include: { actions: { orderBy: { sortOrder: 'asc' } } },
  });

  const idMap = new Map<string, string>();

  for (const step of steps) {
    const created = await db.workflowStep.create({
      data: {
        versionId: targetVersionId,
        code: step.code,
        name: step.name,
        description: step.description,
        type: step.type,
        sequence: step.sequence,
        assigneeType: step.assigneeType,
        assigneeRoleCode: step.assigneeRoleCode,
        assigneeGroupId: step.assigneeGroupId,
        assigneeUserId: step.assigneeUserId,
        statusCode: step.statusCode,
        slaEnabled: step.slaEnabled,
        slaHours: step.slaHours,
        slaReminderHours: step.slaReminderHours,
        slaEscalationHours: step.slaEscalationHours,
        conditionJson: step.conditionJson,
        isActive: step.isActive,
      },
    });
    idMap.set(step.id, created.id);
  }

  for (const step of steps) {
    for (const action of step.actions) {
      await db.workflowAction.create({
        data: {
          stepId: idMap.get(step.id)!,
          code: action.code,
          name: action.name,
          kind: action.kind,
          targetStepMode: action.targetStepMode,
          // Hedef adim yeni versiyondaki karsiligina baglanir.
          targetStepId: action.targetStepId ? (idMap.get(action.targetStepId) ?? null) : null,
          targetStatusCode: action.targetStatusCode,
          commentRequired: action.commentRequired,
          confirmationRequired: action.confirmationRequired,
          notify: action.notify,
          notifyRolesJson: action.notifyRolesJson,
          variant: action.variant,
          sortOrder: action.sortOrder,
          isActive: action.isActive,
        },
      });
    }
  }

  const rules = await db.notificationRule.findMany({ where: { versionId: sourceVersionId } });
  for (const rule of rules) {
    await db.notificationRule.create({
      data: {
        versionId: targetVersionId,
        event: rule.event,
        recipientType: rule.recipientType,
        recipientRoleCode: rule.recipientRoleCode,
        recipientGroupId: rule.recipientGroupId,
        channel: rule.channel,
        isActive: rule.isActive,
      },
    });
  }
}

/** Workflow'u komple kopyalar (yeni kod ile bagimsiz definition). */
export async function copyDefinition(
  user: AuthUser,
  definitionId: string,
  input: { code: string; name: string },
) {
  const source = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
    include: { versions: { orderBy: { versionNumber: 'desc' } } },
  });
  if (!source) throw new NotFoundError('İş akışı bulunamadı.');

  const code = normalizeCode(input.code, 'İş akışı kodu');
  const name = requireText(input.name, 'İş akışı adı');
  if (await prisma.workflowDefinition.findUnique({ where: { code } })) {
    throw new ConflictError(`"${code}" kodlu bir iş akışı zaten var.`);
  }

  const sourceVersion =
    source.versions.find((v) => v.id === source.activeVersionId) ?? source.versions[0];
  if (!sourceVersion) throw new WorkflowConfigError('Kopyalanacak sürüm bulunamadı.');

  return prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const definition = await tx.workflowDefinition.create({
      data: {
        code,
        name,
        description: source.description,
        status: WORKFLOW_DEFINITION_STATUS.DRAFT,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    const version = await tx.workflowVersion.create({
      data: {
        definitionId: definition.id,
        versionNumber: 1,
        status: WORKFLOW_VERSION_STATUS.DRAFT,
        changeDescription: `${source.name} kopyalandı`,
        createdById: user.id,
        slaCalendarMode: sourceVersion.slaCalendarMode,
      },
    });
    await copyVersionContents(tx, sourceVersion.id, version.id);

    await writeAudit(tx, {
      eventType: AUDIT_EVENT.WORKFLOW_CREATED,
      actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
      workflowVersionId: version.id,
      workflowVersionNumber: 1,
      newValue: `${name} (${code})`,
      description: `${source.name} iş akışı kopyalanarak ${name} oluşturuldu.`,
      visibility: AUDIT_VISIBILITY.ADMIN,
      metadata: { definitionId: definition.id, sourceDefinitionId: definitionId },
    });

    return { definitionId: definition.id, versionId: version.id };
  });
}

// ---------------------------------------------------------------------------
// Versiyon basligi
// ---------------------------------------------------------------------------

export async function updateVersionHeader(
  user: AuthUser,
  versionId: string,
  input: {
    changeDescription?: string | null;
    slaCalendarMode?: string | null;
    expectedRowVersion: number;
  },
) {
  await assertDraft(versionId, input.expectedRowVersion);

  if (
    input.slaCalendarMode &&
    !Object.values(SLA_CALENDAR_MODE).includes(input.slaCalendarMode as never)
  ) {
    throw new ValidationError('Geçersiz SLA takvim modu.');
  }

  const updated = await prisma.workflowVersion.update({
    where: { id: versionId },
    data: {
      changeDescription:
        input.changeDescription !== undefined
          ? input.changeDescription?.trim() || null
          : undefined,
      slaCalendarMode: input.slaCalendarMode ?? undefined,
      rowVersion: { increment: 1 },
    },
  });
  return { rowVersion: updated.rowVersion };
}

export async function updateDefinitionHeader(
  user: AuthUser,
  definitionId: string,
  input: { name?: string; description?: string | null },
) {
  const definition = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
  });
  if (!definition) throw new NotFoundError('İş akışı bulunamadı.');

  const updated = await prisma.workflowDefinition.update({
    where: { id: definitionId },
    data: {
      name: input.name !== undefined ? requireText(input.name, 'İş akışı adı') : undefined,
      description:
        input.description !== undefined ? input.description?.trim() || null : undefined,
      updatedById: user.id,
    },
  });

  await writeAudit(prisma, {
    eventType: AUDIT_EVENT.WORKFLOW_UPDATED,
    actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
    description: `İş akışı bilgileri güncellendi: ${updated.name}`,
    visibility: AUDIT_VISIBILITY.ADMIN,
    metadata: { definitionId },
  });

  return { id: updated.id, name: updated.name };
}

// ---------------------------------------------------------------------------
// Adim yonetimi (spec 02 - §5, §6)
// ---------------------------------------------------------------------------

export interface StepInput {
  code: string;
  name: string;
  description?: string | null;
  type: string;
  assigneeType: string;
  assigneeRoleCode?: string | null;
  assigneeGroupId?: string | null;
  assigneeUserId?: string | null;
  statusCode: string;
  slaEnabled?: boolean;
  slaHours?: number | null;
  slaReminderHours?: number | null;
  slaEscalationHours?: number | null;
  condition?: unknown;
  isActive?: boolean;
}

async function validateStepInput(input: StepInput) {
  if (!STEP_TYPES.includes(input.type as never)) {
    throw new ValidationError(`Geçersiz adım tipi: ${input.type}`);
  }
  if (!ASSIGNEE_TYPES.includes(input.assigneeType as never)) {
    throw new ValidationError(`Geçersiz sorumlu tipi: ${input.assigneeType}`);
  }

  const statuses = await getStatusMap();
  if (!statuses.has(input.statusCode)) {
    throw new ValidationError(`Tanımsız talep durumu: ${input.statusCode}`);
  }

  if (input.assigneeType === ASSIGNEE_TYPE.ROLE && !input.assigneeRoleCode) {
    throw new ValidationError('Rol bazlı adım için rol seçilmelidir.');
  }
  if (input.assigneeType === ASSIGNEE_TYPE.GROUP && !input.assigneeGroupId) {
    throw new ValidationError('Grup bazlı adım için grup seçilmelidir.');
  }
  if (input.assigneeType === ASSIGNEE_TYPE.USER && !input.assigneeUserId) {
    throw new ValidationError('Kullanıcı bazlı adım için kullanıcı seçilmelidir.');
  }

  if (input.slaEnabled && (!input.slaHours || input.slaHours <= 0)) {
    throw new ValidationError('SLA açıkken hedef süre saat cinsinden girilmelidir.');
  }
  if (input.slaHours !== null && input.slaHours !== undefined && input.slaHours > 8760) {
    throw new ValidationError('SLA süresi en fazla 8760 saat (1 yıl) olabilir.');
  }

  // Kosul yapisal olarak dogrulanir (arbitrary kod kabul edilmez).
  let conditionJson: string | null = null;
  if (input.condition !== undefined && input.condition !== null) {
    const group = parseConditionGroup(
      typeof input.condition === 'string' ? input.condition : JSON.stringify(input.condition),
    );
    conditionJson = group ? JSON.stringify(group) : null;
  }
  return { conditionJson };
}

export async function addStep(
  user: AuthUser,
  versionId: string,
  input: StepInput & { expectedRowVersion: number },
) {
  await assertDraft(versionId, input.expectedRowVersion);
  const code = normalizeCode(input.code, 'Adım kodu');
  const name = requireText(input.name, 'Adım adı');
  const { conditionJson } = await validateStepInput(input);

  const duplicate = await prisma.workflowStep.findFirst({ where: { versionId, code } });
  if (duplicate) {
    throw new ConflictError(`"${code}" kodlu bir adım bu sürümde zaten var.`);
  }

  const last = await prisma.workflowStep.findFirst({
    where: { versionId },
    orderBy: { sequence: 'desc' },
  });
  const sequence = (last?.sequence ?? 0) + 1;

  const step = await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const created = await tx.workflowStep.create({
      data: {
        versionId,
        code,
        name,
        description: input.description?.trim() || null,
        type: input.type,
        sequence,
        assigneeType: input.assigneeType,
        assigneeRoleCode: input.assigneeRoleCode ?? null,
        assigneeGroupId: input.assigneeGroupId ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        statusCode: input.statusCode,
        slaEnabled: input.slaEnabled ?? false,
        slaHours: input.slaHours ?? null,
        slaReminderHours: input.slaReminderHours ?? null,
        slaEscalationHours: input.slaEscalationHours ?? null,
        conditionJson,
        isActive: input.isActive ?? true,
      },
    });
    await touchVersion(tx, versionId);
    return created;
  });

  return { id: step.id, sequence: step.sequence };
}

export async function updateStep(
  user: AuthUser,
  stepId: string,
  input: Partial<StepInput> & { expectedRowVersion: number },
) {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } });
  if (!step) throw new NotFoundError('Adım bulunamadı.');
  await assertDraft(step.versionId, input.expectedRowVersion);

  const merged: StepInput = {
    code: input.code ?? step.code,
    name: input.name ?? step.name,
    description: input.description !== undefined ? input.description : step.description,
    type: input.type ?? step.type,
    assigneeType: input.assigneeType ?? step.assigneeType,
    assigneeRoleCode:
      input.assigneeRoleCode !== undefined ? input.assigneeRoleCode : step.assigneeRoleCode,
    assigneeGroupId:
      input.assigneeGroupId !== undefined ? input.assigneeGroupId : step.assigneeGroupId,
    assigneeUserId:
      input.assigneeUserId !== undefined ? input.assigneeUserId : step.assigneeUserId,
    statusCode: input.statusCode ?? step.statusCode,
    slaEnabled: input.slaEnabled ?? step.slaEnabled,
    slaHours: input.slaHours !== undefined ? input.slaHours : step.slaHours,
    slaReminderHours:
      input.slaReminderHours !== undefined ? input.slaReminderHours : step.slaReminderHours,
    slaEscalationHours:
      input.slaEscalationHours !== undefined
        ? input.slaEscalationHours
        : step.slaEscalationHours,
    condition: input.condition,
    isActive: input.isActive ?? step.isActive,
  };

  const code = normalizeCode(merged.code, 'Adım kodu');
  const name = requireText(merged.name, 'Adım adı');
  const { conditionJson } = await validateStepInput(merged);

  if (code !== step.code) {
    const dup = await prisma.workflowStep.findFirst({
      where: { versionId: step.versionId, code, id: { not: stepId } },
    });
    if (dup) throw new ConflictError(`"${code}" kodlu bir adım bu sürümde zaten var.`);
  }

  // Sorumlu tipi degistiyse artik gecersiz olan alanlari temizle.
  const clearRole = merged.assigneeType !== ASSIGNEE_TYPE.ROLE;
  const clearGroup = merged.assigneeType !== ASSIGNEE_TYPE.GROUP;
  const clearUser = merged.assigneeType !== ASSIGNEE_TYPE.USER;

  await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx.workflowStep.update({
      where: { id: stepId },
      data: {
        code,
        name,
        description: merged.description?.trim() || null,
        type: merged.type,
        assigneeType: merged.assigneeType,
        assigneeRoleCode: clearRole ? null : (merged.assigneeRoleCode ?? null),
        assigneeGroupId: clearGroup ? null : (merged.assigneeGroupId ?? null),
        assigneeUserId: clearUser ? null : (merged.assigneeUserId ?? null),
        statusCode: merged.statusCode,
        slaEnabled: merged.slaEnabled ?? false,
        slaHours: merged.slaHours ?? null,
        slaReminderHours: merged.slaReminderHours ?? null,
        slaEscalationHours: merged.slaEscalationHours ?? null,
        // condition alani gonderilmediyse mevcut deger korunur.
        ...(input.condition !== undefined ? { conditionJson } : {}),
        isActive: merged.isActive ?? true,
      },
    });
    await touchVersion(tx, step.versionId);
  });

  return { id: stepId };
}

export async function deleteStep(
  user: AuthUser,
  stepId: string,
  input: { expectedRowVersion: number },
) {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } });
  if (!step) throw new NotFoundError('Adım bulunamadı.');
  await assertDraft(step.versionId, input.expectedRowVersion);

  // Baska adimlarin bu adima isaret eden aksiyonlari varsa engelle.
  const referencing = await prisma.workflowAction.findMany({
    where: { targetStepId: stepId },
    include: { step: { select: { name: true } } },
  });
  if (referencing.length > 0) {
    const names = [...new Set(referencing.map((r) => r.step.name))].join(', ');
    throw new ConflictError(
      `Bu adım silinemez; şu adımların aksiyonları buraya yönleniyor: ${names}. Önce o aksiyonların hedefini değiştirin.`,
    );
  }

  await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx.workflowStep.delete({ where: { id: stepId } });
    // Sira numaralarini sikistir.
    const remaining = await tx.workflowStep.findMany({
      where: { versionId: step.versionId },
      orderBy: { sequence: 'asc' },
    });
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].sequence !== i + 1) {
        await tx.workflowStep.update({
          where: { id: remaining[i].id },
          data: { sequence: i + 1 },
        });
      }
    }
    await touchVersion(tx, step.versionId);
  });

  return { id: stepId };
}

/** Adimi yukari/asagi tasir (spec 02 - up/down aksiyonlari). */
export async function moveStep(
  user: AuthUser,
  stepId: string,
  input: { direction: 'up' | 'down'; expectedRowVersion: number },
) {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } });
  if (!step) throw new NotFoundError('Adım bulunamadı.');
  await assertDraft(step.versionId, input.expectedRowVersion);

  const siblings = await prisma.workflowStep.findMany({
    where: { versionId: step.versionId },
    orderBy: { sequence: 'asc' },
  });
  const index = siblings.findIndex((s) => s.id === stepId);
  const targetIndex = input.direction === 'up' ? index - 1 : index + 1;

  if (targetIndex < 0 || targetIndex >= siblings.length) {
    throw new ValidationError('Adım bu yönde daha fazla taşınamaz.');
  }

  const other = siblings[targetIndex];

  await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    // sequence uzerinde unique kisit yok; dogrudan takas guvenli.
    await tx.workflowStep.update({
      where: { id: step.id },
      data: { sequence: other.sequence },
    });
    await tx.workflowStep.update({
      where: { id: other.id },
      data: { sequence: step.sequence },
    });
    await touchVersion(tx, step.versionId);
  });

  return { id: stepId, newSequence: other.sequence };
}

// ---------------------------------------------------------------------------
// Aksiyon yonetimi
// ---------------------------------------------------------------------------

export interface ActionInput {
  code: string;
  name: string;
  kind: string;
  targetStepMode: string;
  targetStepId?: string | null;
  targetStatusCode?: string | null;
  commentRequired?: boolean;
  confirmationRequired?: boolean;
  notify?: boolean;
  variant?: string;
  isActive?: boolean;
}

async function validateActionInput(versionId: string, input: ActionInput) {
  if (!ACTION_KINDS.includes(input.kind as never)) {
    throw new ValidationError(`Geçersiz aksiyon tipi: ${input.kind}`);
  }
  if (!TARGET_STEP_MODES.includes(input.targetStepMode as never)) {
    throw new ValidationError(`Geçersiz hedef modu: ${input.targetStepMode}`);
  }
  if (input.targetStepMode === TARGET_STEP_MODE.SPECIFIC) {
    if (!input.targetStepId) {
      throw new ValidationError('Belirli adım hedefi için adım seçilmelidir.');
    }
    const target = await prisma.workflowStep.findFirst({
      where: { id: input.targetStepId, versionId },
    });
    if (!target) {
      throw new ValidationError('Hedef adım bu sürümde bulunamadı.');
    }
  }
  if (input.targetStatusCode) {
    const statuses = await getStatusMap();
    if (!statuses.has(input.targetStatusCode)) {
      throw new ValidationError(`Tanımsız hedef durum: ${input.targetStatusCode}`);
    }
  }
}

export async function addAction(
  user: AuthUser,
  stepId: string,
  input: ActionInput & { expectedRowVersion: number },
) {
  const step = await prisma.workflowStep.findUnique({ where: { id: stepId } });
  if (!step) throw new NotFoundError('Adım bulunamadı.');
  await assertDraft(step.versionId, input.expectedRowVersion);

  const code = normalizeCode(input.code, 'Aksiyon kodu');
  const name = requireText(input.name, 'Aksiyon adı', 60);
  await validateActionInput(step.versionId, input);

  if (await prisma.workflowAction.findFirst({ where: { stepId, code } })) {
    throw new ConflictError(`"${code}" kodlu bir aksiyon bu adımda zaten var.`);
  }

  const last = await prisma.workflowAction.findFirst({
    where: { stepId },
    orderBy: { sortOrder: 'desc' },
  });

  const action = await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    const created = await tx.workflowAction.create({
      data: {
        stepId,
        code,
        name,
        kind: input.kind,
        targetStepMode: input.targetStepMode,
        targetStepId:
          input.targetStepMode === TARGET_STEP_MODE.SPECIFIC
            ? (input.targetStepId ?? null)
            : null,
        targetStatusCode: input.targetStatusCode ?? null,
        commentRequired: input.commentRequired ?? false,
        confirmationRequired: input.confirmationRequired ?? false,
        notify: input.notify ?? true,
        variant: input.variant ?? 'DEFAULT',
        sortOrder: (last?.sortOrder ?? 0) + 1,
        isActive: input.isActive ?? true,
      },
    });
    await touchVersion(tx, step.versionId);
    return created;
  });

  return { id: action.id };
}

export async function updateAction(
  user: AuthUser,
  actionId: string,
  input: Partial<ActionInput> & { expectedRowVersion: number },
) {
  const action = await prisma.workflowAction.findUnique({
    where: { id: actionId },
    include: { step: true },
  });
  if (!action) throw new NotFoundError('Aksiyon bulunamadı.');
  await assertDraft(action.step.versionId, input.expectedRowVersion);

  const merged: ActionInput = {
    code: input.code ?? action.code,
    name: input.name ?? action.name,
    kind: input.kind ?? action.kind,
    targetStepMode: input.targetStepMode ?? action.targetStepMode,
    targetStepId:
      input.targetStepId !== undefined ? input.targetStepId : action.targetStepId,
    targetStatusCode:
      input.targetStatusCode !== undefined ? input.targetStatusCode : action.targetStatusCode,
    commentRequired: input.commentRequired ?? action.commentRequired,
    confirmationRequired: input.confirmationRequired ?? action.confirmationRequired,
    notify: input.notify ?? action.notify,
    variant: input.variant ?? action.variant,
    isActive: input.isActive ?? action.isActive,
  };

  const code = normalizeCode(merged.code, 'Aksiyon kodu');
  const name = requireText(merged.name, 'Aksiyon adı', 60);
  await validateActionInput(action.step.versionId, merged);

  if (code !== action.code) {
    const dup = await prisma.workflowAction.findFirst({
      where: { stepId: action.stepId, code, id: { not: actionId } },
    });
    if (dup) throw new ConflictError(`"${code}" kodlu bir aksiyon bu adımda zaten var.`);
  }

  await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx.workflowAction.update({
      where: { id: actionId },
      data: {
        code,
        name,
        kind: merged.kind,
        targetStepMode: merged.targetStepMode,
        targetStepId:
          merged.targetStepMode === TARGET_STEP_MODE.SPECIFIC
            ? (merged.targetStepId ?? null)
            : null,
        targetStatusCode: merged.targetStatusCode ?? null,
        commentRequired: merged.commentRequired ?? false,
        confirmationRequired: merged.confirmationRequired ?? false,
        notify: merged.notify ?? true,
        variant: merged.variant ?? 'DEFAULT',
        isActive: merged.isActive ?? true,
      },
    });
    await touchVersion(tx, action.step.versionId);
  });

  return { id: actionId };
}

export async function deleteAction(
  user: AuthUser,
  actionId: string,
  input: { expectedRowVersion: number },
) {
  const action = await prisma.workflowAction.findUnique({
    where: { id: actionId },
    include: { step: true },
  });
  if (!action) throw new NotFoundError('Aksiyon bulunamadı.');
  await assertDraft(action.step.versionId, input.expectedRowVersion);

  await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx.workflowAction.delete({ where: { id: actionId } });
    await touchVersion(tx, action.step.versionId);
  });

  return { id: actionId };
}

// ---------------------------------------------------------------------------
// Bildirim kurallari (spec 02 - §11)
// ---------------------------------------------------------------------------

export async function setNotificationRules(
  user: AuthUser,
  versionId: string,
  input: {
    rules: Array<{
      event: string;
      recipientType: string;
      recipientRoleCode?: string | null;
      recipientGroupId?: string | null;
      channel?: string;
      isActive?: boolean;
    }>;
    expectedRowVersion: number;
  },
) {
  await assertDraft(versionId, input.expectedRowVersion);

  for (const rule of input.rules) {
    if (!NOTIFICATION_EVENTS.includes(rule.event as never)) {
      throw new ValidationError(`Geçersiz bildirim olayı: ${rule.event}`);
    }
    if (!NOTIFICATION_RECIPIENT_TYPES.includes(rule.recipientType as never)) {
      throw new ValidationError(`Geçersiz alıcı tipi: ${rule.recipientType}`);
    }
    if (rule.recipientType === 'ROLE' && !rule.recipientRoleCode) {
      throw new ValidationError('Rol alıcısı için rol seçilmelidir.');
    }
    if (rule.recipientType === 'GROUP' && !rule.recipientGroupId) {
      throw new ValidationError('Grup alıcısı için grup seçilmelidir.');
    }
  }

  await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;
    await tx.notificationRule.deleteMany({ where: { versionId } });
    if (input.rules.length > 0) {
      await tx.notificationRule.createMany({
        data: input.rules.map((r) => ({
          versionId,
          event: r.event,
          recipientType: r.recipientType,
          recipientRoleCode: r.recipientRoleCode ?? null,
          recipientGroupId: r.recipientGroupId ?? null,
          channel: r.channel ?? 'IN_APP',
          isActive: r.isActive ?? true,
        })),
      });
    }
    await touchVersion(tx, versionId);
  });

  return { count: input.rules.length };
}

// ---------------------------------------------------------------------------
// Validation (spec 02 - §12)
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  severity: 'ERROR' | 'WARNING';
  code: string;
  message: string;
  stepId?: string;
  stepName?: string;
  actionId?: string;
}

export async function validateVersion(versionId: string): Promise<{
  valid: boolean;
  canPublish: boolean;
  issues: ValidationIssue[];
}> {
  const version = await prisma.workflowVersion.findUnique({
    where: { id: versionId },
    include: {
      steps: {
        orderBy: { sequence: 'asc' },
        include: { actions: true },
      },
    },
  });
  if (!version) throw new NotFoundError('İş akışı sürümü bulunamadı.');

  const issues: ValidationIssue[] = [];
  const statuses = await getStatusMap();
  const steps = version.steps;

  const err = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ severity: 'ERROR', code, message, ...extra });
  const warn = (code: string, message: string, extra: Partial<ValidationIssue> = {}) =>
    issues.push({ severity: 'WARNING', code, message, ...extra });

  if (steps.length === 0) {
    err('NO_STEPS', 'İş akışında hiç adım tanımlanmamış.');
  }

  // 1) Baslangic adimi
  const startSteps = steps.filter((s) => s.type === STEP_TYPE.START);
  if (startSteps.length === 0) {
    err('NO_START', 'Başlangıç (Start) adımı tanımlanmamış.');
  } else if (startSteps.length > 1) {
    err('MULTIPLE_START', 'Birden fazla başlangıç adımı var; yalnızca bir tane olmalıdır.');
  } else {
    if (startSteps[0].sequence !== 1) {
      warn('START_NOT_FIRST', 'Başlangıç adımı ilk sırada değil.', {
        stepId: startSteps[0].id,
        stepName: startSteps[0].name,
      });
    }
    const hasSubmit = startSteps[0].actions.some(
      (a) => a.isActive && a.kind === ACTION_KIND.SUBMIT,
    );
    if (!hasSubmit) {
      err('START_NO_SUBMIT', 'Başlangıç adımında gönderme (Submit) aksiyonu tanımlanmamış.', {
        stepId: startSteps[0].id,
        stepName: startSteps[0].name,
      });
    }
  }

  // 2) Bitis adimi
  const endSteps = steps.filter((s) => s.type === STEP_TYPE.END);
  if (endSteps.length === 0) {
    err('NO_END', 'Bitiş (End) adımı tanımlanmamış.');
  }

  // 3) Sira gecerliligi
  const sequences = steps.map((s) => s.sequence);
  const uniqueSequences = new Set(sequences);
  if (uniqueSequences.size !== sequences.length) {
    err('DUPLICATE_SEQUENCE', 'Aynı sıra numarasına sahip birden fazla adım var.');
  }
  if (sequences.some((s) => s <= 0)) {
    err('INVALID_SEQUENCE', 'Adım sıra numaraları 1 ve üzeri olmalıdır.');
  }

  // 4) Duplicate step code
  const codeCounts = new Map<string, number>();
  for (const step of steps) {
    codeCounts.set(step.code, (codeCounts.get(step.code) ?? 0) + 1);
  }
  for (const [code, count] of codeCounts) {
    if (count > 1) {
      err('DUPLICATE_STEP_CODE', `"${code}" adım kodu ${count} kez kullanılmış.`);
    }
  }

  const lastSequence = steps.length > 0 ? Math.max(...sequences) : 0;

  for (const step of steps) {
    // 5) Approval adiminda sorumlu
    if (step.type === STEP_TYPE.APPROVAL || step.type === STEP_TYPE.REVIEW) {
      const missing =
        (step.assigneeType === ASSIGNEE_TYPE.ROLE && !step.assigneeRoleCode) ||
        (step.assigneeType === ASSIGNEE_TYPE.GROUP && !step.assigneeGroupId) ||
        (step.assigneeType === ASSIGNEE_TYPE.USER && !step.assigneeUserId);
      if (missing) {
        err('APPROVAL_NO_ASSIGNEE', `"${step.name}" adımının sorumlusu belirlenmemiş.`, {
          stepId: step.id,
          stepName: step.name,
        });
      }
    }

    // 6) Adim durumu tanimli mi
    if (!statuses.has(step.statusCode)) {
      err('INVALID_STEP_STATUS', `"${step.name}" adımında tanımsız durum: ${step.statusCode}`, {
        stepId: step.id,
        stepName: step.name,
      });
    }

    // 7) Kosul gecerliligi
    const conditionCheck = checkConditionGroup(step.conditionJson);
    if (!conditionCheck.valid) {
      err('INVALID_CONDITION', `"${step.name}" adımının koşulu geçersiz: ${conditionCheck.message}`, {
        stepId: step.id,
        stepName: step.name,
      });
    }

    // 8) SLA tutarliligi
    if (step.slaEnabled && !step.slaHours) {
      err('SLA_WITHOUT_HOURS', `"${step.name}" adımında SLA açık ama süre girilmemiş.`, {
        stepId: step.id,
        stepName: step.name,
      });
    }
    if (step.slaReminderHours && step.slaHours && step.slaReminderHours >= step.slaHours) {
      warn(
        'REMINDER_AFTER_DUE',
        `"${step.name}" adımında hatırlatma süresi SLA süresinden kısa olmalıdır.`,
        { stepId: step.id, stepName: step.name },
      );
    }

    const activeActions = step.actions.filter((a) => a.isActive);

    // 9) Aksiyonsuz ara adim
    if (step.type !== STEP_TYPE.END && activeActions.length === 0) {
      err('NO_ACTIONS', `"${step.name}" adımında hiç aktif aksiyon yok; akış burada tıkanır.`, {
        stepId: step.id,
        stepName: step.name,
      });
    }

    // 10) Hedefsiz aksiyon
    const actionCodes = new Map<string, number>();
    for (const action of activeActions) {
      actionCodes.set(action.code, (actionCodes.get(action.code) ?? 0) + 1);

      if (action.targetStepMode === TARGET_STEP_MODE.SPECIFIC && !action.targetStepId) {
        err(
          'ACTION_NO_TARGET',
          `"${step.name}" adımındaki "${action.name}" aksiyonunun hedef adımı seçilmemiş.`,
          { stepId: step.id, stepName: step.name, actionId: action.id },
        );
      }
      if (action.targetStepId && !steps.some((s) => s.id === action.targetStepId)) {
        err(
          'ACTION_TARGET_MISSING',
          `"${step.name}" adımındaki "${action.name}" aksiyonunun hedef adımı bu sürümde yok.`,
          { stepId: step.id, stepName: step.name, actionId: action.id },
        );
      }
      if (
        action.targetStepMode === TARGET_STEP_MODE.NEXT &&
        step.sequence >= lastSequence &&
        step.type !== STEP_TYPE.END
      ) {
        err(
          'NEXT_WITHOUT_FOLLOWING_STEP',
          `"${step.name}" adımındaki "${action.name}" aksiyonu "sonraki adım" hedefli ancak sonrasında adım yok.`,
          { stepId: step.id, stepName: step.name, actionId: action.id },
        );
      }
      if (action.targetStatusCode && !statuses.has(action.targetStatusCode)) {
        err(
          'ACTION_INVALID_STATUS',
          `"${action.name}" aksiyonunda tanımsız hedef durum: ${action.targetStatusCode}`,
          { stepId: step.id, stepName: step.name, actionId: action.id },
        );
      }
      if (action.kind === ACTION_KIND.REJECT && !action.commentRequired) {
        warn(
          'REJECT_WITHOUT_COMMENT',
          `"${action.name}" red aksiyonunda açıklama zorunlu değil. Red işlemlerinde açıklama istenmesi önerilir.`,
          { stepId: step.id, stepName: step.name, actionId: action.id },
        );
      }
    }
    for (const [code, count] of actionCodes) {
      if (count > 1) {
        err(
          'DUPLICATE_ACTION_CODE',
          `"${step.name}" adımında "${code}" aksiyon kodu ${count} kez kullanılmış.`,
          { stepId: step.id, stepName: step.name },
        );
      }
    }
  }

  // 11) Kosullu adimlarin hepsi atlanirsa akis tikanabilir - bilgilendirme
  const conditionalNonEnd = steps.filter(
    (s) => s.conditionJson && s.type !== STEP_TYPE.END && s.type !== STEP_TYPE.START,
  );
  if (conditionalNonEnd.length > 0 && conditionalNonEnd.length === steps.length - 2) {
    warn(
      'ALL_MIDDLE_STEPS_CONDITIONAL',
      'Aradaki tüm adımlar koşullu. Hiçbir koşul sağlanmazsa talep doğrudan kapanır.',
    );
  }

  const errors = issues.filter((i) => i.severity === 'ERROR');
  return { valid: errors.length === 0, canPublish: errors.length === 0, issues };
}

// ---------------------------------------------------------------------------
// Publish (spec 02 - §13)
// ---------------------------------------------------------------------------

/**
 * Taslak versiyonu yayinlar.
 *
 * ONEMLI: Calisan instance'lar HIC ETKILENMEZ. Onceki aktif versiyon SUPERSEDED
 * olur ama silinmez/degistirilmez; o versiyon ile baslamis kayitlar kendi
 * versiyonu uzerinden calismaya devam eder (otomatik migration YOK).
 */
export async function publishVersion(
  user: AuthUser,
  versionId: string,
  input: { expectedRowVersion: number; changeDescription?: string | null },
) {
  const version = await assertDraft(versionId, input.expectedRowVersion);

  const validation = await validateVersion(versionId);
  if (!validation.canPublish) {
    throw new WorkflowConfigError(
      'İş akışı doğrulamadan geçmedi; yayınlanamaz. Lütfen hataları giderin.',
      { issues: validation.issues },
    );
  }

  const now = new Date();

  const result = await prisma.$transaction(async (txRaw) => {
    const tx = txRaw as unknown as Db;

    // Yarista ikinci publish girisimini engelle.
    const cas = await tx.workflowVersion.updateMany({
      where: {
        id: versionId,
        status: WORKFLOW_VERSION_STATUS.DRAFT,
        rowVersion: input.expectedRowVersion,
      },
      data: {
        status: WORKFLOW_VERSION_STATUS.ACTIVE,
        publishedAt: now,
        publishedById: user.id,
        rowVersion: { increment: 1 },
        ...(input.changeDescription !== undefined
          ? { changeDescription: input.changeDescription?.trim() || null }
          : {}),
      },
    });
    if (cas.count === 0) {
      throw new StaleDataError('Bu sürüm başka bir işlem tarafından güncellendi.');
    }

    const definition = await tx.workflowDefinition.findUniqueOrThrow({
      where: { id: version.definitionId },
    });

    // Onceki aktif versiyon: degistirilmez, yalnizca SUPERSEDED isaretlenir.
    let previousVersionNumber: number | null = null;
    if (definition.activeVersionId && definition.activeVersionId !== versionId) {
      const previous = await tx.workflowVersion.update({
        where: { id: definition.activeVersionId },
        data: { status: WORKFLOW_VERSION_STATUS.SUPERSEDED },
      });
      previousVersionNumber = previous.versionNumber;
    }

    await tx.workflowDefinition.update({
      where: { id: version.definitionId },
      data: {
        activeVersionId: versionId,
        status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
        updatedById: user.id,
      },
    });

    const runningOnPrevious = definition.activeVersionId
      ? await tx.workflowInstance.count({
          where: { versionId: definition.activeVersionId, status: INSTANCE_STATUS.RUNNING },
        })
      : 0;

    await writeAudit(tx, {
      eventType: AUDIT_EVENT.WORKFLOW_PUBLISHED,
      actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
      workflowVersionId: versionId,
      workflowVersionNumber: version.versionNumber,
      oldValue: previousVersionNumber ? `v${previousVersionNumber}` : null,
      newValue: `v${version.versionNumber}`,
      description:
        `${definition.name} v${version.versionNumber} yayınlandı.` +
        (runningOnPrevious > 0
          ? ` Önceki sürümde çalışan ${runningOnPrevious} açık kayıt kendi sürümünde devam ediyor.`
          : ''),
      visibility: AUDIT_VISIBILITY.ADMIN,
      metadata: {
        definitionId: version.definitionId,
        previousVersionId: definition.activeVersionId,
        runningInstancesOnPreviousVersion: runningOnPrevious,
      },
    });

    return {
      versionId,
      versionNumber: version.versionNumber,
      previousVersionNumber,
      runningInstancesOnPreviousVersion: runningOnPrevious,
    };
  });

  invalidateCatalogCache();
  return result;
}

/** Taslak versiyonu siler (yayinlanmis versiyon silinemez). */
export async function deleteDraftVersion(user: AuthUser, versionId: string) {
  const version = await assertDraft(versionId);

  const definition = await prisma.workflowDefinition.findUniqueOrThrow({
    where: { id: version.definitionId },
    include: { versions: true },
  });
  if (definition.versions.length === 1) {
    throw new ConflictError(
      'Tek sürüm silinemez. Bunun yerine iş akışını arşivleyebilirsiniz.',
    );
  }

  await prisma.workflowVersion.delete({ where: { id: versionId } });

  await writeAudit(prisma, {
    eventType: AUDIT_EVENT.WORKFLOW_UPDATED,
    actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
    workflowVersionNumber: version.versionNumber,
    description: `${definition.name} v${version.versionNumber} taslak sürümü silindi.`,
    visibility: AUDIT_VISIBILITY.ADMIN,
    metadata: { definitionId: version.definitionId },
  });

  return { id: versionId };
}

// ---------------------------------------------------------------------------
// Aktifleştir / Pasife al / Arşivle
// ---------------------------------------------------------------------------

export async function setDefinitionStatus(
  user: AuthUser,
  definitionId: string,
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED',
) {
  const definition = await prisma.workflowDefinition.findUnique({
    where: { id: definitionId },
    include: { categories: { select: { name: true, isActive: true } } },
  });
  if (!definition) throw new NotFoundError('İş akışı bulunamadı.');

  if (status === 'ACTIVE' && !definition.activeVersionId) {
    throw new ConflictError(
      'Aktifleştirmek için önce bir sürüm yayınlanmalıdır.',
    );
  }

  if (status !== 'ACTIVE') {
    const activeCategories = definition.categories.filter((c) => c.isActive);
    const running = await prisma.workflowInstance.count({
      where: { definitionId, status: INSTANCE_STATUS.RUNNING },
    });
    if (status === 'ARCHIVED' && running > 0) {
      throw new ConflictError(
        `Bu iş akışında ${running} açık kayıt var; arşivlenemez. Önce pasife alabilirsiniz.`,
      );
    }
    if (activeCategories.length > 0 && status === 'ARCHIVED') {
      throw new ConflictError(
        `Bu iş akışı şu aktif kategorilere bağlı: ${activeCategories
          .map((c) => c.name)
          .join(', ')}. Önce kategori bağlantısını değiştirin.`,
      );
    }
  }

  await prisma.workflowDefinition.update({
    where: { id: definitionId },
    data: {
      status,
      updatedById: user.id,
      ...(status === 'ARCHIVED' ? { isArchived: true, archivedAt: new Date() } : {}),
      ...(status !== 'ARCHIVED' ? { isArchived: false, archivedAt: null } : {}),
    },
  });

  await writeAudit(prisma, {
    eventType:
      status === 'ARCHIVED'
        ? AUDIT_EVENT.WORKFLOW_ARCHIVED
        : status === 'ACTIVE'
          ? AUDIT_EVENT.WORKFLOW_UPDATED
          : AUDIT_EVENT.WORKFLOW_DEACTIVATED,
    actor: { id: user.id, displayName: user.displayName, role: 'ADMIN' },
    oldValue: definition.status,
    newValue: status,
    description: `${definition.name} iş akışının durumu ${status} olarak güncellendi.`,
    visibility: AUDIT_VISIBILITY.ADMIN,
    metadata: { definitionId },
  });

  return { id: definitionId, status };
}
