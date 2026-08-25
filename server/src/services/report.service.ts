/**
 * Raporlama servisi (spec 01 - §15).
 *
 * Yetki: raporlar da buildVisibilityWhere() filtresinden gecer. Yani bir
 * calisan "toplam talep" metrigini gordugunde yalnizca kendi gorebildigi
 * kayitlarin sayisini gorur. Kurum genelinde rapor icin IK/Admin rolu gerekir.
 */

import { prisma } from '../db';
import type { AuthUser } from '../auth/auth-context';
import { SLA_STATUS } from '../domain/constants';
import { getPriorityMap, getStatusMap } from './catalog.service';
import { buildFilterWhere, type RequestListFilters } from './request.service';

const MS_PER_HOUR = 60 * 60 * 1000;

export interface ReportSummary {
  totals: {
    total: number;
    open: number;
    completed: number;
    rejected: number;
    cancelled: number;
    draft: number;
  };
  durations: {
    /** Gonderimden ilk yanita kadar ortalama saat. */
    averageFirstResponseHours: number | null;
    /** Gonderimden tamamlanmaya kadar ortalama saat. */
    averageCompletionHours: number | null;
    sampleSizeFirstResponse: number;
    sampleSizeCompletion: number;
  };
  sla: {
    met: number;
    missed: number;
    breachedOpen: number;
    atRiskOpen: number;
    notApplicable: number;
    /** Kapanmis ve SLA tanimli kayitlar icinde suresinde tamamlanma orani (%). */
    compliancePercent: number | null;
  };
  byStatus: Array<{ code: string; name: string; tone: string; count: number }>;
  byCategory: Array<{ id: string; code: string; name: string; count: number; openCount: number }>;
  byPriority: Array<{ code: string; name: string; tone: string; count: number }>;
  byDepartment: Array<{ department: string; count: number }>;
}

export async function getReportSummary(
  user: AuthUser,
  filters: RequestListFilters,
): Promise<ReportSummary> {
  const where = await buildFilterWhere(user, filters);
  const [statuses, priorities] = await Promise.all([getStatusMap(), getPriorityMap()]);

  const rows = await prisma.request.findMany({
    where,
    select: {
      id: true,
      statusCode: true,
      priority: true,
      categoryId: true,
      slaStatus: true,
      submittedAt: true,
      firstResponseAt: true,
      completedAt: true,
      closedAt: true,
      requesterDepartment: true,
      category: { select: { id: true, code: true, name: true } },
    },
  });

  const totals = {
    total: rows.length,
    open: 0,
    completed: 0,
    rejected: 0,
    cancelled: 0,
    draft: 0,
  };

  const statusCounts = new Map<string, number>();
  const categoryCounts = new Map<string, { code: string; name: string; count: number; openCount: number }>();
  const priorityCounts = new Map<string, number>();
  const departmentCounts = new Map<string, number>();

  const firstResponseDurations: number[] = [];
  const completionDurations: number[] = [];

  const sla = { met: 0, missed: 0, breachedOpen: 0, atRiskOpen: 0, notApplicable: 0 };

  for (const row of rows) {
    const statusInfo = statuses.get(row.statusCode);
    const isTerminal = statusInfo?.isTerminal ?? false;

    if (row.statusCode === 'DRAFT') totals.draft++;
    else if (!isTerminal) totals.open++;

    if (row.statusCode === 'COMPLETED') totals.completed++;
    if (row.statusCode === 'REJECTED') totals.rejected++;
    if (row.statusCode === 'CANCELLED') totals.cancelled++;

    statusCounts.set(row.statusCode, (statusCounts.get(row.statusCode) ?? 0) + 1);
    priorityCounts.set(row.priority, (priorityCounts.get(row.priority) ?? 0) + 1);

    const cat = categoryCounts.get(row.categoryId) ?? {
      code: row.category.code,
      name: row.category.name,
      count: 0,
      openCount: 0,
    };
    cat.count++;
    if (!isTerminal && row.statusCode !== 'DRAFT') cat.openCount++;
    categoryCounts.set(row.categoryId, cat);

    const dept = row.requesterDepartment ?? 'Belirtilmemiş';
    departmentCounts.set(dept, (departmentCounts.get(dept) ?? 0) + 1);

    if (row.submittedAt && row.firstResponseAt) {
      firstResponseDurations.push(
        (row.firstResponseAt.getTime() - row.submittedAt.getTime()) / MS_PER_HOUR,
      );
    }
    if (row.submittedAt && row.completedAt) {
      completionDurations.push(
        (row.completedAt.getTime() - row.submittedAt.getTime()) / MS_PER_HOUR,
      );
    }

    switch (row.slaStatus) {
      case SLA_STATUS.MET:
        sla.met++;
        break;
      case SLA_STATUS.MISSED:
        sla.missed++;
        break;
      case SLA_STATUS.BREACHED:
        sla.breachedOpen++;
        break;
      case SLA_STATUS.AT_RISK:
        sla.atRiskOpen++;
        break;
      case SLA_STATUS.NA:
        sla.notApplicable++;
        break;
      default:
        break;
    }
  }

  const average = (values: number[]): number | null =>
    values.length === 0
      ? null
      : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

  const slaClosedTotal = sla.met + sla.missed;

  return {
    totals,
    durations: {
      averageFirstResponseHours: average(firstResponseDurations),
      averageCompletionHours: average(completionDurations),
      sampleSizeFirstResponse: firstResponseDurations.length,
      sampleSizeCompletion: completionDurations.length,
    },
    sla: {
      ...sla,
      compliancePercent:
        slaClosedTotal === 0 ? null : Math.round((sla.met / slaClosedTotal) * 1000) / 10,
    },
    byStatus: [...statusCounts.entries()]
      .map(([code, count]) => ({
        code,
        name: statuses.get(code)?.name ?? code,
        tone: statuses.get(code)?.tone ?? 'neutral',
        count,
      }))
      .sort((a, b) => (statuses.get(a.code)?.sortOrder ?? 0) - (statuses.get(b.code)?.sortOrder ?? 0)),
    byCategory: [...categoryCounts.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count),
    byPriority: [...priorityCounts.entries()]
      .map(([code, count]) => ({
        code,
        name: priorities.get(code)?.name ?? code,
        tone: priorities.get(code)?.tone ?? 'neutral',
        count,
      }))
      .sort((a, b) => (priorities.get(b.code)?.sortOrder ?? 0) - (priorities.get(a.code)?.sortOrder ?? 0)),
    byDepartment: [...departmentCounts.entries()]
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 25),
  };
}

// ---------------------------------------------------------------------------
// Detayli satir export (CSV)
// ---------------------------------------------------------------------------

export interface ExportRow {
  requestNo: string;
  category: string;
  subject: string;
  requester: string;
  department: string;
  title: string;
  managerName: string;
  status: string;
  priority: string;
  currentStep: string;
  currentAssignee: string;
  workflowVersion: string;
  createdAt: string;
  submittedAt: string;
  firstResponseAt: string;
  completedAt: string;
  closedAt: string;
  dueDate: string;
  slaDueAt: string;
  slaStatus: string;
  completionHours: string;
}

function formatDate(value: Date | null | undefined): string {
  if (!value) return '';
  // Excel dostu yerel format
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(value.getDate())}.${pad(value.getMonth() + 1)}.${value.getFullYear()} ${pad(
    value.getHours(),
  )}:${pad(value.getMinutes())}`;
}

const SLA_LABELS: Record<string, string> = {
  NA: 'Tanımsız',
  ON_TRACK: 'Süresinde',
  AT_RISK: 'Riskli',
  BREACHED: 'Aşıldı',
  MET: 'Süresinde tamamlandı',
  MISSED: 'Süresi aşılarak tamamlandı',
};

export async function getExportRows(
  user: AuthUser,
  filters: RequestListFilters,
): Promise<ExportRow[]> {
  const where = await buildFilterWhere(user, filters);
  const [statuses, priorities] = await Promise.all([getStatusMap(), getPriorityMap()]);

  const rows = await prisma.request.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10000,
    include: {
      category: { select: { name: true } },
      requester: { select: { displayName: true, department: true, title: true } },
      instance: { include: { version: { select: { versionNumber: true } } } },
    },
  });

  const managerIds = [...new Set(rows.map((r) => r.requesterManagerId).filter(Boolean))] as string[];
  const managers = managerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: managerIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const managerMap = new Map(managers.map((m) => [m.id, m.displayName]));

  return rows.map((r) => ({
    requestNo: r.requestNo,
    category: r.category.name,
    subject: r.subject,
    requester: r.requester.displayName,
    department: r.requester.department ?? '',
    title: r.requester.title ?? '',
    managerName: r.requesterManagerId ? (managerMap.get(r.requesterManagerId) ?? '') : '',
    status: statuses.get(r.statusCode)?.name ?? r.statusCode,
    priority: priorities.get(r.priority)?.name ?? r.priority,
    currentStep: r.currentStepName ?? '',
    currentAssignee: r.currentAssigneeLabel ?? '',
    workflowVersion: r.instance ? `v${r.instance.version.versionNumber}` : '',
    createdAt: formatDate(r.createdAt),
    submittedAt: formatDate(r.submittedAt),
    firstResponseAt: formatDate(r.firstResponseAt),
    completedAt: formatDate(r.completedAt),
    closedAt: formatDate(r.closedAt),
    dueDate: formatDate(r.dueDate),
    slaDueAt: formatDate(r.slaDueAt),
    slaStatus: SLA_LABELS[r.slaStatus] ?? r.slaStatus,
    completionHours:
      r.submittedAt && r.completedAt
        ? String(
            Math.round(((r.completedAt.getTime() - r.submittedAt.getTime()) / MS_PER_HOUR) * 10) /
              10,
          )
        : '',
  }));
}

const CSV_HEADERS: Array<{ key: keyof ExportRow; label: string }> = [
  { key: 'requestNo', label: 'Talep No' },
  { key: 'category', label: 'Kategori' },
  { key: 'subject', label: 'Konu' },
  { key: 'requester', label: 'Talep Eden' },
  { key: 'department', label: 'Departman' },
  { key: 'title', label: 'Ünvan' },
  { key: 'managerName', label: 'Birinci Yönetici' },
  { key: 'status', label: 'Durum' },
  { key: 'priority', label: 'Öncelik' },
  { key: 'currentStep', label: 'Mevcut Adım' },
  { key: 'currentAssignee', label: 'Şu Anda Kimde' },
  { key: 'workflowVersion', label: 'İş Akışı Sürümü' },
  { key: 'createdAt', label: 'Oluşturma' },
  { key: 'submittedAt', label: 'Gönderim' },
  { key: 'firstResponseAt', label: 'İlk Yanıt' },
  { key: 'completedAt', label: 'Tamamlanma' },
  { key: 'closedAt', label: 'Kapanma' },
  { key: 'dueDate', label: 'Beklenen Termin' },
  { key: 'slaDueAt', label: 'SLA Bitiş' },
  { key: 'slaStatus', label: 'SLA Durumu' },
  { key: 'completionHours', label: 'Tamamlanma (saat)' },
];

function escapeCsv(value: string): string {
  // CSV injection korumasi: formul karakteri ile baslayan degerler notlanir.
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[";\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

/** Excel'in Turkce yerelde dogru acmasi icin ; ayirici + BOM. */
export function toCsv(rows: ExportRow[]): string {
  const header = CSV_HEADERS.map((h) => escapeCsv(h.label)).join(';');
  const body = rows.map((row) =>
    CSV_HEADERS.map((h) => escapeCsv(String(row[h.key] ?? ''))).join(';'),
  );
  return `﻿${[header, ...body].join('\r\n')}`;
}
