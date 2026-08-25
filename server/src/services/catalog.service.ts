/**
 * Referans veri (durum, oncelik, kategori, rol) okuma katmani.
 * Etiketler kod icinde degil veritabaninda; burada yalnizca kisa sureli cache var.
 */

import { prisma } from '../db';
import { NotFoundError } from '../domain/errors';

const CACHE_TTL_MS = 30_000;

export interface StatusInfo {
  code: string;
  name: string;
  phase: string;
  isTerminal: boolean;
  allowAdminOverride: boolean;
  tone: string;
  sortOrder: number;
}

export interface PriorityInfo {
  code: string;
  name: string;
  tone: string;
  sortOrder: number;
}

interface CacheEntry<T> {
  loadedAt: number;
  value: T;
}

let statusCache: CacheEntry<Map<string, StatusInfo>> | null = null;
let priorityCache: CacheEntry<Map<string, PriorityInfo>> | null = null;

function fresh<T>(entry: CacheEntry<T> | null): T | null {
  if (entry && Date.now() - entry.loadedAt < CACHE_TTL_MS) return entry.value;
  return null;
}

export function invalidateCatalogCache(): void {
  statusCache = null;
  priorityCache = null;
}

export async function getStatusMap(): Promise<Map<string, StatusInfo>> {
  const cached = fresh(statusCache);
  if (cached) return cached;

  const rows = await prisma.statusDefinition.findMany({ orderBy: { sortOrder: 'asc' } });
  const map = new Map<string, StatusInfo>(
    rows.map((r) => [
      r.code,
      {
        code: r.code,
        name: r.name,
        phase: r.phase,
        isTerminal: r.isTerminal,
        allowAdminOverride: r.allowAdminOverride,
        tone: r.tone,
        sortOrder: r.sortOrder,
      },
    ]),
  );
  statusCache = { loadedAt: Date.now(), value: map };
  return map;
}

export async function listStatuses(): Promise<StatusInfo[]> {
  const map = await getStatusMap();
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** Admin override ile secilebilen durumlar (serbest string kabul edilmez). */
export async function listAdminOverrideStatuses(): Promise<StatusInfo[]> {
  return (await listStatuses()).filter((s) => s.allowAdminOverride);
}

export async function getStatusInfo(code: string): Promise<StatusInfo> {
  const map = await getStatusMap();
  const found = map.get(code);
  if (!found) throw new NotFoundError(`Tanımsız talep durumu: ${code}`);
  return found;
}

export async function describeStatus(code: string | null): Promise<StatusInfo | null> {
  if (!code) return null;
  const map = await getStatusMap();
  return map.get(code) ?? null;
}

export async function getPriorityMap(): Promise<Map<string, PriorityInfo>> {
  const cached = fresh(priorityCache);
  if (cached) return cached;

  const rows = await prisma.priorityDefinition.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  });
  const map = new Map<string, PriorityInfo>(
    rows.map((r) => [
      r.code,
      { code: r.code, name: r.name, tone: r.tone, sortOrder: r.sortOrder },
    ]),
  );
  priorityCache = { loadedAt: Date.now(), value: map };
  return map;
}

export async function listPriorities(): Promise<PriorityInfo[]> {
  const map = await getPriorityMap();
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

// ---------------------------------------------------------------------------
// Kategoriler
// ---------------------------------------------------------------------------

export interface CategoryListItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  requiresManagerApproval: boolean;
  defaultPriority: string;
  defaultSlaHours: number | null;
  workflowDefinitionId: string | null;
  workflowName: string | null;
  hasActiveWorkflow: boolean;
  sortOrder: number;
}

/** Talep olusturma ekraninda gosterilecek kategoriler. */
export async function listActiveCategories(): Promise<CategoryListItem[]> {
  const rows = await prisma.requestCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { workflowDefinition: { select: { name: true, activeVersionId: true, status: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    requiresManagerApproval: r.requiresManagerApproval,
    defaultPriority: r.defaultPriority,
    defaultSlaHours: r.defaultSlaHours,
    workflowDefinitionId: r.workflowDefinitionId,
    workflowName: r.workflowDefinition?.name ?? null,
    hasActiveWorkflow: Boolean(r.workflowDefinition?.activeVersionId),
    sortOrder: r.sortOrder,
  }));
}

export async function listRoles() {
  return prisma.role.findMany({ orderBy: { sortOrder: 'asc' } });
}

export async function listGroups() {
  return prisma.userGroup.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, code: true, name: true },
  });
}
