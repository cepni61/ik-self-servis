import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, toQuery } from '../api/client';
import type { CategoryListItem, Paged, RequestListItem, StatusInfo } from '../api/types';
import {
  EmptyState,
  ErrorNotice,
  formatDate,
  Pagination,
  PriorityChip,
  SlaChip,
  Spinner,
  StatusChip,
} from '../components/ui';

interface Filters {
  search: string;
  categoryId: string;
  statusCode: string;
  scope: 'open' | 'closed' | 'all';
  page: number;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  categoryId: '',
  statusCode: '',
  scope: 'all',
  page: 1,
};

export function MyRequestsPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () =>
      api.get<{ categories: CategoryListItem[]; statuses: StatusInfo[] }>('/catalog/bootstrap'),
    staleTime: 5 * 60_000,
  });

  const query = toQuery({
    onlyMine: true,
    search: filters.search,
    categoryId: filters.categoryId,
    statusCode: filters.statusCode,
    scope: filters.scope === 'all' ? undefined : filters.scope,
    page: filters.page,
    pageSize: 20,
  });

  const requests = useQuery({
    queryKey: ['my-requests', query],
    queryFn: () => api.get<Paged<RequestListItem>>(`/requests?${query}`),
  });

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value, ...(key === 'page' ? {} : { page: 1 }) }));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-ink-900">Taleplerim</h1>
          <p className="text-[12px] text-ink-500">
            Oluşturduğunuz tüm talepler ve güncel durumları.
          </p>
        </div>
        <Link to="/talep/yeni" className="btn-primary">
          Yeni Talep Oluştur
        </Link>
      </div>

      <section className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-ink-200 px-4 py-3">
          <div className="min-w-56 flex-1">
            <label className="label" htmlFor="search">
              Ara
            </label>
            <input
              id="search"
              className="input"
              placeholder="Talep no, konu veya açıklama"
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
            />
          </div>
          <div className="w-64">
            <label className="label" htmlFor="category">
              Kategori
            </label>
            <select
              id="category"
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
          <div className="w-56">
            <label className="label" htmlFor="status">
              Durum
            </label>
            <select
              id="status"
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
          <div className="w-40">
            <label className="label" htmlFor="scope">
              Kapsam
            </label>
            <select
              id="scope"
              className="input"
              value={filters.scope}
              onChange={(e) => set('scope', e.target.value as Filters['scope'])}
            >
              <option value="all">Tümü</option>
              <option value="open">Açık</option>
              <option value="closed">Kapanmış</option>
            </select>
          </div>
          <button
            type="button"
            className="btn-default"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            Temizle
          </button>
        </div>

        {requests.isLoading && <Spinner />}
        {requests.isError && (
          <div className="p-4">
            <ErrorNotice
              message="Talepler yüklenemedi."
              onRetry={() => void requests.refetch()}
            />
          </div>
        )}

        {requests.data && requests.data.items.length === 0 && (
          <EmptyState
            title="Kayıt bulunamadı"
            hint="Filtreleri değiştirin veya yeni bir talep oluşturun."
          />
        )}

        {requests.data && requests.data.items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Talep No</th>
                    <th>Kategori</th>
                    <th>Konu</th>
                    <th>Durum</th>
                    <th>Şu Anda Kimde</th>
                    <th>Öncelik</th>
                    <th>SLA</th>
                    <th>Oluşturma</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.data.items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <Link
                          to={`/talep/${item.id}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {item.requestNo}
                        </Link>
                      </td>
                      <td className="text-ink-700">{item.category.name}</td>
                      <td className="max-w-72 truncate text-ink-800" title={item.subject}>
                        {item.subject}
                      </td>
                      <td>
                        <StatusChip name={item.status.name} tone={item.status.tone} />
                      </td>
                      <td className="text-ink-700">
                        {item.currentAssigneeLabel ?? '—'}
                        {item.currentStepName && (
                          <span className="block text-[11px] text-ink-400">
                            {item.currentStepName}
                          </span>
                        )}
                      </td>
                      <td>
                        <PriorityChip name={item.priority.name} tone={item.priority.tone} />
                      </td>
                      <td>
                        <SlaChip status={item.slaStatus} remainingText={item.slaRemainingText} />
                      </td>
                      <td className="whitespace-nowrap text-ink-600">
                        {formatDate(item.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={requests.data.page}
              totalPages={requests.data.totalPages}
              total={requests.data.total}
              onChange={(page) => set('page', page)}
            />
          </>
        )}
      </section>
    </div>
  );
}
