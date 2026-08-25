import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, toQuery } from '../api/client';
import type { Paged, TaskListItem } from '../api/types';
import {
  EmptyState,
  ErrorNotice,
  Pagination,
  PriorityChip,
  SlaChip,
  Spinner,
  StatusChip,
  formatDateTime,
} from '../components/ui';

/**
 * Gorev kutusu: kullaniciya dusen, islem bekleyen talepler.
 * Hem kisisel gorevler (dogrudan atanmis) hem havuz gorevleri (rol/ekip) burada.
 */
export function TasksPage() {
  const [page, setPage] = useState(1);

  const tasks = useQuery({
    queryKey: ['tasks', page],
    queryFn: () =>
      api.get<Paged<TaskListItem>>(`/requests/tasks/inbox?${toQuery({ page, pageSize: 20 })}`),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-base font-semibold text-ink-900">Görevlerim</h1>
        <p className="text-[12px] text-ink-500">
          İşlem yapmanız beklenen talepler. Süresi dolmaya en yakın olanlar üstte.
        </p>
      </div>

      <section className="card">
        {tasks.isLoading && <Spinner />}
        {tasks.isError && (
          <div className="p-4">
            <ErrorNotice message="Görevler yüklenemedi." onRetry={() => void tasks.refetch()} />
          </div>
        )}

        {tasks.data && tasks.data.items.length === 0 && (
          <EmptyState
            title="Bekleyen görev yok"
            hint="Size yönlendirilen bir talep olduğunda burada görünecek."
          />
        )}

        {tasks.data && tasks.data.items.length > 0 && (
          <>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Talep No</th>
                    <th>Kategori</th>
                    <th>Konu</th>
                    <th>Talep Eden</th>
                    <th>Adım</th>
                    <th>Durum</th>
                    <th>Öncelik</th>
                    <th>SLA</th>
                    <th>Gönderim</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {tasks.data.items.map((item) => (
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
                      <td className="max-w-64 truncate text-ink-800" title={item.subject}>
                        {item.subject}
                      </td>
                      <td className="text-ink-700">
                        {item.requester.displayName}
                        {item.requester.department && (
                          <span className="block text-[11px] text-ink-400">
                            {item.requester.department}
                          </span>
                        )}
                      </td>
                      <td className="text-ink-700">
                        {item.currentStepName ?? '—'}
                        {item.isPoolTask && (
                          <span className="chip mt-0.5 block w-fit border-ink-200 bg-ink-50 text-ink-500">
                            Ekip havuzu
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusChip name={item.status.name} tone={item.status.tone} />
                      </td>
                      <td>
                        <PriorityChip name={item.priority.name} tone={item.priority.tone} />
                      </td>
                      <td>
                        <SlaChip status={item.slaStatus} remainingText={item.slaRemainingText} />
                      </td>
                      <td className="whitespace-nowrap text-ink-600">
                        {formatDateTime(item.submittedAt)}
                      </td>
                      <td className="text-right">
                        <Link to={`/talep/${item.id}`} className="btn-primary btn-xs">
                          İşlem Yap
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={tasks.data.page}
              totalPages={tasks.data.totalPages}
              total={tasks.data.total}
              onChange={setPage}
            />
          </>
        )}
      </section>
    </div>
  );
}
