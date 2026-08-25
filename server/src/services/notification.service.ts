/**
 * Bildirim katmani.
 *
 * Tasarim kararlari:
 *  - Bildirim gonderimi ANA WORKFLOW TRANSACTION'INI BOZMAZ. Engine yalnizca
 *    "intent" toplar; gerceklestirme commit sonrasi ve try/catch icinde yapilir.
 *  - Alicilar NotificationRule konfigurasyonundan cozumlenir; kod icinde
 *    "HR'a mail at" gibi sabit alici YOK.
 *  - Ilk surumde yalnizca IN_APP kanali gonderilir. EMAIL/TEAMS kurallari
 *    tanimlanabilir ama kanal etkin degilse atlanir (sessizce degil, loglanarak).
 */

import { prisma } from '../db';
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_RECIPIENT_TYPE,
  SETTING_KEYS,
  type NotificationChannel,
  type NotificationEvent,
} from '../domain/constants';
import { logger } from '../lib/logger';
import { getJsonSetting } from './settings.service';

export interface NotificationIntent {
  event: NotificationEvent;
  requestId: string;
  requestNo: string;
  subject: string;
  categoryName: string;
  /** Kural okumasi icin: instance'in kendi workflow versiyonu. */
  versionId: string;

  requesterId: string;
  requesterManagerId: string | null;

  /** Bildirim aninda gorevin sahibi (kisi atanmissa). */
  currentAssigneeId: string | null;
  /** Gorev bir rol/grup havuzundaysa. */
  currentAssigneeRoleCode: string | null;
  currentAssigneeGroupId: string | null;

  stepName?: string | null;
  statusName?: string | null;
  actorDisplayName?: string | null;
  /** Ek aciklama (or. red nedeni, override nedeni). */
  note?: string | null;
}

/** Engine tarafindan toplanan intent listesi. */
export type NotificationBatch = NotificationIntent[];

// ---------------------------------------------------------------------------
// Metin uretimi (basit; template designer ilk surum kapsaminda degil)
// ---------------------------------------------------------------------------

function buildTitle(intent: NotificationIntent): string {
  const ref = `${intent.requestNo}`;
  switch (intent.event) {
    case 'REQUEST_SUBMITTED':
      return `${ref} talebi gonderildi`;
    case 'STEP_STARTED':
      return `${ref} onayinizi/islem yapmanizi bekliyor`;
    case 'APPROVED':
      return `${ref} onaylandi`;
    case 'REJECTED':
      return `${ref} reddedildi`;
    case 'ROUTED_TO_HR':
      return `${ref} Insan Kaynaklari kontrolune ulasti`;
    case 'INFO_REQUESTED':
      return `${ref} icin ek bilgi bekleniyor`;
    case 'COMPLETED':
      return `${ref} tamamlandi`;
    case 'CANCELLED':
      return `${ref} iptal edildi`;
    case 'SLA_WARNING':
      return `${ref} icin sure daraliyor`;
    case 'SLA_BREACH':
      return `${ref} SLA suresi asildi`;
    case 'ADMIN_OVERRIDE':
      return `${ref} uzerinde yonetici mudahalesi yapildi`;
    case 'COMMENT_ADDED':
      return `${ref} talebine yorum eklendi`;
    default:
      return `${ref} talebinde guncelleme var`;
  }
}

function buildBody(intent: NotificationIntent): string {
  const parts: string[] = [`${intent.categoryName}: ${intent.subject}`];
  if (intent.stepName) parts.push(`Adim: ${intent.stepName}`);
  if (intent.statusName) parts.push(`Durum: ${intent.statusName}`);
  if (intent.actorDisplayName) parts.push(`Islem yapan: ${intent.actorDisplayName}`);
  if (intent.note) parts.push(`Aciklama: ${intent.note}`);
  return parts.join(' | ');
}

// ---------------------------------------------------------------------------
// Alici cozumleme
// ---------------------------------------------------------------------------

async function resolveRecipientsForRule(
  rule: {
    recipientType: string;
    recipientRoleCode: string | null;
    recipientGroupId: string | null;
  },
  intent: NotificationIntent,
): Promise<string[]> {
  switch (rule.recipientType) {
    case NOTIFICATION_RECIPIENT_TYPE.REQUESTER:
      return [intent.requesterId];

    case NOTIFICATION_RECIPIENT_TYPE.REQUESTER_MANAGER:
      return intent.requesterManagerId ? [intent.requesterManagerId] : [];

    case NOTIFICATION_RECIPIENT_TYPE.CURRENT_ASSIGNEE: {
      // Kisi atanmissa ona, havuz gorevi ise havuzdaki herkese.
      if (intent.currentAssigneeId) return [intent.currentAssigneeId];
      if (intent.currentAssigneeRoleCode) {
        return usersByRole(intent.currentAssigneeRoleCode);
      }
      if (intent.currentAssigneeGroupId) {
        return usersByGroup(intent.currentAssigneeGroupId);
      }
      return [];
    }

    case NOTIFICATION_RECIPIENT_TYPE.ROLE:
      return rule.recipientRoleCode ? usersByRole(rule.recipientRoleCode) : [];

    case NOTIFICATION_RECIPIENT_TYPE.GROUP:
      return rule.recipientGroupId ? usersByGroup(rule.recipientGroupId) : [];

    default:
      logger.warn(
        { recipientType: rule.recipientType },
        'Bilinmeyen bildirim alici tipi, kural atlandi',
      );
      return [];
  }
}

async function usersByRole(roleCode: string): Promise<string[]> {
  const rows = await prisma.userRole.findMany({
    where: { roleCode, user: { isActive: true } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

async function usersByGroup(groupId: string): Promise<string[]> {
  const rows = await prisma.userGroupMember.findMany({
    where: { groupId, user: { isActive: true } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

// ---------------------------------------------------------------------------
// Gonderim
// ---------------------------------------------------------------------------

async function enabledChannels(): Promise<NotificationChannel[]> {
  const configured = await getJsonSetting<string[]>(
    SETTING_KEYS.NOTIFICATION_CHANNELS_ENABLED,
    [NOTIFICATION_CHANNEL.IN_APP],
  );
  const valid = Object.values(NOTIFICATION_CHANNEL) as string[];
  return configured.filter((c): c is NotificationChannel => valid.includes(c));
}

/**
 * Commit sonrasi cagrilir. Hicbir kosulda throw etmez; hata loglanir.
 * Boylece bildirim altyapisindaki bir problem is akisini durdurmaz.
 */
export async function dispatchNotifications(batch: NotificationBatch): Promise<void> {
  if (batch.length === 0) return;
  try {
    const channels = await enabledChannels();

    for (const intent of batch) {
      const rules = await prisma.notificationRule.findMany({
        where: { versionId: intent.versionId, event: intent.event, isActive: true },
      });

      if (rules.length === 0) continue;

      const recipientsByChannel = new Map<NotificationChannel, Set<string>>();

      for (const rule of rules) {
        const channel = rule.channel as NotificationChannel;
        if (!channels.includes(channel)) {
          logger.debug(
            { event: intent.event, channel },
            'Bildirim kanali etkin degil, kural atlandi',
          );
          continue;
        }
        const userIds = await resolveRecipientsForRule(rule, intent);
        if (!recipientsByChannel.has(channel)) {
          recipientsByChannel.set(channel, new Set());
        }
        const bucket = recipientsByChannel.get(channel)!;
        for (const id of userIds) bucket.add(id);
      }

      const title = buildTitle(intent);
      const body = buildBody(intent);

      for (const [channel, userIds] of recipientsByChannel) {
        const rows = [...userIds].map((userId) => ({
          userId,
          requestId: intent.requestId,
          event: intent.event,
          title,
          body,
          channel,
          // IN_APP disindaki kanallar icin gercek gonderici henuz baglanmadi.
          status: channel === NOTIFICATION_CHANNEL.IN_APP ? 'SENT' : 'PENDING',
          sentAt: channel === NOTIFICATION_CHANNEL.IN_APP ? new Date() : null,
        }));
        if (rows.length > 0) {
          await prisma.notification.createMany({ data: rows });
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Bildirim gonderimi basarisiz oldu (is akisi etkilenmedi)');
  }
}

// ---------------------------------------------------------------------------
// Kullanici tarafi okuma
// ---------------------------------------------------------------------------

export async function listNotifications(
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
) {
  return prisma.notification.findMany({
    where: {
      userId,
      channel: NOTIFICATION_CHANNEL.IN_APP,
      ...(options.unreadOnly ? { isRead: false } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options.limit ?? 50,
    select: {
      id: true,
      requestId: true,
      event: true,
      title: true,
      body: true,
      isRead: true,
      createdAt: true,
    },
  });
}

export async function countUnread(userId: string): Promise<number> {
  return prisma.notification.count({
    where: { userId, isRead: false, channel: NOTIFICATION_CHANNEL.IN_APP },
  });
}

/** Yalnizca kendi bildirimini okundu isaretleyebilir. */
export async function markRead(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await prisma.notification.updateMany({
    where: { id: { in: ids }, userId },
    data: { isRead: true, readAt: new Date() },
  });
  return result.count;
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return result.count;
}
