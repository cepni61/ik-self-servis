import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type {
  CategoryListItem,
  FormFieldConfig,
  PriorityInfo,
  StatusInfo,
} from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { DynamicForm, type FormValues } from '../components/DynamicForm';
import { ErrorNotice, KeyValue, Spinner, useToast } from '../components/ui';
import type { EvalContext } from '../lib/conditions';

export function NewRequestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();

  const [categoryId, setCategoryId] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [formValues, setFormValues] = useState<FormValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () =>
      api.get<{
        categories: CategoryListItem[];
        statuses: StatusInfo[];
        priorities: PriorityInfo[];
      }>('/catalog/bootstrap'),
    staleTime: 5 * 60_000,
  });

  const category = useMemo(
    () => bootstrap.data?.categories.find((c) => c.id === categoryId) ?? null,
    [bootstrap.data, categoryId],
  );

  const formFields = useQuery({
    queryKey: ['form-fields', categoryId],
    queryFn: () =>
      api.get<{ fields: FormFieldConfig[] }>(`/catalog/categories/${categoryId}/form-fields`),
    enabled: Boolean(categoryId),
  });

  const conditionContext: EvalContext = useMemo(
    () => ({
      category: {
        code: category?.code ?? '',
        name: category?.name ?? '',
        requiresManagerApproval: category?.requiresManagerApproval ?? false,
      },
      request: {
        priority: priority || (category?.defaultPriority ?? 'MEDIUM'),
        departmentCode: user?.departmentCode ?? null,
        subject,
      },
      requester: {
        id: user?.id ?? '',
        department: user?.department ?? null,
        departmentCode: user?.departmentCode ?? null,
        title: user?.title ?? null,
        hasManager: Boolean(user?.manager),
      },
      form: formValues,
    }),
    [category, priority, subject, user, formValues],
  );

  const save = useMutation({
    mutationFn: (submit: boolean) =>
      api.post<{ id: string; requestNo: string; statusCode: string }>('/requests', {
        categoryId,
        subject,
        description: description || null,
        priority: priority || null,
        dueDate: dueDate || null,
        formData: formValues,
        submit,
      }),
    onSuccess: (result, submit) => {
      toast.push(
        'success',
        submit
          ? `${result.requestNo} numaralı talebiniz gönderildi.`
          : `${result.requestNo} taslak olarak kaydedildi.`,
      );
      navigate(`/talep/${result.id}`);
    },
    onError: (err) => {
      setFieldErrors({});
      setGeneralError(null);
      if (err instanceof ApiError) {
        const issues = err.fieldIssues;
        if (issues.length > 0) {
          setFieldErrors(Object.fromEntries(issues.map((i) => [i.field, i.message])));
          setGeneralError(err.message);
        } else {
          setGeneralError(err.message);
        }
      } else {
        setGeneralError('Talep kaydedilemedi.');
      }
    },
  });

  const changeCategory = (id: string) => {
    setCategoryId(id);
    setFormValues({});
    setFieldErrors({});
    const selected = bootstrap.data?.categories.find((c) => c.id === id);
    setPriority(selected?.defaultPriority ?? '');
  };

  const canSubmit = Boolean(categoryId) && subject.trim().length >= 3 && !save.isPending;

  if (bootstrap.isLoading) return <Spinner />;
  if (bootstrap.isError || !bootstrap.data) {
    return (
      <ErrorNotice message="Kategoriler yüklenemedi." onRetry={() => void bootstrap.refetch()} />
    );
  }
  const { categories: categoryOptions, priorities: priorityOptions } = bootstrap.data;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-base font-semibold text-ink-900">Yeni Talep</h1>
        <p className="text-[12px] text-ink-500">
          Kategori seçtiğinizde o kategoriye özel alanlar görünür.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {/* Calisan bilgileri: kurumsal dizinden gelir, elle degistirilemez */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Çalışan Bilgileri</h2>
              <span className="text-[11px] text-ink-500">Kurumsal dizinden alınır</span>
            </div>
            <div className="grid gap-4 px-4 py-3 sm:grid-cols-4">
              <KeyValue label="Ad Soyad">{user?.displayName}</KeyValue>
              <KeyValue label="Departman">{user?.department ?? '—'}</KeyValue>
              <KeyValue label="Ünvan">{user?.title ?? '—'}</KeyValue>
              <KeyValue label="Birinci Yönetici">{user?.manager?.displayName ?? '—'}</KeyValue>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Talep Bilgileri</h2>
            </div>
            <div className="space-y-4 px-4 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="category">
                    Talep Kategorisi <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="category"
                    className="input"
                    value={categoryId}
                    onChange={(e) => changeCategory(e.target.value)}
                  >
                    <option value="">Seçiniz…</option>
                    {categoryOptions.map((c) => (
                      <option key={c.id} value={c.id} disabled={!c.hasActiveWorkflow}>
                        {c.name}
                        {!c.hasActiveWorkflow ? ' (iş akışı yayınlanmamış)' : ''}
                      </option>
                    ))}
                  </select>
                  {category?.description && <p className="hint">{category.description}</p>}
                </div>

                <div>
                  <label className="label" htmlFor="priority">
                    Öncelik
                  </label>
                  <select
                    id="priority"
                    className="input"
                    value={priority}
                    onChange={(e) => setPriority(e.target.value)}
                  >
                    {priorityOptions.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label" htmlFor="subject">
                  Konu <span className="text-red-600">*</span>
                </label>
                <input
                  id="subject"
                  className="input"
                  maxLength={200}
                  placeholder="Talebinizi kısaca özetleyin"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>

              <div>
                <label className="label" htmlFor="description">
                  Açıklama
                </label>
                <textarea
                  id="description"
                  className="input"
                  rows={3}
                  maxLength={4000}
                  placeholder="Varsa ek açıklama"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>

              <div className="sm:w-64">
                <label className="label" htmlFor="dueDate">
                  Beklenen Termin Tarihi
                </label>
                <input
                  id="dueDate"
                  type="date"
                  className="input"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
          </section>

          {categoryId && (
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">{category?.name} — Ek Bilgiler</h2>
              </div>
              <div className="px-4 py-4">
                {formFields.isLoading && <Spinner label="Alanlar yükleniyor…" />}
                {formFields.data && formFields.data.fields.length === 0 && (
                  <p className="text-[12px] text-ink-500">
                    Bu kategori için ek alan tanımlanmamış.
                  </p>
                )}
                {formFields.data && formFields.data.fields.length > 0 && (
                  <DynamicForm
                    fields={formFields.data.fields}
                    values={formValues}
                    onChange={(key, value) =>
                      setFormValues((prev) => ({ ...prev, [key]: value }))
                    }
                    context={conditionContext}
                    errors={fieldErrors}
                  />
                )}
              </div>
            </section>
          )}

          {generalError && <ErrorNotice message={generalError} />}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={!canSubmit}
              onClick={() => save.mutate(true)}
            >
              {save.isPending ? 'İşleniyor…' : 'Gönder'}
            </button>
            <button
              type="button"
              className="btn-default"
              disabled={!canSubmit}
              onClick={() => save.mutate(false)}
            >
              Taslak Kaydet
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => navigate('/taleplerim')}
              disabled={save.isPending}
            >
              Vazgeç
            </button>
          </div>
        </div>

        {/* Yol haritasi: kullanici gondermeden once ne olacagini bilir */}
        <aside className="space-y-3">
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Bundan Sonra Ne Olacak?</h2>
            </div>
            <div className="px-4 py-3">
              {!category ? (
                <p className="text-[12px] text-ink-500">
                  Kategori seçtiğinizde onay akışı burada gösterilecek.
                </p>
              ) : (
                <ol className="space-y-2 text-[13px]">
                  <FlowStep index={1} title="Talep Oluşturma" who="Siz" />
                  {category.requiresManagerApproval && (
                    <FlowStep
                      index={2}
                      title="Yönetici Onayı"
                      who={user?.manager?.displayName ?? 'Birinci yöneticiniz'}
                    />
                  )}
                  <FlowStep
                    index={category.requiresManagerApproval ? 3 : 2}
                    title="İnsan Kaynakları Kontrolü"
                    who="İnsan Kaynakları"
                  />
                  <FlowStep
                    index={category.requiresManagerApproval ? 4 : 3}
                    title="Tamamlandı"
                    who="—"
                  />
                </ol>
              )}
            </div>
          </section>

          {category && (
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Kategori Bilgisi</h2>
              </div>
              <div className="space-y-3 px-4 py-3">
                <KeyValue label="Yönetici Onayı">
                  {category.requiresManagerApproval ? 'Gerekli' : 'Gerekli değil'}
                </KeyValue>
                <KeyValue label="Hedef Süre">
                  {category.defaultSlaHours
                    ? `${Math.round(category.defaultSlaHours / 24)} gün (${category.defaultSlaHours} saat)`
                    : 'Tanımlı değil'}
                </KeyValue>
                <KeyValue label="İş Akışı">{category.workflowName ?? '—'}</KeyValue>
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function FlowStep({ index, title, who }: { index: number; title: string; who: string }) {
  return (
    <li className="flex gap-2">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border border-ink-300 bg-white text-[10px] font-semibold text-ink-500">
        {index}
      </span>
      <span>
        <span className="text-ink-800">{title}</span>
        <span className="block text-[11px] text-ink-500">{who}</span>
      </span>
    </li>
  );
}
