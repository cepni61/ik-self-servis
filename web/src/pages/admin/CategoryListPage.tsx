import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { AdminCategoryListItem, PriorityInfo, WorkflowListItem } from '../../api/types';
import { ErrorNotice, Modal, Spinner, useToast } from '../../components/ui';

export function CategoryListPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    description: '',
    requestNoPrefix: '',
    requiresManagerApproval: false,
    defaultPriority: 'MEDIUM',
    defaultSlaHours: '',
    workflowDefinitionId: '',
  });
  const [error, setError] = useState<string | null>(null);

  const categories = useQuery({
    queryKey: ['admin-categories'],
    queryFn: () => api.get<AdminCategoryListItem[]>('/admin/categories'),
  });

  const workflows = useQuery({
    queryKey: ['admin-workflows'],
    queryFn: () => api.get<WorkflowListItem[]>('/admin/workflows'),
    staleTime: 60_000,
  });

  const priorities = useQuery({
    queryKey: ['priorities'],
    queryFn: () => api.get<PriorityInfo[]>('/catalog/priorities'),
    staleTime: 10 * 60_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.post('/admin/categories', {
        code: form.code,
        name: form.name,
        description: form.description || null,
        requestNoPrefix: form.requestNoPrefix || null,
        requiresManagerApproval: form.requiresManagerApproval,
        defaultPriority: form.defaultPriority,
        defaultSlaHours: form.defaultSlaHours ? Number(form.defaultSlaHours) : null,
        workflowDefinitionId: form.workflowDefinitionId || null,
      }),
    onSuccess: () => {
      toast.push('success', 'Kategori oluşturuldu.');
      setCreateOpen(false);
      setForm({
        code: '',
        name: '',
        description: '',
        requestNoPrefix: '',
        requiresManagerApproval: false,
        defaultPriority: 'MEDIUM',
        defaultSlaHours: '',
        workflowDefinitionId: '',
      });
      invalidate();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Kategori oluşturulamadı.'),
  });

  const toggleActive = useMutation({
    mutationFn: (input: { id: string; isActive: boolean }) =>
      input.isActive
        ? api.patch(`/admin/categories/${input.id}`, { isActive: true })
        : api.post(`/admin/categories/${input.id}/deactivate`),
    onSuccess: () => {
      toast.push('success', 'Kategori durumu güncellendi.');
      invalidate();
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Güncellenemedi.'),
  });

  if (categories.isLoading) return <Spinner />;
  if (categories.isError || !categories.data) {
    return (
      <ErrorNotice message="Kategoriler yüklenemedi." onRetry={() => void categories.refetch()} />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-ink-900">Talep Kategorileri</h1>
          <p className="text-[12px] text-ink-500">
            Kategori davranışları (yönetici onayı, SLA, sorumlu, form alanları) buradan yönetilir.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setError(null);
            setCreateOpen(true);
          }}
        >
          Yeni Kategori
        </button>
      </div>

      <section className="card">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Kategori</th>
                <th>Kod</th>
                <th>Talep No Öneki</th>
                <th>Yönetici Onayı</th>
                <th>Varsayılan Öncelik</th>
                <th>Hedef Süre</th>
                <th>İş Akışı</th>
                <th>Sorumlu Rol</th>
                <th className="text-right">Alan</th>
                <th className="text-right">Talep</th>
                <th>Durum</th>
                <th>İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {categories.data.map((cat) => (
                <tr key={cat.id} className={cat.isActive ? undefined : 'opacity-60'}>
                  <td>
                    <div className="font-medium text-ink-900">{cat.name}</div>
                    {cat.description && (
                      <div className="max-w-64 truncate text-[11px] text-ink-500">
                        {cat.description}
                      </div>
                    )}
                  </td>
                  <td className="font-mono text-[12px] text-ink-600">{cat.code}</td>
                  <td className="font-mono text-[12px] text-ink-600">
                    {cat.requestNoPrefix ?? '—'}
                  </td>
                  <td>
                    <span
                      className={`chip ${
                        cat.requiresManagerApproval
                          ? 'border-brand-200 bg-brand-50 text-brand-700'
                          : 'border-ink-200 bg-ink-50 text-ink-600'
                      }`}
                    >
                      {cat.requiresManagerApproval ? 'Gerekli' : 'Gerekli değil'}
                    </span>
                  </td>
                  <td className="text-ink-700">{cat.defaultPriority}</td>
                  <td className="whitespace-nowrap text-ink-700">
                    {cat.defaultSlaHours ? `${cat.defaultSlaHours} saat` : '—'}
                  </td>
                  <td>
                    {cat.workflow ? (
                      <>
                        <span className="text-ink-800">{cat.workflow.name}</span>
                        {!cat.hasPublishedWorkflow && (
                          <span className="chip mt-0.5 block w-fit border-red-200 bg-red-50 text-red-700">
                            Yayınlanmamış
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="chip border-red-200 bg-red-50 text-red-700">
                        Atanmamış
                      </span>
                    )}
                  </td>
                  <td className="text-ink-700">{cat.ownerRoleCode ?? '—'}</td>
                  <td className="text-right text-ink-700">{cat.formFieldCount}</td>
                  <td className="text-right text-ink-700">
                    {cat.requestCount}
                    {cat.openRequestCount > 0 && (
                      <span className="block text-[11px] text-ink-400">
                        {cat.openRequestCount} açık
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`chip ${
                        cat.isActive
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-ink-300 bg-ink-100 text-ink-600'
                      }`}
                    >
                      {cat.isActive ? 'Aktif' : 'Pasif'}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <Link
                        to={`/yonetim/kategoriler/${cat.id}`}
                        className="btn-default btn-xs"
                      >
                        Düzenle
                      </Link>
                      <button
                        type="button"
                        className="btn-default btn-xs"
                        onClick={() =>
                          toggleActive.mutate({ id: cat.id, isActive: !cat.isActive })
                        }
                      >
                        {cat.isActive ? 'Pasife Al' : 'Aktifleştir'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {createOpen && (
        <Modal
          title="Yeni Talep Kategorisi"
          onClose={() => setCreateOpen(false)}
          width="max-w-2xl"
          footer={
            <>
              <button
                type="button"
                className="btn-default"
                onClick={() => setCreateOpen(false)}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  form.code.trim().length < 2 || form.name.trim().length < 2 || create.isPending
                }
                onClick={() => create.mutate()}
              >
                Oluştur
              </button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="cat-name">
                Kategori Adı <span className="text-red-600">*</span>
              </label>
              <input
                id="cat-name"
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="cat-code">
                Kod <span className="text-red-600">*</span>
              </label>
              <input
                id="cat-code"
                className="input font-mono"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="cat-prefix">
                Talep No Öneki
              </label>
              <input
                id="cat-prefix"
                className="input font-mono"
                maxLength={8}
                placeholder="Örn. BRD"
                value={form.requestNoPrefix}
                onChange={(e) =>
                  setForm((f) => ({ ...f, requestNoPrefix: e.target.value.toUpperCase() }))
                }
              />
            </div>
            <div>
              <label className="label" htmlFor="cat-workflow">
                İş Akışı
              </label>
              <select
                id="cat-workflow"
                className="input"
                value={form.workflowDefinitionId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, workflowDefinitionId: e.target.value }))
                }
              >
                <option value="">Seçiniz…</option>
                {(workflows.data ?? []).map((wf) => (
                  <option key={wf.id} value={wf.id}>
                    {wf.name}
                    {wf.activeVersion ? ` (v${wf.activeVersion.versionNumber})` : ' (yayınlanmadı)'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cat-priority">
                Varsayılan Öncelik
              </label>
              <select
                id="cat-priority"
                className="input"
                value={form.defaultPriority}
                onChange={(e) => setForm((f) => ({ ...f, defaultPriority: e.target.value }))}
              >
                {(priorities.data ?? []).map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cat-sla">
                Hedef Süre (saat)
              </label>
              <input
                id="cat-sla"
                type="number"
                min={1}
                max={8760}
                className="input"
                value={form.defaultSlaHours}
                onChange={(e) => setForm((f) => ({ ...f, defaultSlaHours: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-[13px] text-ink-800">
                <input
                  type="checkbox"
                  className="size-4 rounded border-ink-300"
                  checked={form.requiresManagerApproval}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, requiresManagerApproval: e.target.checked }))
                  }
                />
                Bu kategoride birinci yönetici onayı gerekli
              </label>
              <p className="hint">
                Standart iş akışındaki “Yönetici Onayı” adımı bu ayara göre çalışır.
              </p>
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="cat-desc">
                Açıklama
              </label>
              <textarea
                id="cat-desc"
                className="input"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            {error && (
              <p className="sm:col-span-2 rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-700">
                {error}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
