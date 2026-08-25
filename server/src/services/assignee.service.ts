/**
 * Adim sorumlusu cozumleme.
 *
 * Iki tur sorumluluk vardir:
 *  1. Kisi gorevi   -> assigneeId dolu (or. talep sahibinin yoneticisi)
 *  2. Havuz gorevi  -> assigneeId null, rol veya grup dolu (or. "Insan Kaynaklari")
 *
 * Havuz gorevlerinde "Su anda kimde?" sorusunun cevabi rol/grup adidir; ilgili
 * roldeki her kullanici gorevi gorebilir ve isleyebilir. Admin daha sonra
 * REASSIGN override'i ile gorevi belirli bir kisiye baglayabilir.
 */

import { prisma, type Db } from '../db';
import { ASSIGNEE_TYPE, ROLES, type AssigneeType } from '../domain/constants';
import { WorkflowConfigError } from '../domain/errors';
import { logger } from '../lib/logger';
import { getAssigneeFallbackRole } from './settings.service';

export interface AssigneeResolution {
  assigneeId: string | null;
  assigneeType: AssigneeType;
  /** Ekranda gosterilecek metin. */
  assigneeLabel: string;
  /** Havuz gorevi ise rol kodu. */
  roleCode: string | null;
  /** Havuz gorevi ise grup id. */
  groupId: string | null;
  /** Asil sorumlu bulunamadigi icin yedek kural uygulandi mi. */
  fallbackApplied: boolean;
  fallbackReason: string | null;
}

export interface AssigneeContext {
  requesterId: string;
  requesterManagerId: string | null;
  /** Kategori konfigurasyonundaki sorumlu rol/ekip (IK adimlarini daraltir). */
  categoryOwnerRoleCode: string | null;
  categoryOwnerGroupId: string | null;
}

export interface StepAssigneeConfig {
  code: string;
  name: string;
  assigneeType: string;
  assigneeRoleCode: string | null;
  assigneeGroupId: string | null;
  assigneeUserId: string | null;
}

async function roleLabel(db: Db, roleCode: string): Promise<string> {
  const role = await db.role.findUnique({ where: { code: roleCode } });
  return role?.name ?? roleCode;
}

async function groupLabel(db: Db, groupId: string): Promise<string> {
  const group = await db.userGroup.findUnique({ where: { id: groupId } });
  return group?.name ?? 'Grup';
}

async function activeUser(db: Db, userId: string) {
  return db.user.findFirst({
    where: { id: userId, isActive: true },
    select: { id: true, displayName: true },
  });
}

function poolResolution(
  type: AssigneeType,
  label: string,
  roleCode: string | null,
  groupId: string | null,
  fallback?: { reason: string },
): AssigneeResolution {
  return {
    assigneeId: null,
    assigneeType: type,
    assigneeLabel: label,
    roleCode,
    groupId,
    fallbackApplied: Boolean(fallback),
    fallbackReason: fallback?.reason ?? null,
  };
}

/**
 * Adim sorumlusunu cozumler.
 * Cozumlenemeyen zorunlu durumlarda WorkflowConfigError firlatir; talep asla
 * "sahipsiz" kalmaz.
 */
export async function resolveStepAssignee(
  db: Db,
  step: StepAssigneeConfig,
  ctx: AssigneeContext,
): Promise<AssigneeResolution> {
  const type = step.assigneeType as AssigneeType;

  switch (type) {
    case ASSIGNEE_TYPE.REQUESTER: {
      const user = await activeUser(db, ctx.requesterId);
      return {
        assigneeId: ctx.requesterId,
        assigneeType: type,
        assigneeLabel: user?.displayName ?? 'Talep Eden',
        roleCode: null,
        groupId: null,
        fallbackApplied: false,
        fallbackReason: null,
      };
    }

    case ASSIGNEE_TYPE.REQUESTER_MANAGER: {
      if (ctx.requesterManagerId) {
        const manager = await activeUser(db, ctx.requesterManagerId);
        if (manager) {
          return {
            assigneeId: manager.id,
            assigneeType: type,
            assigneeLabel: manager.displayName,
            roleCode: null,
            groupId: null,
            fallbackApplied: false,
            fallbackReason: null,
          };
        }
      }
      // Yonetici tanimli degil veya pasif: yedek kural (ayarlardan okunur).
      const fallbackRole = await getAssigneeFallbackRole();
      logger.warn(
        { step: step.code, requesterId: ctx.requesterId, fallbackRole },
        'Talep edenin yoneticisi cozumlenemedi, yedek rol uygulandi',
      );
      return poolResolution(
        ASSIGNEE_TYPE.ROLE,
        await roleLabel(db, fallbackRole),
        fallbackRole,
        null,
        {
          reason: ctx.requesterManagerId
            ? 'Talep edenin yoneticisi pasif durumda.'
            : 'Talep eden icin tanimli birinci yonetici yok.',
        },
      );
    }

    case ASSIGNEE_TYPE.HR_USER:
    case ASSIGNEE_TYPE.HR_PROCESS_OWNER: {
      // Kategori konfigurasyonunda sorumlu ekip/rol belirtilmisse IK adimi daraltilir.
      if (type === ASSIGNEE_TYPE.HR_USER && ctx.categoryOwnerGroupId) {
        return poolResolution(
          ASSIGNEE_TYPE.GROUP,
          await groupLabel(db, ctx.categoryOwnerGroupId),
          null,
          ctx.categoryOwnerGroupId,
        );
      }
      const roleCode =
        type === ASSIGNEE_TYPE.HR_USER
          ? (ctx.categoryOwnerRoleCode ?? ROLES.HR_USER)
          : ROLES.HR_PROCESS_OWNER;
      return poolResolution(
        ASSIGNEE_TYPE.ROLE,
        await roleLabel(db, roleCode),
        roleCode,
        null,
      );
    }

    case ASSIGNEE_TYPE.ROLE: {
      if (!step.assigneeRoleCode) {
        throw new WorkflowConfigError(
          `"${step.name}" adimi rol bazli tanimlanmis ancak rol secilmemis.`,
        );
      }
      return poolResolution(
        ASSIGNEE_TYPE.ROLE,
        await roleLabel(db, step.assigneeRoleCode),
        step.assigneeRoleCode,
        null,
      );
    }

    case ASSIGNEE_TYPE.GROUP: {
      if (!step.assigneeGroupId) {
        throw new WorkflowConfigError(
          `"${step.name}" adimi grup bazli tanimlanmis ancak grup secilmemis.`,
        );
      }
      return poolResolution(
        ASSIGNEE_TYPE.GROUP,
        await groupLabel(db, step.assigneeGroupId),
        null,
        step.assigneeGroupId,
      );
    }

    case ASSIGNEE_TYPE.USER: {
      if (!step.assigneeUserId) {
        throw new WorkflowConfigError(
          `"${step.name}" adimi belirli kullaniciya tanimlanmis ancak kullanici secilmemis.`,
        );
      }
      const user = await activeUser(db, step.assigneeUserId);
      if (user) {
        return {
          assigneeId: user.id,
          assigneeType: type,
          assigneeLabel: user.displayName,
          roleCode: null,
          groupId: null,
          fallbackApplied: false,
          fallbackReason: null,
        };
      }
      const fallbackRole = await getAssigneeFallbackRole();
      return poolResolution(
        ASSIGNEE_TYPE.ROLE,
        await roleLabel(db, fallbackRole),
        fallbackRole,
        null,
        { reason: 'Adima tanimli kullanici pasif durumda.' },
      );
    }

    default:
      throw new WorkflowConfigError(
        `"${step.name}" adiminda gecersiz sorumlu tipi: ${step.assigneeType}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Yetki kontrolu
// ---------------------------------------------------------------------------

export interface ActorCapability {
  id: string;
  roles: string[];
  groupIds: string[];
}

export interface StepAssignment {
  assigneeId: string | null;
  assigneeType: string | null;
  /** Havuz gorevleri icin adimin rol/grup bilgisi (StepInstance uzerinde tutulur). */
  roleCode?: string | null;
  groupId?: string | null;
}

/**
 * Kullanici bu adim ornegi uzerinde is aksiyonu uygulayabilir mi?
 *
 * ONEMLI: Admin rolu bu kontrolden muaf DEGILDIR. Admin normal is aksiyonu
 * uygulamak yerine ADMIN_OVERRIDE aksiyonlarini kullanir; boylece mudahale
 * audit'te ayirt edilebilir kalir.
 */
export function canActOnStep(actor: ActorCapability, assignment: StepAssignment): boolean {
  if (assignment.assigneeId) {
    return assignment.assigneeId === actor.id;
  }
  if (assignment.groupId) {
    return actor.groupIds.includes(assignment.groupId);
  }
  if (assignment.roleCode) {
    return actor.roles.includes(assignment.roleCode);
  }
  return false;
}

/** Havuz gorevlerinde kullanicinin gorebilecegi rol/grup filtresi. */
export async function loadActorCapability(userId: string): Promise<ActorCapability> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roles: { select: { roleCode: true } }, groups: { select: { groupId: true } } },
  });
  return {
    id: userId,
    roles: user?.roles.map((r) => r.roleCode) ?? [],
    groupIds: user?.groups.map((g) => g.groupId) ?? [],
  };
}
