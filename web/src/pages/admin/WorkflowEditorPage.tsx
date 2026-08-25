import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type {
  AdminMeta,
  CategoryListItem,
  PriorityInfo,
  StatusInfo,
  ValidationResult,
  WorkflowActionConfig,
  WorkflowStepConfig,
  WorkflowVersionDetail,
} from '../../api/types';
import {
  Disclosure,
  ErrorNotice,
  Modal,
  Spinner,
  formatDateTime,
  useToast,
} from '../../components/ui';
import { StepEditor, type StepFormState, STEP_TYPE_LABELS, ASSIGNEE_TYPE_LABELS } from './StepEditor';
import { ActionEditor, type ActionFormState } from './ActionEditor';
import { NotificationRulesEditor } from './NotificationRulesEditor';

export function WorkflowEditorPage() {
  const { versionId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [stepModal, setStepModal] = useState<{ step: WorkflowStepConfig | null } | null>(null);
  const [actionModal, setActionModal] = useState<{
    step: WorkflowStepConfig;
    action: WorkflowActionConfig | null;
  } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [changeDescription, setChangeDescription] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<WorkflowStepConfig | null>(null);

  const versionQuery = useQuery({
    queryKey: ['admin-version', versionId],
    queryFn: () => api.get<WorkflowVersionDetail>(`/admin/workflow-versions/${versionId}`),
  });

  const meta = useQuery({
    queryKey: ['admin-meta'],
    queryFn: () => api.get<AdminMeta>('/admin/meta'),
    staleTime: 10 * 60_000,
  });

  const refData = useQuery({
    queryKey: ['admin-refdata'],
    queryFn: async () => {
      const [statuses, roles, groups, bootstrap] = await Promise.all([
        api.get<StatusInfo[]>('/catalog/statuses'),
        api.get<Array<{ code: string; name: string }>>('/catalog/roles'),
        api.get<Array<{ id: string; code: string; name: string }>>('/catalog/groups'),
        api.get<{ categories: CategoryListItem[]; priorities: PriorityInfo[] }>(
          '/catalog/bootstrap',
        ),
      ]);
      return {
        statuses,
        roles,
        groups,
        categories: bootstrap.categories,
        priorities: bootstrap.priorities,
      };
    },
    staleTime: 10 * 60_000,
  });

  const validation = useQuery({
    queryKey: ['admin-version-validate', versionId],
    queryFn: () => api.get<ValidationResult>(`/admin/workflow-versions/${versionId}/validate`),
  });

  const version = versionQuery.data;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-version', versionId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-version-validate', versionId] });
    void queryClient.invalidateQueries({ queryKey: ['admin-workflows'] });
  };

  const handleMutationError = (err: unknown, fallback: string): string => {
    if (err instanceof ApiError) {
      if (err.isStale) invalidate();
      return err.message;
    }
    return fallback;
  };

  // --- Kategoriye bagli form alanlari (kosul editoru icin) ---
  const firstCategoryId = version?.definition.categories[0]?.id;
  const categoryFields = useQuery({
    queryKey: ['category-fields-for-condition', firstCategoryId],
    queryFn: () =>
      api.get<{ fields: Array<{ key: string; label: string }> }>(
        `/catalog/categories/${firstCategoryId}/form-fields`,
      ),
    enabled: Boolean(firstCategoryId),
  });

  const formFieldKeys = useMemo(
    () => (categoryFields.data?.fields ?? []).map((f) => ({ key: f.key, label: f.label })),
    [categoryFields.data],
  );

  // --- Mutasyonlar ---

  const toStepPayload = (state: StepFormState) => ({
    code: state.code,
    name: state.name,
    description: state.description || null,
    type: state.type,
    assigneeType: state.assigneeType,
    assigneeRoleCode: state.assigneeType === 'ROLE' ? state.assigneeRoleCode : null,
    assigneeGroupId: state.assigneeType === 'GROUP' ? state.assigneeGroupId : null,
    assigneeUserId: state.assigneeType === 'USER' ? state.assigneeUserId : null,
    statusCode: state.statusCode,
    slaEnabled: state.slaEnabled,
    slaHours: state.slaEnabled && state.slaHours ? Number(state.slaHours) : null,
    slaReminderHours: state.slaReminderHours ? Number(state.slaReminderHours) : null,
    slaEscalationHours: state.slaEscalationHours ? Number(state.slaEscalationHours) : null,
    condition: state.condition,
    isActive: state.isActive,
    expectedRowVersion: version!.rowVersion,
  });

  const saveStep = useMutation({
    mutationFn: (input: { state: StepFormState; stepId: string | null }) =>
      input.stepId
        ? api.patch(`/admin/workflow-steps/${input.stepId}`, toStepPayload(input.state))
        : api.post(`/admin/workflow-versions/${versionId}/steps`, toStepPayload(input.state)),
    onSuccess: () => {
      toast.push('success', 'Adım kaydedildi.');
      setStepModal(null);
      setModalError(null);
      invalidate();
    },
    onError: (err) => setModalError(handleMutationError(err, 'Adım kaydedilemedi.')),
  });

  const deleteStep = useMutation({
    mutationFn: (stepId: string) =>
      api.del(`/admin/workflow-steps/${stepId}`, { expectedRowVersion: version!.rowVersion }),
    onSuccess: () => {
      toast.push('success', 'Adım silindi.');
      setConfirmDelete(null);
      invalidate();
    },
    onError: (err) => {
      toast.push('error', handleMutationError(err, 'Adım silinemedi.'));
      setConfirmDelete(null);
    },
  });

  const moveStep = useMutation({
    mutationFn: (input: { stepId: string; direction: 'up' | 'down' }) =>
      api.post(`/admin/workflow-steps/${input.stepId}/move`, {
        direction: input.direction,
        expectedRowVersion: version!.rowVersion,
      }),
    onSuccess: () => invalidate(),
    onError: (err) => toast.push('error', handleMutationError(err, 'Sıra değiştirilemedi.')),
  });

  const saveAction = useMutation({
    mutationFn: (input: {
      state: ActionFormState;
      stepId: string;
      actionId: string | null;
    }) => {
      const payload = {
        code: input.state.code,
        name: input.state.name,
        kind: input.state.kind,
        targetStepMode: input.state.targetStepMode,
        targetStepId: input.state.targetStepMode === 'SPECIFIC' ? input.state.targetStepId : null,
        targetStatusCode: input.state.targetStatusCode || null,
        commentRequired: input.state.commentRequired,
        confirmationRequired: input.state.confirmationRequired,
        notify: input.state.notify,
        variant: input.state.variant,
        isActive: input.state.isActive,
        expectedRowVersion: version!.rowVersion,
      };
      return input.actionId
        ? api.patch(`/admin/workflow-actions/${input.actionId}`, payload)
        : api.post(`/admin/workflow-steps/${input.stepId}/actions`, payload);
    },
    onSuccess: () => {
      toast.push('success', 'Aksiyon kaydedildi.');
      setActionModal(null);
      setModalError(null);
      invalidate();
    },
    onError: (err) => setModalError(handleMutationError(err, 'Aksiyon kaydedilemedi.')),
  });

  const deleteAction = useMutation({
    mutationFn: (actionId: string) =>
      api.del(`/admin/workflow-actions/${actionId}`, {
        expectedRowVersion: version!.rowVersion,
      }),
    onSuccess: () => {
      toast.push('success', 'Aksiyon silindi.');
      invalidate();
    },
    onError: (err) => toast.push('error', handleMutationError(err, 'Aksiyon silinemedi.')),
  });

  const updateHeader = useMutation({
    mutationFn: (input: { changeDescription?: string; slaCalendarMode?: string }) =>
      api.patch(`/admin/workflow-versions/${versionId}`, {
        ...input,
        expectedRowVersion: version!.rowVersion,
      }),
    onSuccess: () => {
      toast.push('success', 'Sürüm bilgisi güncellendi.');
      invalidate();
    },
    onError: (err) => toast.push('error', handleMutationError(err, 'Güncellenemedi.')),
  });

  const publish = useMutation({
    mutationFn: () =>
      api.post<{
        versionNumber: number;
        previousVersionNumber: number | null;
        runningInstancesOnPreviousVersion: number;
      }>(`/admin/workflow-versions/${versionId}/publish`, {
        expectedRowVersion: version!.rowVersion,
        changeDescription: changeDescription || null,
      }),
    onSuccess: (result) => {
      toast.push(
        'success',
        `v${result.versionNumber} yayınlandı.` +
          (result.runningInstancesOnPreviousVersion > 0
            ? ` Önceki sürümdeki ${result.runningInstancesOnPreviousVersion} açık kayıt kendi sürümünde devam ediyor.`
            : ''),
      );
      setPublishOpen(false);
      invalidate();
      navigate(`/yonetim/is-akislari/${version!.definition.id}/surumler`);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        const issues = (err.details as { issues?: Array<{ message: string }> } | undefined)?.issues;
        toast.push(
          'error',
          issues?.length
            ? `${err.message} ${issues.map((i) => i.message).join(' | ')}`
            : err.message,
        );
        invalidate();
      } else {
        toast.push('error', 'Yayınlanamadı.');
      }
    },
  });

  if (versionQuery.isLoading || meta.isLoading || refData.isLoading) return <Spinner />;
  if (versionQuery.isError || !version || !meta.data || !refData.data) {
    return (
      <ErrorNotice
        message="İş akışı sürümü yüklenemedi."
        onRetry={() => void versionQuery.refetch()}
      />
    );
  }

  const editable = version.isEditable;
  const errors = validation.data?.issues.filter((i) => i.severity === 'ERROR') ?? [];
  const warnings = validation.data?.issues.filter((i) => i.severity === 'WARNING') ?? [];

  return (
    <div className="space-y-3">
      {/* Baslik */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link
              to={`/yonetim/is-akislari/${version.definition.id}/surumler`}
              className="btn-ghost btn-xs"
            >
              ← Sürümler
            </Link>
            <h1 className="text-base font-semibold text-ink-900">
              {version.definition.name}
              <span className="ml-2 font-normal text-ink-600">v{version.versionNumber}</span>
            </h1>
            <span
              className={`chip ${
                version.status === 'ACTIVE'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : version.status === 'DRAFT'
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-ink-300 bg-ink-100 text-ink-600'
              }`}
            >
              {version.status === 'ACTIVE'
                ? 'Aktif'
                : version.status === 'DRAFT'
                  ? 'Taslak'
                  : version.status === 'SUPERSEDED'
                    ? 'Yerine yenisi geçti'
                    : version.status}
            </span>
          </div>
          <p className="mt-0.5 ml-1 font-mono text-[12px] text-ink-500">
            {version.definition.code}
          </p>
        </div>

        {editable && (
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-default"
              onClick={() => void validation.refetch()}
            >
              Doğrula
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={errors.length > 0}
              onClick={() => {
                setChangeDescription(version.changeDescription ?? '');
                setPublishOpen(true);
              }}
            >
              Yayınla
            </button>
          </div>
        )}
      </div>

      {!editable && (
        <div className="rounded border border-ink-300 bg-ink-50 px-3 py-2 text-[12px] text-ink-700">
          Bu sürüm yayınlanmış olduğu için salt okunurdur. Değişiklik yapmak için{' '}
          <Link
            to={`/yonetim/is-akislari/${version.definition.id}/surumler`}
            className="text-brand-600 underline"
          >
            Revizyon Oluştur
          </Link>{' '}
          ile yeni bir taslak sürüm açın. Bu sürümde çalışan {version.runningInstanceCount} açık
          kayıt etkilenmez.
        </div>
      )}

      {/* Ust bolum */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Sürüm Bilgileri</h2>
        </div>
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-4">
          <div>
            <div className="kv-label">İlgili Kategoriler</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {version.definition.categories.length === 0 ? (
                <span className="text-[13px] text-ink-400">—</span>
              ) : (
                version.definition.categories.map((c) => (
                  <span key={c.id} className="chip border-ink-200 bg-ink-50 text-ink-600">
                    {c.name}
                  </span>
                ))
              )}
            </div>
          </div>
          <div>
            <div className="kv-label">Oluşturma</div>
            <div className="kv-value">{formatDateTime(version.createdAt)}</div>
          </div>
          <div>
            <div className="kv-label">Yayınlanma</div>
            <div className="kv-value">{formatDateTime(version.publishedAt)}</div>
          </div>
          <div>
            <div className="kv-label">Bu sürümdeki kayıtlar</div>
            <div className="kv-value">
              {version.runningInstanceCount} açık / {version.totalInstanceCount} toplam
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-t border-ink-100 px-4 py-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="change-desc">
              Değişiklik Açıklaması
            </label>
            <input
              id="change-desc"
              className="input"
              disabled={!editable}
              defaultValue={version.changeDescription ?? ''}
              onBlur={(e) => {
                if (editable && e.target.value !== (version.changeDescription ?? '')) {
                  updateHeader.mutate({ changeDescription: e.target.value });
                }
              }}
            />
          </div>
          <div>
            <label className="label" htmlFor="sla-mode">
              SLA Takvim Modu
            </label>
            <select
              id="sla-mode"
              className="input"
              disabled={!editable}
              value={version.slaCalendarMode}
              onChange={(e) => updateHeader.mutate({ slaCalendarMode: e.target.value })}
            >
              <option value="CALENDAR_DAYS">Takvim günü (7/24)</option>
              <option value="BUSINESS_DAYS">İş günü (mesai saatleri, tatiller hariç)</option>
            </select>
            <p className="hint">
              İş günü modu için resmî tatil listesinin doldurulması gerekir (iş kararı).
            </p>
          </div>
        </div>
      </section>

      {/* Dogrulama */}
      {(errors.length > 0 || warnings.length > 0) && (
        <section
          className={`card border ${errors.length > 0 ? 'border-red-300' : 'border-amber-300'}`}
        >
          <div className="card-header">
            <h2 className="card-title">
              Doğrulama — {errors.length} hata, {warnings.length} uyarı
            </h2>
            {errors.length > 0 && (
              <span className="text-[11px] text-red-700">
                Hatalar giderilmeden yayınlanamaz.
              </span>
            )}
          </div>
          <ul className="divide-y divide-ink-100">
            {[...errors, ...warnings].map((issue, index) => (
              <li key={`${issue.code}-${index}`} className="flex gap-2 px-4 py-2">
                <span
                  className={`chip shrink-0 ${
                    issue.severity === 'ERROR'
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                >
                  {issue.severity === 'ERROR' ? 'Hata' : 'Uyarı'}
                </span>
                <span className="text-[13px] text-ink-800">{issue.message}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Akis adimlari */}
      <section className="card">
        <div className="card-header">
          <h2 className="card-title">Akış Adımları</h2>
          {editable && (
            <button
              type="button"
              className="btn-primary btn-xs"
              onClick={() => {
                setModalError(null);
                setStepModal({ step: null });
              }}
            >
              + Adım Ekle
            </button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-14">Sıra</th>
                <th>Adım</th>
                <th>Tip</th>
                <th>Sorumlu</th>
                <th>Aksiyonlar</th>
                <th>Koşul</th>
                <th>SLA</th>
                {editable && <th className="w-44">İşlemler</th>}
              </tr>
            </thead>
            <tbody>
              {version.steps.map((step, index) => (
                <tr key={step.id} className={step.isActive ? undefined : 'opacity-60'}>
                  <td className="font-medium text-ink-700">{step.sequence}</td>
                  <td>
                    <div className="font-medium text-ink-900">{step.name}</div>
                    <div className="font-mono text-[11px] text-ink-400">{step.code}</div>
                    {!step.isActive && (
                      <span className="chip mt-0.5 border-ink-300 bg-ink-100 text-ink-600">
                        Pasif
                      </span>
                    )}
                  </td>
                  <td className="text-ink-700">{STEP_TYPE_LABELS[step.type] ?? step.type}</td>
                  <td className="text-ink-700">
                    {ASSIGNEE_TYPE_LABELS[step.assigneeType] ?? step.assigneeType}
                    {step.assigneeRoleCode && (
                      <span className="block text-[11px] text-ink-400">
                        {step.assigneeRoleCode}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      {step.actions.length === 0 && (
                        <span className="text-[12px] text-ink-400">—</span>
                      )}
                      {step.actions.map((action) => (
                        <span
                          key={action.id}
                          className={`chip ${
                            !action.isActive
                              ? 'border-ink-200 bg-ink-50 text-ink-400 line-through'
                              : action.variant === 'DANGER'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : action.variant === 'PRIMARY'
                                  ? 'border-brand-200 bg-brand-50 text-brand-700'
                                  : 'border-ink-200 bg-ink-50 text-ink-600'
                          }`}
                        >
                          {action.name}
                          {editable && (
                            <>
                              <button
                                type="button"
                                className="ml-0.5 text-ink-400 hover:text-brand-600"
                                title="Aksiyonu düzenle"
                                onClick={() => {
                                  setModalError(null);
                                  setActionModal({ step, action });
                                }}
                              >
                                ✎
                              </button>
                              <button
                                type="button"
                                className="text-ink-400 hover:text-red-600"
                                title="Aksiyonu sil"
                                onClick={() => deleteAction.mutate(action.id)}
                              >
                                ×
                              </button>
                            </>
                          )}
                        </span>
                      ))}
                      {editable && (
                        <button
                          type="button"
                          className="btn-ghost btn-xs"
                          onClick={() => {
                            setModalError(null);
                            setActionModal({ step, action: null });
                          }}
                        >
                          + Aksiyon
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="max-w-56 text-[12px] text-ink-600">
                    {step.conditionJson ? (
                      <span className={step.conditionValid ? undefined : 'text-red-600'}>
                        {step.conditionSummary}
                      </span>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-[12px] text-ink-600">
                    {step.slaEnabled && step.slaHours ? (
                      <>
                        {step.slaHours} saat
                        <span className="block text-[11px] text-ink-400">
                          ≈ {(step.slaHours / 24).toFixed(1)} gün
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-400">—</span>
                    )}
                  </td>
                  {editable && (
                    <td>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="btn-default btn-xs"
                          onClick={() => {
                            setModalError(null);
                            setStepModal({ step });
                          }}
                        >
                          Düzenle
                        </button>
                        <button
                          type="button"
                          className="btn-default btn-xs"
                          disabled={index === 0 || moveStep.isPending}
                          onClick={() => moveStep.mutate({ stepId: step.id, direction: 'up' })}
                          aria-label="Yukarı taşı"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn-default btn-xs"
                          disabled={index === version.steps.length - 1 || moveStep.isPending}
                          onClick={() => moveStep.mutate({ stepId: step.id, direction: 'down' })}
                          aria-label="Aşağı taşı"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="btn-default btn-xs text-red-600"
                          onClick={() => setConfirmDelete(step)}
                        >
                          Sil
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {version.steps.length === 0 && (
                <tr>
                  <td colSpan={editable ? 8 : 7} className="py-8 text-center text-ink-500">
                    Henüz adım tanımlanmadı.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Bildirim kurallari - ileri ayar */}
      <Disclosure title="Bildirim Kuralları (ileri ayar)">
        <NotificationRulesEditor
          versionId={versionId}
          rowVersion={version.rowVersion}
          rules={version.notificationRules}
          meta={meta.data}
          roles={refData.data.roles}
          groups={refData.data.groups}
          editable={editable}
          onSaved={invalidate}
        />
      </Disclosure>

      {/* Modallar */}
      {stepModal && (
        <StepEditor
          step={stepModal.step}
          meta={meta.data}
          statuses={refData.data.statuses}
          roles={refData.data.roles}
          groups={refData.data.groups}
          categories={refData.data.categories}
          priorities={refData.data.priorities}
          formFieldKeys={formFieldKeys}
          saving={saveStep.isPending}
          error={modalError}
          onClose={() => {
            setStepModal(null);
            setModalError(null);
          }}
          onSave={(state) =>
            saveStep.mutate({ state, stepId: stepModal.step?.id ?? null })
          }
        />
      )}

      {actionModal && (
        <ActionEditor
          action={actionModal.action}
          step={actionModal.step}
          steps={version.steps}
          meta={meta.data}
          statuses={refData.data.statuses}
          saving={saveAction.isPending}
          error={modalError}
          onClose={() => {
            setActionModal(null);
            setModalError(null);
          }}
          onSave={(state) =>
            saveAction.mutate({
              state,
              stepId: actionModal.step.id,
              actionId: actionModal.action?.id ?? null,
            })
          }
        />
      )}

      {confirmDelete && (
        <Modal
          title="Adımı Sil"
          onClose={() => setConfirmDelete(null)}
          width="max-w-md"
          footer={
            <>
              <button
                type="button"
                className="btn-default"
                onClick={() => setConfirmDelete(null)}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={deleteStep.isPending}
                onClick={() => deleteStep.mutate(confirmDelete.id)}
              >
                Sil
              </button>
            </>
          }
        >
          <p className="text-[13px] text-ink-700">
            <strong>{confirmDelete.name}</strong> adımı bu taslak sürümden silinecek. Yayınlanmış
            sürümler ve açık kayıtlar etkilenmez.
          </p>
        </Modal>
      )}

      {publishOpen && (
        <Modal
          title={`v${version.versionNumber} Sürümünü Yayınla`}
          onClose={() => setPublishOpen(false)}
          width="max-w-xl"
          footer={
            <>
              <button
                type="button"
                className="btn-default"
                onClick={() => setPublishOpen(false)}
                disabled={publish.isPending}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={publish.isPending}
                onClick={() => publish.mutate()}
              >
                {publish.isPending ? 'Yayınlanıyor…' : 'Yayınla'}
              </button>
            </>
          }
        >
          <div className="space-y-3 text-[13px] text-ink-700">
            <ul className="space-y-1">
              <li>
                • Bu sürüm <strong>aktif</strong> olacak; yeni talepler bu sürümü kullanacak.
              </li>
              <li>
                • Önceki aktif sürüm <strong>değiştirilmeyecek</strong>, yalnızca “yerine yenisi
                geçti” olarak işaretlenecek.
              </li>
              <li>
                • Önceki sürümle başlamış <strong>açık kayıtlar taşınmayacak</strong>; kendi
                sürümleri üzerinde devam edecek.
              </li>
              <li>• Yayınlandıktan sonra bu sürüm doğrudan değiştirilemeyecek.</li>
            </ul>
            {warnings.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-800">
                {warnings.length} uyarı var. Yayınlamayı engellemez ancak gözden geçirmeniz önerilir.
              </div>
            )}
            <div>
              <label className="label" htmlFor="publish-desc">
                Değişiklik Açıklaması
              </label>
              <textarea
                id="publish-desc"
                className="input"
                rows={2}
                maxLength={1000}
                value={changeDescription}
                onChange={(e) => setChangeDescription(e.target.value)}
                placeholder="Bu sürümde ne değişti?"
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
