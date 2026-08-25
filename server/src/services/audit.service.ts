/**
 * Audit yazma katmani.
 *
 * Audit append-only'dir: bu serviste yalnizca "write" ve "read" vardir.
 * Guncelleme/silme fonksiyonu bilincli olarak YOKTUR ve API katmaninda da
 * AuditEvent icin update/delete endpoint'i tanimlanmaz.
 */

import type { Prisma } from '@prisma/client';
import { prisma, type Db } from '../db';
import {
  AUDIT_VISIBILITY,
  type AuditEventType,
  type AuditVisibility,
} from '../domain/constants';
import { stringifyJson } from '../lib/json';

export interface AuditActor {
  id: string | null;
  displayName: string | null;
  /** Islemi yaparken kullandigi rol (yetki izi icin). */
  role: string | null;
}

export interface WriteAuditInput {
  requestId?: string | null;
  instanceId?: string | null;
  eventType: AuditEventType;
  actor: AuditActor;
  occurredAt?: Date;

  stepInstanceId?: string | null;
  stepName?: string | null;
  workflowVersionId?: string | null;
  workflowVersionNumber?: number | null;

  fieldName?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  oldStatusCode?: string | null;
  newStatusCode?: string | null;

  description?: string | null;
  visibility?: AuditVisibility;
  metadata?: unknown;
  ipAddress?: string | null;
}

function toCreateData(input: WriteAuditInput): Prisma.AuditEventUncheckedCreateInput {
  return {
    requestId: input.requestId ?? null,
    instanceId: input.instanceId ?? null,
    eventType: input.eventType,
    userId: input.actor.id,
    userDisplayName: input.actor.displayName,
    userRole: input.actor.role,
    occurredAt: input.occurredAt ?? new Date(),
    stepInstanceId: input.stepInstanceId ?? null,
    stepName: input.stepName ?? null,
    workflowVersionId: input.workflowVersionId ?? null,
    workflowVersionNumber: input.workflowVersionNumber ?? null,
    fieldName: input.fieldName ?? null,
    oldValue: input.oldValue ?? null,
    newValue: input.newValue ?? null,
    oldStatusCode: input.oldStatusCode ?? null,
    newStatusCode: input.newStatusCode ?? null,
    description: input.description ?? null,
    visibility: input.visibility ?? AUDIT_VISIBILITY.USER,
    metadataJson: stringifyJson(input.metadata),
    ipAddress: input.ipAddress ?? null,
  };
}

/**
 * Tek audit kaydi yazar. Islem transaction icinde ise db parametresi ile
 * cagrilmalidir; boylece is islemi geri alinirsa audit de geri alinir.
 */
export async function writeAudit(db: Db, input: WriteAuditInput): Promise<void> {
  await db.auditEvent.create({ data: toCreateData(input) });
}

export async function writeAuditMany(db: Db, inputs: WriteAuditInput[]): Promise<void> {
  if (inputs.length === 0) return;
  // createMany SQLite'ta desteklenir; sirali id uretimi icin tek tek de olabilir.
  await db.auditEvent.createMany({ data: inputs.map(toCreateData) });
}

// ---------------------------------------------------------------------------
// Okuma
// ---------------------------------------------------------------------------

export interface AuditListOptions {
  /** true ise ADMIN gorunurlukteki kayitlar da doner. */
  includeAdminOnly: boolean;
  limit?: number;
}

export async function listRequestAudit(
  requestId: string,
  options: AuditListOptions,
): Promise<
  Array<{
    id: string;
    eventType: string;
    userId: string | null;
    userDisplayName: string | null;
    userRole: string | null;
    occurredAt: Date;
    stepName: string | null;
    oldStatusCode: string | null;
    newStatusCode: string | null;
    fieldName: string | null;
    oldValue: string | null;
    newValue: string | null;
    description: string | null;
    visibility: string;
    workflowVersionNumber: number | null;
    metadataJson: string | null;
  }>
> {
  return prisma.auditEvent.findMany({
    where: {
      requestId,
      ...(options.includeAdminOnly ? {} : { visibility: AUDIT_VISIBILITY.USER }),
    },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    take: options.limit ?? 500,
    select: {
      id: true,
      eventType: true,
      userId: true,
      userDisplayName: true,
      userRole: true,
      occurredAt: true,
      stepName: true,
      oldStatusCode: true,
      newStatusCode: true,
      fieldName: true,
      oldValue: true,
      newValue: true,
      description: true,
      visibility: true,
      workflowVersionNumber: true,
      metadataJson: true,
    },
  });
}
