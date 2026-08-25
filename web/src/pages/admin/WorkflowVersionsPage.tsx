import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { WorkflowVersionSummary } from '../../api/types';
import { ErrorNotice, Spinner, formatDateTime, useToast } from '../../components/ui';

const VERSION_STATUS: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Taslak', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  ACTIVE: { label: 'Aktif', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  SUPERSEDED: {
    label: 'Yerine yenisi geçti',
    className: 'border-ink-300 bg-ink-100 text-ink-600',
  },
  ARCHIVED: { label: 'Arşivlendi', className: 'border-ink-300 bg-ink-100 text-ink-500' },
};

/**
 * Surum gecmisi.
 * Onemli: SUPERSEDED surumler silinmez; o surumle baslamis acik kayitlar hala
 * kendi surumu uzerinde calisir. "Açık Kayıt" kolonu bunu gosterir.
 */
export function WorkflowVersionsPage() {
  const { definitionId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const versions = useQuery({
    queryKey: ['admin-workflow-versions', definitionId],
    queryFn: () =>
      api.get<{
        definition: {
          id: string;
          code: string;
          name: string;
          status: string;
          activeVersionId: string | null;
        };
        versions: WorkflowVersionSummary[];
      }>(`/admin/workflows/${definitionId}/versions`),
  });

  const createRevision = useMutation({
    mutationFn: () =>
      api.post<{ versionId: string; versionNumber: number }>(
        `/admin/workflows/${definitionId}/revisions`,
        {},
      ),
    onSuccess: (result) => {
      toast.push('success', `v${result.versionNumber} taslak sürümü oluşturuldu.`);
      void queryClient.invalidateQueries({ queryKey: ['admin-workflow-versions', definitionId] });
      navigate(`/yonetim/is-akisi-surum/${result.versionId}`);
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Revizyon oluşturulamadı.'),
  });

  const deleteDraft = useMutation({
    mutationFn: (versionId: string) => api.del(`/admin/workflow-versions/${versionId}`),
    onSuccess: () => {
      toast.push('success', 'Taslak sürüm silindi.');
      void queryClient.invalidateQueries({ queryKey: ['admin-workflow-versions', definitionId] });
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Taslak silinemedi.'),
  });

  if (versions.isLoading) return <Spinner />;
  if (versions.isError || !versions.data) {
    return (
      <ErrorNotice message="Sürümler yüklenemedi." onRetry={() => void versions.refetch()} />
    );
  }

  const { definition, versions: list } = versions.data;
  const hasDraft = list.some((v) => v.status === 'DRAFT');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/yonetim/is-akislari" className="btn-ghost btn-xs">
              ← İş Akışları
            </Link>
            <h1 className="text-base font-semibold text-ink-900">{definition.name}</h1>
          </div>
          <p className="mt-0.5 ml-1 font-mono text-[12px] text-ink-500">{definition.code}</p>
        </div>
        {!hasDraft && (
          <button
            type="button"
            className="btn-primary"
            disabled={createRevision.isPending}
            onClick={() => createRevision.mutate()}
          >
            Revizyon Oluştur
          </button>
        )}
      </div>

      <div className="rounded border border-brand-200 bg-brand-50 px-3 py-2 text-[12px] text-brand-700">
        Yeni bir sürüm yayınlandığında, önceki sürümle başlamış açık kayıtlar otomatik olarak
        taşınmaz; kendi sürümleri üzerinde çalışmaya devam eder.
      </div>

      <section className="card">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Sürüm</th>
                <th>Durum</th>
                <th>Değişiklik Açıklaması</th>
                <th className="text-right">Adım</th>
                <th className="text-right">Açık Kayıt</th>
                <th className="text-right">Toplam Kayıt</th>
                <th>Oluşturma</th>
                <th>Yayınlama</th>
                <th>SLA Takvimi</th>
                <th>İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {list.map((v) => {
                const meta = VERSION_STATUS[v.status] ?? {
                  label: v.status,
                  className: 'border-ink-300 bg-ink-100 text-ink-600',
                };
                return (
                  <tr key={v.id}>
                    <td className="font-medium text-ink-900">v{v.versionNumber}</td>
                    <td>
                      <span className={`chip ${meta.className}`}>{meta.label}</span>
                      {v.isActive && (
                        <span className="mt-0.5 block text-[10px] text-ink-500">
                          Yeni talepler bu sürümü kullanır
                        </span>
                      )}
                    </td>
                    <td className="max-w-72 text-ink-700">{v.changeDescription ?? '—'}</td>
                    <td className="text-right text-ink-700">{v.stepCount}</td>
                    <td className="text-right font-medium text-ink-900">
                      {v.runningInstanceCount}
                    </td>
                    <td className="text-right text-ink-600">{v.totalInstanceCount}</td>
                    <td className="whitespace-nowrap text-ink-600">
                      {formatDateTime(v.createdAt)}
                      <span className="block text-[11px] text-ink-400">
                        {v.createdByName ?? '—'}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-ink-600">
                      {v.publishedAt ? (
                        <>
                          {formatDateTime(v.publishedAt)}
                          <span className="block text-[11px] text-ink-400">
                            {v.publishedByName ?? '—'}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="text-[12px] text-ink-600">
                      {v.slaCalendarMode === 'BUSINESS_DAYS' ? 'İş günü' : 'Takvim günü'}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <Link
                          to={`/yonetim/is-akisi-surum/${v.id}`}
                          className="btn-default btn-xs"
                        >
                          {v.status === 'DRAFT' ? 'Düzenle' : 'Görüntüle'}
                        </Link>
                        {v.status === 'DRAFT' && list.length > 1 && (
                          <button
                            type="button"
                            className="btn-default btn-xs"
                            disabled={deleteDraft.isPending}
                            onClick={() => deleteDraft.mutate(v.id)}
                          >
                            Sil
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
