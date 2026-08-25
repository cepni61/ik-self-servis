import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type {
  AdminCategoryDetail,
  AdminMeta,
  PriorityInfo,
  WorkflowListItem,
} from '../../api/types';
import {
  Disclosure,
  ErrorNotice,
  Modal,
  Spinner,
  useToast,
} from '../../components/ui';

const FIELD_TYPE_LABELS: Record<string, string> = {
  TEXT: 'Kısa metin',
  LONG_TEXT: 'Uzun metin',
  NUMBER: 'Sayı',
  DATE: 'Tarih',
  DROPDOWN: 'Tek seçim',
  MULTI_SELECT: 'Çok seçim',
  USER: 'Kullanıcı',
  FILE: 'Dosya',
  CHECKBOX: 'Onay kutusu',
};

interface FieldForm {
  key: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  isReadOnly: boolean;
  isHidden: boolean;
  helpText: string;
  placeholder: string;
  defaultValue: string;
  optionsText: string;
  min: string;
  max: string;
  maxLength: string;
  pattern: string;
}

function emptyField(): FieldForm {
  return {
    key: '',
    label: '',
    fieldType: 'TEXT',
    isRequired: false,
    isReadOnly: false,
    isHidden: false,
    helpText: '',
    placeholder: '',
    defaultValue: '',
    optionsText: '',
    min: '',
    max: '',
    maxLength: '',
    pattern: '',
  };
}

export function CategoryDetailPage() {
  const { categoryId = '' } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [fieldModal, setFieldModal] = useState<{ fieldId: string | null } | null>(null);
  const [fieldForm, setFieldForm] = useState<FieldForm>(emptyField());
  const [modalError, setModalError] = useState<string | null>(null);

  const category = useQuery({
    queryKey: ['admin-category', categoryId],
    queryFn: () => api.get<AdminCategoryDetail>(`/admin/categories/${categoryId}`),
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

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Array<{ code: string; name: string }>>('/catalog/roles'),
    staleTime: 10 * 60_000,
  });

  const groups = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/catalog/groups'),
    staleTime: 10 * 60_000,
  });

  const meta = useQuery({
    queryKey: ['admin-meta'],
    queryFn: () => api.get<AdminMeta>('/admin/meta'),
    staleTime: 10 * 60_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-category', categoryId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-categories'] });
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
  };

  const updateCategory = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      api.patch(`/admin/categories/${categoryId}`, patch),
    onSuccess: () => {
      toast.push('success', 'Kategori güncellendi.');
      invalidate();
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Güncellenemedi.'),
  });

  const saveField = useMutation({
    mutationFn: (input: { fieldId: string | null; form: FieldForm }) => {
      const options = input.form.optionsText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [value, ...rest] = line.split('|');
          return {
            value: value.trim(),
            label: (rest.join('|') || value).trim(),
          };
        });

      const validation: Record<string, unknown> = {};
      if (input.form.min) validation.min = Number(input.form.min);
      if (input.form.max) validation.max = Number(input.form.max);
      if (input.form.maxLength) validation.maxLength = Number(input.form.maxLength);
      if (input.form.pattern) validation.pattern = input.form.pattern;

      const payload = {
        label: input.form.label,
        fieldType: input.form.fieldType,
        isRequired: input.form.isRequired,
        isReadOnly: input.form.isReadOnly,
        isHidden: input.form.isHidden,
        helpText: input.form.helpText || null,
        placeholder: input.form.placeholder || null,
        defaultValue: input.form.defaultValue || null,
        options: options.length > 0 ? options : undefined,
        validation: Object.keys(validation).length > 0 ? validation : null,
      };

      return input.fieldId
        ? api.patch(`/admin/form-fields/${input.fieldId}`, payload)
        : api.post(`/admin/categories/${categoryId}/form-fields`, {
            ...payload,
            key: input.form.key,
          });
    },
    onSuccess: () => {
      toast.push('success', 'Form alanı kaydedildi.');
      setFieldModal(null);
      setModalError(null);
      invalidate();
    },
    onError: (err) =>
      setModalError(err instanceof ApiError ? err.message : 'Alan kaydedilemedi.'),
  });

  const removeField = useMutation({
    mutationFn: (fieldId: string) => api.del<{ deactivatedInsteadOfDeleted: boolean; usedCount: number }>(`/admin/form-fields/${fieldId}`),
    onSuccess: (result) => {
      toast.push(
        'success',
        result.deactivatedInsteadOfDeleted
          ? `Alan ${result.usedCount} talepte kullanıldığı için silinmedi, pasife alındı.`
          : 'Form alanı silindi.',
      );
      invalidate();
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Alan silinemedi.'),
  });

  useEffect(() => {
    if (!fieldModal?.fieldId || !category.data) return;
    const field = category.data.formFields.find((f) => f.id === fieldModal.fieldId);
    if (!field) return;
    setFieldForm({
      key: field.key,
      label: field.label,
      fieldType: field.fieldType,
      isRequired: field.isRequired,
      isReadOnly: field.isReadOnly,
      isHidden: field.isHidden,
      helpText: field.helpText ?? '',
      placeholder: field.placeholder ?? '',
      defaultValue: field.defaultValue ?? '',
      optionsText: (field.options ?? [])
        .map((o) => (o.value === o.label ? o.value : `${o.value}|${o.label}`))
        .join('\n'),
      min: field.validation?.min !== undefined ? String(field.validation.min) : '',
      max: field.validation?.max !== undefined ? String(field.validation.max) : '',
      maxLength:
        field.validation?.maxLength !== undefined ? String(field.validation.maxLength) : '',
      pattern: field.validation?.pattern ?? '',
    });
  }, [fieldModal, category.data]);

  if (category.isLoading) return <Spinner />;
  if (category.isError || !category.data) {
    return (
      <ErrorNotice message="Kategori yüklenemedi." onRetry={() => void category.refetch()} />
    );
  }

  const cat = category.data;
  const needsOptions = ['DROPDOWN', 'MULTI_SELECT'].includes(fieldForm.fieldType);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link to="/yonetim/kategoriler" className="btn-ghost btn-xs">
          ← Kategoriler
        </Link>
        <h1 className="text-base font-semibold text-ink-900">{cat.name}</h1>
        <span className="font-mono text-[12px] text-ink-500">{cat.code}</span>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Kategori Ayarları</h2>
        </div>
        <div className="grid gap-4 px-4 py-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="c-name">
              Kategori Adı
            </label>
            <input
              id="c-name"
              className="input"
              defaultValue={cat.name}
              onBlur={(e) => {
                if (e.target.value !== cat.name) updateCategory.mutate({ name: e.target.value });
              }}
            />
          </div>

          <div>
            <label className="label" htmlFor="c-workflow">
              Bağlı İş Akışı
            </label>
            <select
              id="c-workflow"
              className="input"
              value={cat.workflowDefinitionId ?? ''}
              onChange={(e) =>
                updateCategory.mutate({ workflowDefinitionId: e.target.value || null })
              }
            >
              <option value="">Seçilmedi</option>
              {(workflows.data ?? []).map((wf) => (
                <option key={wf.id} value={wf.id}>
                  {wf.name}
                  {wf.activeVersion ? ` (v${wf.activeVersion.versionNumber})` : ' (yayınlanmadı)'}
                </option>
              ))}
            </select>
            {cat.workflow?.activeVersionId && (
              <Link
                to={`/yonetim/is-akisi-surum/${cat.workflow.activeVersionId}`}
                className="hint text-brand-600 underline"
              >
                Aktif sürümü görüntüle
              </Link>
            )}
          </div>

          <div>
            <label className="label" htmlFor="c-owner">
              Sorumlu Rol
            </label>
            <select
              id="c-owner"
              className="input"
              value={cat.ownerRoleCode ?? ''}
              onChange={(e) => updateCategory.mutate({ ownerRoleCode: e.target.value || null })}
            >
              <option value="">Belirtilmedi</option>
              {(roles.data ?? [])
                .filter((r) => r.code === 'HR_USER' || r.code === 'HR_PROCESS_OWNER')
                .map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
            </select>
            <p className="hint">Bu kategorinin İK adımlarını hangi rol karşılar.</p>
          </div>

          <div>
            <label className="label" htmlFor="c-group">
              Sorumlu Ekip
            </label>
            <select
              id="c-group"
              className="input"
              value={cat.ownerGroupId ?? ''}
              onChange={(e) => updateCategory.mutate({ ownerGroupId: e.target.value || null })}
            >
              <option value="">Belirtilmedi</option>
              {(groups.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <p className="hint">Ekip seçilirse İK görevi bu ekibe daraltılır.</p>
          </div>

          <div>
            <label className="label" htmlFor="c-priority">
              Varsayılan Öncelik
            </label>
            <select
              id="c-priority"
              className="input"
              value={cat.defaultPriority}
              onChange={(e) => updateCategory.mutate({ defaultPriority: e.target.value })}
            >
              {(priorities.data ?? []).map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="c-sla">
              Hedef Süre (saat)
            </label>
            <input
              id="c-sla"
              type="number"
              min={1}
              max={8760}
              className="input"
              defaultValue={cat.defaultSlaHours ?? ''}
              onBlur={(e) =>
                updateCategory.mutate({
                  defaultSlaHours: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
            <p className="hint">
              Bilgilendirme amaçlıdır; süreyi asıl belirleyen adım SLA ayarlarıdır.
            </p>
          </div>

          <div className="sm:col-span-3">
            <label className="flex items-center gap-2 text-[13px] text-ink-800">
              <input
                type="checkbox"
                className="size-4 rounded border-ink-300"
                checked={cat.requiresManagerApproval}
                onChange={(e) =>
                  updateCategory.mutate({ requiresManagerApproval: e.target.checked })
                }
              />
              Birinci yönetici onayı gerekli
            </label>
            <p className="hint">
              Bu ayar iş akışındaki koşullu “Yönetici Onayı” adımını tetikler. Mevcut açık kayıtlar
              etkilenmez.
            </p>
          </div>

          <div className="sm:col-span-3">
            <label className="label" htmlFor="c-desc">
              Açıklama
            </label>
            <textarea
              id="c-desc"
              className="input"
              rows={2}
              defaultValue={cat.description ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (cat.description ?? ''))
                  updateCategory.mutate({ description: e.target.value || null });
              }}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Form Alanları</h2>
          <button
            type="button"
            className="btn-primary btn-xs"
            onClick={() => {
              setFieldForm(emptyField());
              setModalError(null);
              setFieldModal({ fieldId: null });
            }}
          >
            + Alan Ekle
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Etiket</th>
                <th>Kod</th>
                <th>Tip</th>
                <th>Zorunlu</th>
                <th>Seçenek</th>
                <th>Görünürlük Koşulu</th>
                <th>Durum</th>
                <th>İşlemler</th>
              </tr>
            </thead>
            <tbody>
              {cat.formFields.map((field) => (
                <tr key={field.id} className={field.isActive ? undefined : 'opacity-60'}>
                  <td className="font-medium text-ink-900">{field.label}</td>
                  <td className="font-mono text-[12px] text-ink-600">{field.key}</td>
                  <td className="text-ink-700">
                    {FIELD_TYPE_LABELS[field.fieldType] ?? field.fieldType}
                  </td>
                  <td>
                    {field.isRequired ? (
                      <span className="chip border-brand-200 bg-brand-50 text-brand-700">
                        Zorunlu
                      </span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                  <td className="max-w-56 truncate text-[12px] text-ink-600">
                    {(field.options ?? []).map((o) => o.label).join(', ') || '—'}
                  </td>
                  <td className="text-[12px] text-ink-600">
                    {field.visibilityConditionJson ? 'Koşullu' : '—'}
                  </td>
                  <td>
                    <span
                      className={`chip ${
                        field.isActive
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-ink-300 bg-ink-100 text-ink-600'
                      }`}
                    >
                      {field.isActive ? 'Aktif' : 'Pasif'}
                    </span>
                  </td>
                  <td>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="btn-default btn-xs"
                        onClick={() => {
                          setModalError(null);
                          setFieldModal({ fieldId: field.id });
                        }}
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        className="btn-default btn-xs text-red-600"
                        onClick={() => removeField.mutate(field.id)}
                      >
                        Sil
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {cat.formFields.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-ink-500">
                    Bu kategori için ek form alanı tanımlanmadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {fieldModal && (
        <Modal
          title={fieldModal.fieldId ? 'Form Alanını Düzenle' : 'Yeni Form Alanı'}
          onClose={() => setFieldModal(null)}
          width="max-w-2xl"
          footer={
            <>
              <button type="button" className="btn-default" onClick={() => setFieldModal(null)}>
                Vazgeç
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={
                  fieldForm.label.trim().length < 2 ||
                  (!fieldModal.fieldId && fieldForm.key.trim().length < 2) ||
                  saveField.isPending
                }
                onClick={() =>
                  saveField.mutate({ fieldId: fieldModal.fieldId, form: fieldForm })
                }
              >
                Kaydet
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="f-label">
                  Alan Etiketi <span className="text-red-600">*</span>
                </label>
                <input
                  id="f-label"
                  className="input"
                  value={fieldForm.label}
                  onChange={(e) => {
                    const label = e.target.value;
                    setFieldForm((f) => ({
                      ...f,
                      label,
                      key:
                        !fieldModal.fieldId && !f.key
                          ? label
                              .trim()
                              .toLowerCase()
                              .replace(/[ğ]/g, 'g')
                              .replace(/[ü]/g, 'u')
                              .replace(/[ş]/g, 's')
                              .replace(/[ı]/g, 'i')
                              .replace(/[ö]/g, 'o')
                              .replace(/[ç]/g, 'c')
                              .replace(/[^a-z0-9]+/g, '')
                              .slice(0, 40)
                          : f.key,
                    }));
                  }}
                />
              </div>
              <div>
                <label className="label" htmlFor="f-key">
                  Alan Kodu <span className="text-red-600">*</span>
                </label>
                <input
                  id="f-key"
                  className="input font-mono"
                  value={fieldForm.key}
                  disabled={Boolean(fieldModal.fieldId)}
                  onChange={(e) => setFieldForm((f) => ({ ...f, key: e.target.value }))}
                />
                {fieldModal.fieldId && (
                  <p className="hint">
                    Mevcut taleplerin verisi bu koda bağlı olduğu için değiştirilemez.
                  </p>
                )}
              </div>
              <div>
                <label className="label" htmlFor="f-type">
                  Alan Tipi
                </label>
                <select
                  id="f-type"
                  className="input"
                  value={fieldForm.fieldType}
                  onChange={(e) => setFieldForm((f) => ({ ...f, fieldType: e.target.value }))}
                >
                  {(meta.data?.fieldTypes ?? Object.keys(FIELD_TYPE_LABELS)).map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col justify-end gap-1.5">
                <label className="flex items-center gap-2 text-[13px] text-ink-800">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-ink-300"
                    checked={fieldForm.isRequired}
                    onChange={(e) =>
                      setFieldForm((f) => ({ ...f, isRequired: e.target.checked }))
                    }
                  />
                  Zorunlu alan
                </label>
              </div>
            </div>

            {needsOptions && (
              <div>
                <label className="label" htmlFor="f-options">
                  Seçenekler <span className="text-red-600">*</span>
                </label>
                <textarea
                  id="f-options"
                  className="input font-mono"
                  rows={4}
                  placeholder={'KOD|Görünen Metin\nPDF|PDF (e-posta)\nBASILI|Basılı kopya'}
                  value={fieldForm.optionsText}
                  onChange={(e) => setFieldForm((f) => ({ ...f, optionsText: e.target.value }))}
                />
                <p className="hint">Her satıra bir seçenek. Biçim: KOD|Görünen Metin</p>
              </div>
            )}

            <Disclosure title="İleri ayarlar">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="f-help">
                    Yardım Metni
                  </label>
                  <input
                    id="f-help"
                    className="input"
                    value={fieldForm.helpText}
                    onChange={(e) => setFieldForm((f) => ({ ...f, helpText: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="f-placeholder">
                    Yer Tutucu
                  </label>
                  <input
                    id="f-placeholder"
                    className="input"
                    value={fieldForm.placeholder}
                    onChange={(e) =>
                      setFieldForm((f) => ({ ...f, placeholder: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <label className="label" htmlFor="f-default">
                    Varsayılan Değer
                  </label>
                  <input
                    id="f-default"
                    className="input"
                    value={fieldForm.defaultValue}
                    onChange={(e) =>
                      setFieldForm((f) => ({ ...f, defaultValue: e.target.value }))
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="label" htmlFor="f-min">
                      En az (sayı)
                    </label>
                    <input
                      id="f-min"
                      type="number"
                      className="input"
                      value={fieldForm.min}
                      onChange={(e) => setFieldForm((f) => ({ ...f, min: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="f-max">
                      En fazla (sayı)
                    </label>
                    <input
                      id="f-max"
                      type="number"
                      className="input"
                      value={fieldForm.max}
                      onChange={(e) => setFieldForm((f) => ({ ...f, max: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="label" htmlFor="f-maxlen">
                    En fazla karakter
                  </label>
                  <input
                    id="f-maxlen"
                    type="number"
                    className="input"
                    value={fieldForm.maxLength}
                    onChange={(e) => setFieldForm((f) => ({ ...f, maxLength: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="f-pattern">
                    Biçim deseni (regex)
                  </label>
                  <input
                    id="f-pattern"
                    className="input font-mono"
                    placeholder="^\\d{4}-\\d{2}$"
                    value={fieldForm.pattern}
                    onChange={(e) => setFieldForm((f) => ({ ...f, pattern: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="flex items-center gap-2 text-[13px] text-ink-800">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-ink-300"
                      checked={fieldForm.isReadOnly}
                      onChange={(e) =>
                        setFieldForm((f) => ({ ...f, isReadOnly: e.target.checked }))
                      }
                    />
                    Salt okunur (kullanıcı değiştiremez)
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-ink-800">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-ink-300"
                      checked={fieldForm.isHidden}
                      onChange={(e) =>
                        setFieldForm((f) => ({ ...f, isHidden: e.target.checked }))
                      }
                    />
                    Gizli (formda gösterilmez)
                  </label>
                </div>
              </div>
            </Disclosure>

            {modalError && (
              <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-700">
                {modalError}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
