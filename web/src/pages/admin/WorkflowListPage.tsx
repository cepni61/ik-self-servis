import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { WorkflowListItem } from '../../api/types';
import {
  EmptyState,
  ErrorNotice,
  Modal,
  Spinner,
  formatDateTime,
  useToast,
} from '../../components/ui';

const DEFINITION_STATUS: Record<string, { label: string; tone: string }> = {
  DRAFT: { label: 'Taslak', tone: 'neutral' },
  ACTIVE: { label: 'Aktif', tone: 'success' },
  INACTIVE: { label: 'Pasif', tone: 'warning' },
  ARCHIVED: { label: 'Arşivlendi', tone: 'neutral' },
};

const TONE: Record<string, string> = {
  neutral: 'border-ink-300 bg-ink-100 text-ink-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
};

export function WorkflowListPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [copySource, setCopySource] = useState<WorkflowListItem | null>(null);
  const [form, setForm] = useState({ code: '', name: '', description: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const workflows = useQuery({
    queryKey: ['admin-workflows'],
    queryFn: () => api.get<WorkflowListItem[]>('/admin/workflows'),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-workflows'] });

  const handleError = (err: unknown, fallback: string) => {
    setFormError(err instanceof ApiError ? err.message : fallback);
  };

  const create = useMutation({
    mutationFn: () =>
      api.post<{ definitionId: string; versionId: string }>('/admin/workflows', {
        code: form.code,
        name: form.name,
        description: form.description || null,
        useStarterTemplate: true,
      }),
    onSuccess: (result) => {
      toast.push('success', 'İş akışı oluşturuldu. Taslak sürüm düzenlenebilir.');
      setCreateOpen(false);
      setForm({ code: '', name: '', description: '' });
      void invalidate();
      navigate(`/yonetim/is-akisi-surum/${result.versionId}`);
    },
    onError: (err) => handleError(err, 'İş akışı oluşturulamadı.'),
  });

  const copy = useMutation({
    mutationFn: () =>
      api.post<{ versionId: string }>(`/admin/workflows/${copySource!.id}/copy`, {
        code: form.code,
        name: form.name,
      }),
    onSuccess: (result) => {
      toast.push('success', 'İş akışı kopyalandı.');
      setCopySource(null);
      setForm({ code: '', name: '', description: '' });
      void invalidate();
      navigate(`/yonetim/is-akisi-surum/${result.versionId}`);
    },
    onError: (err) => handleError(err, 'Kopyalanamadı.'),
  });

  const createRevision = useMutation({
    mutationFn: (definitionId: string) =>
      api.post<{ versionId: string; versionNumber: number }>(
        `/admin/workflows/${definitionId}/revisions`,
        {},
      ),
    onSuccess: (result) => {
      toast.push(
        'success',
        `v${result.versionNumber} taslak sürümü oluşturuldu. Aktif sürüm değişmedi.`,
      );
      void invalidate();
      navigate(`/yonetim/is-akisi-surum/${result.versionId}`);
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Revizyon oluşturulamadı.'),
  });

  const setStatus = useMutation({
    mutationFn: (input: { id: string; status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' }) =>
      api.post(`/admin/workflows/${input.id}/status`, { status: input.status }),
    onSuccess: () => {
      toast.push('success', 'Durum güncellendi.');
      void invalidate();
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Durum güncellenemedi.'),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-ink-900">İş Akışları</h1>
          <p className="text-[12px] text-ink-500">
            Yayınlanmış sürümler doğrudan değiştirilemez. Değişiklik için revizyon oluşturun.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setForm({ code: '', name: '', description: '' });
            setFormError(null);
            setCreateOpen(true);
          }}
        >
          Yeni İş Akışı
        </button>
      </div>

      <section className="card">
        {workflows.isLoading && <Spinner />}
        {workflows.isError && (
          <div className="p-4">
            <ErrorNotice
              message="İş akışları yüklenemedi."
              onRetry={() => void workflows.refetch()}
            />
          </div>
        )}

        {workflows.data && workflows.data.length === 0 && (
          <EmptyState title="Tanımlı iş akışı yok" hint="Yeni bir iş akışı oluşturun." />
        )}

        {workflows.data && workflows.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>İş Akışı</th>
                  <th>Kod</th>
                  <th>İlgili Kategoriler</th>
                  <th>Aktif Sürüm</th>
                  <th>Durum</th>
                  <th className="text-right">Açık Kayıt</th>
                  <th>Son Güncelleme</th>
                  <th>Güncelleyen</th>
                  <th>İşlemler</th>
                </tr>
              </thead>
              <tbody>
                {workflows.data.map((wf) => {
                  const status = DEFINITION_STATUS[wf.status] ?? {
                    label: wf.status,
                    tone: 'neutral',
                  };
                  return (
                    <tr key={wf.id}>
                      <td>
                        <div className="font-medium text-ink-900">{wf.name}</div>
                        {wf.description && (
                          <div className="max-w-72 truncate text-[11px] text-ink-500">
                            {wf.description}
                          </div>
                        )}
                      </td>
                      <td className="font-mono text-[12px] text-ink-600">{wf.code}</td>
                      <td className="max-w-64">
                        {wf.categories.length === 0 ? (
                          <span className="text-ink-400">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {wf.categories.map((c) => (
                              <span
                                key={c.id}
                                className="chip border-ink-200 bg-ink-50 text-ink-600"
                              >
                                {c.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        {wf.activeVersion ? (
                          <Link
                            to={`/yonetim/is-akisi-surum/${wf.activeVersion.id}`}
                            className="text-brand-600 hover:underline"
                          >
                            v{wf.activeVersion.versionNumber}
                          </Link>
                        ) : (
                          <span className="text-ink-400">Yayınlanmadı</span>
                        )}
                        {wf.draftVersion && (
                          <Link
                            to={`/yonetim/is-akisi-surum/${wf.draftVersion.id}`}
                            className="chip mt-0.5 block w-fit border-amber-200 bg-amber-50 text-amber-800 hover:underline"
                          >
                            v{wf.draftVersion.versionNumber} taslak
                          </Link>
                        )}
                      </td>
                      <td>
                        <span className={`chip ${TONE[status.tone]}`}>{status.label}</span>
                      </td>
                      <td className="text-right font-medium text-ink-800">
                        {wf.activeInstanceCount}
                      </td>
                      <td className="whitespace-nowrap text-ink-600">
                        {formatDateTime(wf.updatedAt)}
                      </td>
                      <td className="text-ink-600">{wf.updatedByName ?? '—'}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          <Link
                            to={`/yonetim/is-akislari/${wf.id}/surumler`}
                            className="btn-default btn-xs"
                          >
                            Sürümler
                          </Link>
                          {!wf.draftVersion && (
                            <button
                              type="button"
                              className="btn-default btn-xs"
                              disabled={createRevision.isPending}
                              onClick={() => createRevision.mutate(wf.id)}
                            >
                              Revizyon Oluştur
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-default btn-xs"
                            onClick={() => {
                              setCopySource(wf);
                              setForm({
                                code: `${wf.code}_KOPYA`,
                                name: `${wf.name} (Kopya)`,
                                description: '',
                              });
                              setFormError(null);
                            }}
                          >
                            Kopyala
                          </button>
                          {wf.status !== 'ACTIVE' && wf.activeVersion && (
                            <button
                              type="button"
                              className="btn-default btn-xs"
                              onClick={() => setStatus.mutate({ id: wf.id, status: 'ACTIVE' })}
                            >
                              Aktifleştir
                            </button>
                          )}
                          {wf.status === 'ACTIVE' && (
                            <button
                              type="button"
                              className="btn-default btn-xs"
                              onClick={() => setStatus.mutate({ id: wf.id, status: 'INACTIVE' })}
                            >
                              Pasife Al
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
        )}
      </section>

      {(createOpen || copySource) && (
        <Modal
          title={copySource ? `Kopyala: ${copySource.name}` : 'Yeni İş Akışı'}
          onClose={() => {
            setCreateOpen(false);
            setCopySource(null);
          }}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                className="btn-default"
                onClick={() => {
                  setCreateOpen(false);
                  setCopySource(null);
                }}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  form.code.trim().length < 2 ||
                  form.name.trim().length < 2 ||
                  create.isPending ||
                  copy.isPending
                }
                onClick={() => (copySource ? copy.mutate() : create.mutate())}
              >
                {copySource ? 'Kopyala' : 'Oluştur'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="wf-name">
                İş Akışı Adı <span className="text-red-600">*</span>
              </label>
              <input
                id="wf-name"
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="wf-code">
                İş Akışı Kodu <span className="text-red-600">*</span>
              </label>
              <input
                id="wf-code"
                className="input font-mono"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              />
              <p className="hint">
                Büyük harf, rakam ve alt çizgi. Sonradan değiştirilemez.
              </p>
            </div>
            {!copySource && (
              <div>
                <label className="label" htmlFor="wf-desc">
                  Açıklama
                </label>
                <textarea
                  id="wf-desc"
                  className="input"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
            )}
            {!copySource && (
              <p className="rounded border border-brand-200 bg-brand-50 px-2.5 py-2 text-[12px] text-brand-700">
                Başlangıç iskeleti olarak Talep Oluşturma → İK Kontrol → Tamamlandı adımları
                oluşturulur. Adımları sonra düzenleyebilirsiniz.
              </p>
            )}
            {formError && (
              <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-700">
                {formError}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
