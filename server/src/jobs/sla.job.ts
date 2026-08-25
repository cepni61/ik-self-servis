/**
 * SLA degerlendirme job'i.
 *
 * Periyodik olarak aktif adimlarin SLA durumunu gunceller ve gerektiginde
 * hatirlatma / asim bildirimi uretir.
 *
 * Idempotency: slaReminderSentAt / slaEscalationSentAt alanlari sayesinde ayni
 * uyari tekrar gonderilmez.
 */

import { prisma } from '../db';
import {
  AUDIT_EVENT,
  AUDIT_VISIBILITY,
  INSTANCE_STATUS,
  NOTIFICATION_EVENT,
  SLA_STATUS,
  STEP_INSTANCE_STATUS,
} from '../domain/constants';
import { evaluateSlaStatus } from '../domain/sla';
import { logger } from '../lib/logger';
import { writeAudit } from './../services/audit.service';
import { dispatchNotifications, type NotificationIntent } from '../services/notification.service';
import { getSlaAtRiskThreshold } from '../services/settings.service';

export interface SlaJobResult {
  scanned: number;
  updated: number;
  warningsSent: number;
  breachesSent: number;
}

export async function runSlaEvaluation(now = new Date()): Promise<SlaJobResult> {
  const threshold = await getSlaAtRiskThreshold();

  const activeSteps = await prisma.stepInstance.findMany({
    where: {
      status: STEP_INSTANCE_STATUS.ACTIVE,
      dueAt: { not: null },
      instance: { status: INSTANCE_STATUS.RUNNING },
    },
    include: {
      instance: {
        include: {
          request: {
            include: {
              category: { select: { name: true } },
            },
          },
        },
      },
    },
  });

  const notifications: NotificationIntent[] = [];
  let updated = 0;
  let warningsSent = 0;
  let breachesSent = 0;

  for (const step of activeSteps) {
    const request = step.instance.request;

    const newStatus = evaluateSlaStatus({
      startedAt: step.startedAt,
      dueAt: step.dueAt,
      now,
      atRiskThresholdPercent: threshold,
    });

    const statusChanged = newStatus !== step.slaStatus;

    const isBreached = newStatus === SLA_STATUS.BREACHED;
    const isAtRisk = newStatus === SLA_STATUS.AT_RISK;

    const shouldSendWarning = isAtRisk && step.slaReminderSentAt === null;
    const shouldSendBreach = isBreached && step.slaEscalationSentAt === null;

    if (!statusChanged && !shouldSendWarning && !shouldSendBreach) continue;

    await prisma.stepInstance.update({
      where: { id: step.id },
      data: {
        slaStatus: newStatus,
        ...(shouldSendWarning ? { slaReminderSentAt: now } : {}),
        ...(shouldSendBreach ? { slaEscalationSentAt: now } : {}),
      },
    });

    if (statusChanged) {
      await prisma.request.update({
        where: { id: request.id },
        data: { slaStatus: newStatus },
      });
      updated++;
    }

    const baseIntent = {
      requestId: request.id,
      requestNo: request.requestNo,
      subject: request.subject,
      categoryName: request.category.name,
      versionId: step.instance.versionId,
      requesterId: request.requesterId,
      requesterManagerId: request.requesterManagerId,
      currentAssigneeId: step.assigneeId,
      currentAssigneeRoleCode: step.assigneeRoleCode,
      currentAssigneeGroupId: step.assigneeGroupId,
      stepName: step.stepName,
      actorDisplayName: null,
    };

    if (shouldSendWarning) {
      notifications.push({ ...baseIntent, event: NOTIFICATION_EVENT.SLA_WARNING });
      warningsSent++;
      await writeAudit(prisma, {
        requestId: request.id,
        instanceId: step.instanceId,
        eventType: AUDIT_EVENT.SLA_WARNING,
        actor: { id: null, displayName: 'Sistem', role: null },
        stepInstanceId: step.id,
        stepName: step.stepName,
        description: `"${step.stepName}" adımında SLA süresi daralıyor.`,
        visibility: AUDIT_VISIBILITY.USER,
      });
    }

    if (shouldSendBreach) {
      notifications.push({ ...baseIntent, event: NOTIFICATION_EVENT.SLA_BREACH });
      breachesSent++;
      await writeAudit(prisma, {
        requestId: request.id,
        instanceId: step.instanceId,
        eventType: AUDIT_EVENT.SLA_BREACH,
        actor: { id: null, displayName: 'Sistem', role: null },
        stepInstanceId: step.id,
        stepName: step.stepName,
        description: `"${step.stepName}" adımında SLA süresi aşıldı.`,
        visibility: AUDIT_VISIBILITY.USER,
      });
    }
  }

  await dispatchNotifications(notifications);

  const result = {
    scanned: activeSteps.length,
    updated,
    warningsSent,
    breachesSent,
  };

  if (updated > 0 || warningsSent > 0 || breachesSent > 0) {
    logger.info(result, 'SLA degerlendirmesi tamamlandi');
  }
  return result;
}

let timer: NodeJS.Timeout | null = null;

export function startSlaScheduler(intervalMinutes: number): void {
  if (intervalMinutes <= 0) {
    logger.info('SLA job devre disi (SLA_JOB_INTERVAL_MINUTES=0)');
    return;
  }
  const intervalMs = intervalMinutes * 60 * 1000;

  const tick = () => {
    runSlaEvaluation().catch((err) => {
      // Job hatasi uygulamayi durdurmaz.
      logger.error({ err }, 'SLA job hatasi');
    });
  };

  timer = setInterval(tick, intervalMs);
  // Ilk cevrim baslangictan kisa sure sonra.
  setTimeout(tick, 10_000).unref?.();
  timer.unref?.();

  logger.info({ intervalMinutes }, 'SLA job zamanlayicisi baslatildi');
}

export function stopSlaScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
