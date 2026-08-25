import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { PriorityInfo, RequestDetail } from '../api/types';
import { DynamicForm, type FormValues } from '../components/DynamicForm';
import { ErrorNotice, Spinner, useToast } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

/** Yalnizca taslak durumundaki kendi talebi duzenlenebilir. */
export function EditDraftPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [formValues, setFormValues] = useState<FormValues>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['request', id],
    queryFn: () => api.get<RequestDetail>(`/requests/${id}`),
  });

  const priorities = useQuery({
    queryKey: ['priorities'],
    queryFn: () => api.get<PriorityInfo[]>('/catalog/priorities'),
    staleTime: 5 * 60_000,
  });

  const detail = detailQuery.data;

  useEffect(() => {
    if (!detail || loaded) return;
    setSubject(detail.subject);
    setDescription(detail.description ?? '');
    setPriority(detail.priority.code);
    setDueDate(detail.dueDate ? detail.dueDate.slice(0, 10) : '');
    setFormValues(detail.formData ?? {});
    setLoaded(true);
  }, [detail, loaded]);

  const conditionContext = useMemo(
    () => ({
      category: {
        code: detail?.category.code ?? '',
        name: detail?.category.name ?? '',
        requiresManagerApproval: detail?.category.requiresManagerApproval ?? false,
      },
      request: {
        priority: priority || 'MEDIUM',
        departmentCode: user?.departmentCode ?? null,
        subject,
      },
      requester: {
        id: detail?.requester.id ?? '',
        department: detail?.requester.department ?? null,
        departmentCode: user?.departmentCode ?? null,
        title: detail?.requester.title ?? null,
        hasManager: Boolean(detail?.manager),
      },
      form: formValues,
    }),
    [detail, priority, subject, formValues, user],
  );

  const handleError = (err: unknown, fallback: string) => {
    setFieldErrors({});
    if (err instanceof ApiError) {
      const issues = err.fieldIssues;
      if (issues.length > 0) {
        setFieldErrors(Object.fromEntries(issues.map((i) => [i.field, i.message])));
      }
      setGeneralError(err.message);
      if (err.isStale) {
        void queryClient.invalidateQueries({ queryKey: ['request', id] });
        setLoaded(false);
      }
      return;
    }
    setGeneralError(fallback);
  };

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/requests/${id}`, {
        subject,
        description: description || null,
        priority,
        dueDate: dueDate || null,
        formData: formValues,
        expectedRowVersion: detail!.rowVersion,
      }),
    onSuccess: () => {
      toast.push('success', 'Taslak kaydedildi.');
      void queryClient.invalidateQueries({ queryKey: ['request', id] });
      navigate(`/talep/${id}`);
    },
    onError: (err) => handleError(err, 'Taslak kaydedilemedi.'),
  });

  const saveAndSubmit = useMutation({
    mutationFn: async () => {
      await api.patch(`/requests/${id}`, {
        subject,
        description: description || null,
        priority,
        dueDate: dueDate || null,
        formData: formValues,
        expectedRowVersion: detail!.rowVersion,
      });
      // Kaydetme rowVersion'i artirir; guncel degeri yeniden okuyup gonderiyoruz.
      const fresh = await api.get<RequestDetail>(`/requests/${id}`);
      return api.post(`/requests/${id}/submit`, { expectedRowVersion: fresh.rowVersion });
    },
    onSuccess: () => {
      toast.push('success', 'Talebiniz gönderildi.');
      void queryClient.invalidateQueries({ queryKey: ['request', id] });
      void queryClient.invalidateQueries({ queryKey: ['my-requests'] });
      navigate(`/talep/${id}`);
    },
    onError: (err) => handleError(err, 'Talep gönderilemedi.'),
  });

  if (detailQuery.isLoading || priorities.isLoading) return <Spinner />;
  if (detailQuery.isError || !detail) {
    return (
      <ErrorNotice
        message={
          detailQuery.error instanceof ApiError ? detailQuery.error.message : 'Talep yüklenemedi.'
        }
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  if (!detail.permissions.canEdit) {
    return (
      <ErrorNotice
        message="Bu talep düzenlenemez. Yalnızca taslak durumundaki kendi talebinizi düzenleyebilirsiniz."
      />
    );
  }

  const busy = save.isPending || saveAndSubmit.isPending;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-base font-semibold text-ink-900">
          Taslağı Düzenle
          <span className="ml-2 font-normal text-ink-600">{detail.requestNo}</span>
        </h1>
        <p className="text-[12px] text-ink-500">{detail.category.name}</p>
      </div>

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Talep Bilgileri</h2>
        </div>
        <div className="space-y-4 px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="subject">
                Konu <span className="text-red-600">*</span>
              </label>
              <input
                id="subject"
                className="input"
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
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
                {(priorities.data ?? []).map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
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

      {detail.formFields.length > 0 && (
        <section className="card">
          <div className="card-header">
            <h2 className="card-title">{detail.category.name} — Ek Bilgiler</h2>
          </div>
          <div className="px-4 py-4">
            <DynamicForm
              fields={detail.formFields}
              values={formValues}
              onChange={(key, value) => setFormValues((prev) => ({ ...prev, [key]: value }))}
              context={conditionContext}
              errors={fieldErrors}
            />
          </div>
        </section>
      )}

      {generalError && <ErrorNotice message={generalError} />}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={busy || subject.trim().length < 3}
          onClick={() => saveAndSubmit.mutate()}
        >
          {saveAndSubmit.isPending ? 'Gönderiliyor…' : 'Kaydet ve Gönder'}
        </button>
        <button
          type="button"
          className="btn-default"
          disabled={busy || subject.trim().length < 3}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Kaydediliyor…' : 'Taslağı Kaydet'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          onClick={() => navigate(`/talep/${id}`)}
        >
          Vazgeç
        </button>
      </div>
    </div>
  );
}
