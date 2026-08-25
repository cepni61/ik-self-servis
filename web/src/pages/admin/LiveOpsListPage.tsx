import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, toQuery } from '../../api/client';
import type {
  CategoryListItem,
  LiveInstanceListItem,
  Paged,
  StatusInfo,
  WorkflowListItem,
} from '../../api/types';
import {
  EmptyState,
  ErrorNotice,
  Pagination,
  SlaChip,
  Spinner,
  StatusChip,
  formatDateTime,
} from '../../components/ui';

interface Filters {
  search: string;
  requestNo: string;
  definitionId: string;
  versionId: string;
  categoryId: string;
  statusCode: string;
  stepCode: string;
  slaStatus: string;
  instanceStatus: string;
  startedFrom: string;
  startedTo: string;
  page: number;
}

const EMPTY: Filters = {
  search: '',
  requestNo: '',
  definitionId: '',
  versionId: '',
  categoryId: '',
  statusCode: '',
  stepCode: '',
  slaStatus: '',
  instanceStatus: 'RUNNING',
  startedFrom: '',
  startedTo: '',
  page: 1,
};

const SLA_OPTIONS = [
  { value: 'ON_TRACK', label: 'Süresinde' },
  { value: 'AT_RISK', label: 'Riskli' },
  { value: 'BREACHED', label: 'Süresi aşıldı' },
  { value: 'NA', label: 'SLA tanımsız' },
];

/**
 * Canli surecler ekrani (spec 03 - §3).
 * Bu ekran surec TANIMINI degistirmez; yalnizca calisan kayitlari izler.
 */
export function LiveOpsListPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);

  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () =>
      api.get<{ categories: CategoryListItem[]; statuses: StatusInfo[] }>('/catalog/bootstrap'),
    staleTime: 5 * 60_000,
  });

  const workflows = useQuery({
    queryKey: ['admin-workflows'],
    queryFn: () => api.get<WorkflowListItem[]>('/admin/workflows'),
    staleTime: 60_000,
  });

  const versions = useQuery({
    queryKey: ['admin-workflow-versions', filters.definitionId],
    queryFn: () =>
      api.get<{ versions: Array<{ id: string; versionNumber: number; status: string }> }>(
        `/admin/workflows/${filters.definitionId}/versions`,
      ),
    enabled: Boolean(filters.definitionId),
  });

  const query = toQuery({
    search: filters.search,
    requestNo: filters.requestNo,
    definitionId: filters.definitionId,
    versionId: filters.versionId,
    categoryId: filters.categoryId,
    statusCode: filters.statusCode,
    stepCode: filters.stepCode,
    slaStatus: filters.slaStatus,
    instanceStatus: filters.instanceStatus,
    startedFrom: filters.startedFrom,
    startedTo: filters.startedTo,
    page: filters.page,
    pageSize: 25,
  });

  const instances = useQuery({
    queryKey: ['live-instances', query],
    queryFn: () => api.get<Paged<LiveInstanceListItem>>(`/admin/live/instances?${query}`),
    refetchInterval: 60_000,
  });

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value, ...(key === 'page' ? {} : { page: 1 }) }));

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-base font-semibold text-ink-900">Canlı Süreçler</h1>
        <p className="text-[12px] text-ink-500">
          Production ortamındaki çalışan iş akışı kayıtları. Müdahale, kayıt detayından yapılır.
        </p>
      </div>

      <section className="card">
        <div className="grid gap-3 border-b border-ink-200 px-4 py-3 sm:grid-cols-3 lg:grid-cols-6">
          <div>
            <label className="label" htmlFor="l-search">
              Ara
            </label>
            <input
              id="l-search"
              className="input"
              placeholder="Talep no, konu, kişi"
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="l-workflow">
              İş Akışı
            </label>
            <select
              id="l-workflow"
              className="input"
              value={filters.definitionId}
              onChange={(e) => {
                set('definitionId', e.target.value);
                set('versionId', '');
              }}
            >
              <option value="">Tümü</option>
              {(workflows.data ?? []).map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="l-version">
              Sürüm
            </label>
            <select
              id="l-version"
              className="input"
              value={filters.versionId}
              disabled={!filters.definitionId}
              onChange={(e) => set('versionId', e.target.value)}
            >
              <option value="">Tümü</option>
              {(versions.data?.versions ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.versionNumber}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="l-category">
              Kategori
            </label>
            <select
              id="l-category"
              className="input"
              value={filters.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
            >
              <option value="">Tümü</option>
              {(bootstrap.data?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="l-status">
              Talep Durumu
            </label>
            <select
              id="l-status"
              className="input"
              value={filters.statusCode}
              onChange={(e) => set('statusCode', e.target.value)}
            >
              <option value="">Tümü</option>
              {(bootstrap.data?.statuses ?? []).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="l-sla">
              SLA
            </label>
            <select
              id="l-sla"
              className="input"
              value={filters.slaStatus}
              onChange={(e) => set('slaStatus', e.target.value)}
            >
              <option value="">Tümü</option>
              {SLA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="l-instance-status">
              Süreç Durumu
            </label>
            <select
              id="l-instance-status"
              className="input"
              value={filters.instanceStatus}
              onChange={(e) => set('instanceStatus', e.target.value)}
            >
              <option value="RUNNING">Çalışan</option>
              <option value="COMPLETED">Tamamlanan</option>
              <option value="REJECTED">Reddedilen</option>
              <option value="CANCELLED">İptal edilen</option>
              <option value="RUNNING,COMPLETED,REJECTED,CANCELLED">Tümü</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="l-step">
              Adım Kodu
            </label>
            <input
              id="l-step"
              className="input font-mono"
              placeholder="HR_KONTROL"
              value={filters.stepCode}
              onChange={(e) => set('stepCode', e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label className="label" htmlFor="l-from">
              Başlangıç (min)
            </label>
            <input
              id="l-from"
              type="date"
              className="input"
              value={filters.startedFrom}
              onChange={(e) => set('startedFrom', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="l-to">
              Başlangıç (maks)
            </label>
            <input
              id="l-to"
              type="date"
              className="input"
              value={filters.startedTo}
              onChange={(e) => set('startedTo', e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button type="button" className="btn-default" onClick={() => setFilters(EMPTY)}>
              Temizle
            </button>
          </div>
        </div>

        {instances.isLoading && <Spinner />}
        {instances.isError && (
          <div className="p-4">
            <ErrorNotice
              message="Canlı süreçler yüklenemedi."
              onRetry={() => void instances.refetch()}
            />
          </div>
        )}

        {instances.data && instances.data.items.length === 0 && (
          <EmptyState title="Kayıt bulunamadı" hint="Filtreleri gevşetmeyi deneyin." />
        )}

        {instances.data && instances.data.items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Talep No</th>
                    <th>Talep Eden</th>
                    <th>Kategori</th>
                    <th>İş Akışı</th>
                    <th>Sürüm</th>
                    <th>Mevcut Adım</th>
                    <th>Durum</th>
                    <th>Sorumlu</th>
                    <th>Başlangıç</th>
                    <th>Son İşlem</th>
                    <th>SLA</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {instances.data.items.map((item) => (
                    <tr key={item.instanceId}>
                      <td>
                        <Link
                          to={`/yonetim/canli-surecler/${item.requestId}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {item.requestNo}
                        </Link>
                        <span className="block max-w-48 truncate text-[11px] text-ink-400">
                          {item.subject}
                        </span>
                      </td>
                      <td className="text-ink-700">
                        {item.requester.displayName}
                        {item.requester.department && (
                          <span className="block text-[11px] text-ink-400">
                            {item.requester.department}
                          </span>
                        )}
                      </td>
                      <td className="text-ink-700">{item.category.name}</td>
                      <td className="text-ink-700">{item.workflow.name}</td>
                      <td>
                        <span
                          className={`chip ${
                            item.workflowVersionStatus === 'ACTIVE'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-amber-200 bg-amber-50 text-amber-800'
                          }`}
                          title={
                            item.workflowVersionStatus === 'ACTIVE'
                              ? 'Güncel sürüm'
                              : 'Bu kayıt eski bir sürümde çalışıyor'
                          }
                        >
                          v{item.workflowVersion}
                        </span>
                      </td>
                      <td className="text-ink-700">
                        {item.currentStepName ?? '—'}
                        {item.currentStepCode && (
                          <span className="block font-mono text-[10px] text-ink-400">
                            {item.currentStepCode}
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusChip
                          name={item.currentStatus.name}
                          tone={item.currentStatus.tone}
                        />
                      </td>
                      <td className="text-ink-700">
                        {item.currentAssigneeLabel ?? '—'}
                        {item.isPoolTask && item.currentAssigneeLabel && (
                          <span className="block text-[10px] text-ink-400">Havuz görevi</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-ink-600">
                        {formatDateTime(item.startedAt)}
                      </td>
                      <td className="whitespace-nowrap text-ink-600">
                        {item.lastAction ? (
                          <>
                            {item.lastAction.actionName}
                            <span className="block text-[11px] text-ink-400">
                              {item.lastAction.byName} · {formatDateTime(item.lastAction.at)}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        <SlaChip status={item.slaStatus} remainingText={item.slaRemainingText} />
                      </td>
                      <td className="text-right">
                        <Link
                          to={`/yonetim/canli-surecler/${item.requestId}`}
                          className="btn-default btn-xs"
                        >
                          Detay
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={instances.data.page}
              totalPages={instances.data.totalPages}
              total={instances.data.total}
              onChange={(page) => set('page', page)}
            />
          </>
        )}
      </section>
    </div>
  );
}
