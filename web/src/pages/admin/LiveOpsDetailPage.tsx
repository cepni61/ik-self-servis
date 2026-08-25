import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { ImpactPreview, LiveInstanceDetail } from '../../api/types';
import { UserSearchInput } from '../../components/UserSearchInput';
import {
  ErrorNotice,
  KeyValue,
  Modal,
  SlaChip,
  Spinner,
  StatusChip,
  formatDateTime,
  useToast,
} from '../../components/ui';
import { roleLabel } from '../../components/WorkflowProgress';

type OverrideType = 'REASSIGN' | 'SKIP_STEP' | 'MOVE_TO_STEP' | 'CHANGE_STATUS';

const OVERRIDE_LABELS: Record<OverrideType, string> = {
  REASSIGN: 'Sorumlu Değiştir',
  SKIP_STEP: 'Adımı Atla',
  MOVE_TO_STEP: 'Hedef Adıma Taşı',
  CHANGE_STATUS: 'Statü Değiştir',
};

const OVERRIDE_DESCRIPTIONS: Record<OverrideType, string> = {
  REASSIGN: 'Mevcut adımın sorumlusunu değiştirir. Adım ve SLA aynı kalır.',
  SKIP_STEP: 'Mevcut adımı atlar ve sıradaki geçerli adıma ilerletir.',
  MOVE_TO_STEP: 'Kaydı iş akışındaki geçerli bir adıma taşır.',
  CHANGE_STATUS: 'Yalnızca talebin görünen durumunu değiştirir.',
};

interface OverrideForm {
  overrideType: OverrideType;
  reasonCode: string;
  reasonNote: string;
  targetAssigneeId: string;
  targetStepId: string;
  targetStatusCode: string;
}

const STEP_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Bekliyor',
  ACTIVE: 'Aktif',
  COMPLETED: 'Tamamlandı',
  SKIPPED: 'Atlandı',
  CANCELLED: 'İptal',
};

/**
 * Canli kayit detayi + admin override akisi (spec 03).
 * Akis: form -> Impact Preview -> confirmation -> uygula.
 */
export function LiveOpsDetailPage() {
  const { requestId = '' } = useParams();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState<OverrideForm>({
    overrideType: 'REASSIGN',
    reasonCode: '',
    reasonNote: '',
    targetAssigneeId: '',
    targetStepId: '',
    targetStatusCode: '',
  });
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['live-detail', requestId],
    queryFn: () => api.get<LiveInstanceDetail>(`/admin/live/requests/${requestId}`),
  });

  const detail = detailQuery.data;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['live-detail', requestId] });
    void queryClient.invalidateQueries({ queryKey: ['live-instances'] });
    void queryClient.invalidateQueries({ queryKey: ['request', requestId] });
  };

  const buildPayload = () => ({
    overrideType: form.overrideType,
    reasonCode: form.reasonCode,
    reasonNote: form.reasonNote || null,
    targetAssigneeId: form.overrideType === 'REASSIGN' ? form.targetAssigneeId || null : null,
    targetStepId: form.overrideType === 'MOVE_TO_STEP' ? form.targetStepId || null : null,
    targetStatusCode:
      form.overrideType === 'CHANGE_STATUS' ? form.targetStatusCode || null : null,
    expectedRowVersion: detail!.request.rowVersion,
  });

  const runPreview = useMutation({
    mutationFn: () =>
      api.post<ImpactPreview>(
        `/admin/live/requests/${requestId}/override/preview`,
        buildPayload(),
      ),
    onSuccess: (result) => {
      setFormError(null);
      setPreview(result);
    },
    onError: (err) => {
      setPreview(null);
      if (err instanceof ApiError) {
        setFormError(err.message);
        if (err.isStale) invalidate();
      } else {
        setFormError('Etki özeti alınamadı.');
      }
    },
  });

  const applyOverride = useMutation({
    mutationFn: () =>
      api.post(`/admin/live/requests/${requestId}/override`, {
        ...buildPayload(),
        confirmed: true,
      }),
    onSuccess: () => {
      toast.push('success', 'Müdahale uygulandı ve audit kaydı oluşturuldu.');
      setPreview(null);
      setForm((f) => ({
        ...f,
        reasonNote: '',
        targetAssigneeId: '',
        targetStepId: '',
        targetStatusCode: '',
      }));
      invalidate();
    },
    onError: (err) => {
      setPreview(null);
      if (err instanceof ApiError) {
        toast.push('error', err.message);
        if (err.isStale) invalidate();
      } else {
        toast.push('error', 'Müdahale uygulanamadı.');
      }
    },
  });

  if (detailQuery.isLoading) return <Spinner />;
  if (detailQuery.isError || !detail) {
    return (
      <ErrorNotice
        message={
          detailQuery.error instanceof ApiError
            ? detailQuery.error.message
            : 'Kayıt yüklenemedi.'
        }
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const options = detail.overrideOptions;
  const canRunPreview =
    Boolean(form.reasonCode) &&
    (form.reasonCode !== 'OTHER' || form.reasonNote.trim().length > 0) &&
    (form.overrideType !== 'REASSIGN' || Boolean(form.targetAssigneeId)) &&
    (form.overrideType !== 'MOVE_TO_STEP' || Boolean(form.targetStepId)) &&
    (form.overrideType !== 'CHANGE_STATUS' || Boolean(form.targetStatusCode));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/yonetim/canli-surecler" className="btn-ghost btn-xs">
              ← Canlı Süreçler
            </Link>
            <h1 className="text-base font-semibold text-ink-900">
              {detail.request.requestNo}
              <span className="ml-2 font-normal text-ink-600">{detail.request.subject}</span>
            </h1>
          </div>
          <p className="mt-0.5 ml-1 text-[12px] text-ink-500">
            {detail.request.category.name} · {detail.workflow.definitionName} v
            {detail.workflow.versionNumber}
          </p>
        </div>
        <Link to={`/talep/${requestId}`} className="btn-default btn-xs">
          Kullanıcı Görünümü
        </Link>
      </div>

      {detail.workflow.isRunningOnSupersededVersion && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          Bu kayıt <strong>v{detail.workflow.versionNumber}</strong> sürümünde çalışıyor; iş
          akışının güncel sürümü farklı. Müdahaleler kaydın kendi sürümü üzerinden uygulanır.
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_400px]">
        <div className="space-y-3">
          {/* Kayit + workflow + operasyon */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Kayıt</h2>
            </div>
            <div className="grid gap-4 px-4 py-3 sm:grid-cols-4">
              <KeyValue label="Talep No">{detail.request.requestNo}</KeyValue>
              <KeyValue label="Talep Eden">
                {detail.request.requester.displayName}
                {!detail.request.requester.isActive && (
                  <span className="chip ml-1 border-red-200 bg-red-50 text-red-700">Pasif</span>
                )}
              </KeyValue>
              <KeyValue label="Kategori">{detail.request.category.name}</KeyValue>
              <KeyValue label="Oluşturma">{formatDateTime(detail.request.createdAt)}</KeyValue>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2 className="card-title">İş Akışı</h2>
            </div>
            <div className="grid gap-4 px-4 py-3 sm:grid-cols-4">
              <KeyValue label="İş Akışı">{detail.workflow.definitionName}</KeyValue>
              <KeyValue label="Sürüm">
                v{detail.workflow.versionNumber} ({detail.workflow.versionStatus})
              </KeyValue>
              <KeyValue label="Süreç Durumu">{detail.workflow.instanceStatus}</KeyValue>
              <KeyValue label="SLA Takvimi">
                {detail.workflow.slaCalendarMode === 'BUSINESS_DAYS'
                  ? 'İş günü'
                  : 'Takvim günü'}
              </KeyValue>
              <KeyValue label="Mevcut Adım">{detail.currentStep?.name ?? '—'}</KeyValue>
              <KeyValue label="Mevcut Durum">
                {detail.request.status ? (
                  <StatusChip
                    name={detail.request.status.name}
                    tone={detail.request.status.tone}
                  />
                ) : (
                  '—'
                )}
              </KeyValue>
              <KeyValue label="Mevcut Sorumlu">
                {detail.currentStep?.assigneeLabel ?? '—'}
                {detail.currentStep && !detail.currentStep.assigneeId && (
                  <span className="block text-[11px] text-ink-400">Havuz görevi</span>
                )}
              </KeyValue>
              <KeyValue label="Önceki Adım">{detail.previousStep?.name ?? '—'}</KeyValue>
              <KeyValue label="Sonraki Beklenen Adım">
                {detail.nextExpectedStep?.name ?? '—'}
              </KeyValue>
              <KeyValue label="Adım Başlangıcı">
                {formatDateTime(detail.operations.stepStartedAt)}
              </KeyValue>
              <KeyValue label="SLA">
                <SlaChip
                  status={detail.operations.slaStatus}
                  remainingText={detail.operations.slaRemainingText}
                />
              </KeyValue>
              <KeyValue label="Son İşlem">
                {detail.operations.lastAction
                  ? `${detail.operations.lastAction.actionName} · ${detail.operations.lastAction.byName}`
                  : '—'}
              </KeyValue>
            </div>
          </section>

          {/* Adim gecmisi */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Adım Geçmişi</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Sıra</th>
                    <th>Adım</th>
                    <th>Durum</th>
                    <th>Sorumlu</th>
                    <th>Başlangıç</th>
                    <th>Bitiş</th>
                    <th>SLA</th>
                    <th>Sonuç</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.timeline.map((step) => (
                    <tr
                      key={step.stepInstanceId}
                      className={step.isCurrent ? 'bg-brand-50/60' : undefined}
                    >
                      <td className="text-ink-700">{step.sequence}</td>
                      <td>
                        <div className="font-medium text-ink-900">{step.name}</div>
                        <div className="font-mono text-[10px] text-ink-400">{step.code}</div>
                      </td>
                      <td>
                        <span className="chip border-ink-200 bg-ink-50 text-ink-600">
                          {STEP_STATUS_LABELS[step.status] ?? step.status}
                        </span>
                        {step.skipReason && (
                          <span className="block text-[10px] text-ink-400">
                            {step.skipReason}
                          </span>
                        )}
                      </td>
                      <td className="text-ink-700">{step.assigneeLabel ?? '—'}</td>
                      <td className="whitespace-nowrap text-ink-600">
                        {formatDateTime(step.startedAt)}
                      </td>
                      <td className="whitespace-nowrap text-ink-600">
                        {formatDateTime(step.completedAt)}
                      </td>
                      <td>
                        <SlaChip status={step.slaStatus} />
                      </td>
                      <td className="max-w-56 text-[12px] text-ink-600">
                        {step.resultActionCode ?? '—'}
                        {step.resultComment && (
                          <span className="block truncate text-[11px] text-ink-500">
                            {step.resultComment}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Audit trail */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Audit Kayıtları</h2>
              <span className="text-[11px] text-ink-500">
                {detail.auditTrail.length} kayıt · değiştirilemez
              </span>
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Zaman</th>
                    <th>Olay</th>
                    <th>Kullanıcı</th>
                    <th>Adım</th>
                    <th>Durum Değişimi</th>
                    <th>Açıklama</th>
                    <th>Görünürlük</th>
                  </tr>
                </thead>
                <tbody>
                  {[...detail.auditTrail].reverse().map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap text-ink-600">
                        {formatDateTime(event.occurredAt)}
                      </td>
                      <td className="font-mono text-[11px] text-ink-700">{event.eventType}</td>
                      <td className="text-ink-700">
                        {event.userDisplayName ?? 'Sistem'}
                        {event.userRole && (
                          <span className="block text-[10px] text-ink-400">
                            {roleLabel(event.userRole)}
                          </span>
                        )}
                      </td>
                      <td className="text-ink-600">{event.stepName ?? '—'}</td>
                      <td className="whitespace-nowrap text-[11px] text-ink-600">
                        {event.oldStatusCode || event.newStatusCode
                          ? `${event.oldStatusCode ?? '—'} → ${event.newStatusCode ?? '—'}`
                          : '—'}
                      </td>
                      <td className="max-w-72 text-[12px] text-ink-700">
                        {event.description ?? '—'}
                      </td>
                      <td>
                        <span
                          className={`chip ${
                            event.visibility === 'ADMIN'
                              ? 'border-ink-300 bg-ink-100 text-ink-600'
                              : 'border-brand-200 bg-brand-50 text-brand-700'
                          }`}
                        >
                          {event.visibility === 'ADMIN' ? 'Yönetici' : 'Kullanıcı'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Mudahale gecmisi */}
          {detail.overrideHistory.length > 0 && (
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Müdahale Geçmişi</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Zaman</th>
                      <th>İşlem</th>
                      <th>Neden</th>
                      <th>Adım</th>
                      <th>Durum</th>
                      <th>Yapan</th>
                      <th>Sürüm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.overrideHistory.map((o) => (
                      <tr key={o.id}>
                        <td className="whitespace-nowrap text-ink-600">
                          {formatDateTime(o.createdAt)}
                        </td>
                        <td className="text-ink-800">
                          {OVERRIDE_LABELS[o.overrideType as OverrideType] ?? o.overrideType}
                        </td>
                        <td className="text-ink-700">
                          {o.reasonLabel}
                          {o.reasonNote && (
                            <span className="block max-w-56 text-[11px] text-ink-500">
                              {o.reasonNote}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap text-[12px] text-ink-600">
                          {o.fromStepName ?? '—'} → {o.toStepName ?? '—'}
                        </td>
                        <td className="whitespace-nowrap text-[12px] text-ink-600">
                          {o.fromStatusCode ?? '—'} → {o.toStatusCode ?? '—'}
                        </td>
                        <td className="text-ink-700">{o.adminUser.displayName}</td>
                        <td className="text-ink-600">v{o.workflowVersionNumber ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* Override paneli */}
        <aside>
          <section className="card sticky top-3">
            <div className="card-header">
              <h2 className="card-title">Süreç Müdahalesi</h2>
            </div>

            {!options.canOverride ? (
              <p className="px-4 py-4 text-[12px] text-ink-500">
                Bu kayıt kapanmış durumda; müdahale yapılamaz.
              </p>
            ) : (
              <div className="space-y-3 px-4 py-3">
                <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
                  Bu işlemler normal iş akışı aksiyonu değildir. Her biri
                  <strong> ADMIN_OVERRIDE </strong>
                  olarak audit&apos;e yazılır ve talep sahibinin işlem geçmişinde görünür.
                </div>

                <div>
                  <label className="label" htmlFor="o-type">
                    İşlem <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="o-type"
                    className="input"
                    value={form.overrideType}
                    onChange={(e) => {
                      setPreview(null);
                      setFormError(null);
                      setForm((f) => ({
                        ...f,
                        overrideType: e.target.value as OverrideType,
                        targetAssigneeId: '',
                        targetStepId: '',
                        targetStatusCode: '',
                      }));
                    }}
                  >
                    {(options.types as OverrideType[]).map((t) => (
                      <option key={t} value={t}>
                        {OVERRIDE_LABELS[t] ?? t}
                      </option>
                    ))}
                  </select>
                  <p className="hint">{OVERRIDE_DESCRIPTIONS[form.overrideType]}</p>
                </div>

                {form.overrideType === 'REASSIGN' && (
                  <div>
                    <label className="label">
                      Yeni Sorumlu <span className="text-red-600">*</span>
                    </label>
                    <UserSearchInput
                      selectedId={form.targetAssigneeId || null}
                      onSelect={(user) => {
                        setPreview(null);
                        setForm((f) => ({ ...f, targetAssigneeId: user?.id ?? '' }));
                      }}
                    />
                  </div>
                )}

                {form.overrideType === 'MOVE_TO_STEP' && (
                  <div>
                    <label className="label" htmlFor="o-step">
                      Hedef Adım <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="o-step"
                      className="input"
                      value={form.targetStepId}
                      onChange={(e) => {
                        setPreview(null);
                        setForm((f) => ({ ...f, targetStepId: e.target.value }));
                      }}
                    >
                      <option value="">Seçiniz…</option>
                      {options.moveTargets.map((t) => (
                        <option key={t.stepId} value={t.stepId}>
                          {t.sequence}. {t.name}
                          {t.isRevisit ? ' (tekrar)' : ''}
                        </option>
                      ))}
                    </select>
                    <p className="hint">
                      Tamamlanmış bir adıma dönülürse geçmiş silinmez; adım için yeni bir görev
                      kaydı oluşur.
                    </p>
                  </div>
                )}

                {form.overrideType === 'CHANGE_STATUS' && (
                  <div>
                    <label className="label" htmlFor="o-status">
                      Yeni Durum <span className="text-red-600">*</span>
                    </label>
                    <select
                      id="o-status"
                      className="input"
                      value={form.targetStatusCode}
                      onChange={(e) => {
                        setPreview(null);
                        setForm((f) => ({ ...f, targetStatusCode: e.target.value }));
                      }}
                    >
                      <option value="">Seçiniz…</option>
                      {options.allowedStatuses.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <p className="hint">
                      Yalnızca müdahaleye izin verilen durumlar listelenir; serbest metin
                      girilemez.
                    </p>
                  </div>
                )}

                <div>
                  <label className="label" htmlFor="o-reason">
                    Müdahale Nedeni <span className="text-red-600">*</span>
                  </label>
                  <select
                    id="o-reason"
                    className="input"
                    value={form.reasonCode}
                    onChange={(e) => {
                      setPreview(null);
                      setForm((f) => ({ ...f, reasonCode: e.target.value }));
                    }}
                  >
                    <option value="">Seçiniz…</option>
                    {options.reasons.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label" htmlFor="o-note">
                    Açıklama
                    {form.reasonCode === 'OTHER' && <span className="text-red-600"> *</span>}
                  </label>
                  <textarea
                    id="o-note"
                    className="input"
                    rows={3}
                    maxLength={2000}
                    value={form.reasonNote}
                    onChange={(e) => {
                      setPreview(null);
                      setForm((f) => ({ ...f, reasonNote: e.target.value }));
                    }}
                  />
                </div>

                {formError && (
                  <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-700">
                    {formError}
                  </p>
                )}

                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={!canRunPreview || runPreview.isPending}
                  onClick={() => runPreview.mutate()}
                >
                  {runPreview.isPending ? 'Hesaplanıyor…' : 'Etkiyi Göster'}
                </button>
                <p className="hint">
                  Müdahale, etki özetini onaylamadan uygulanmaz.
                </p>
              </div>
            )}
          </section>
        </aside>
      </div>

      {/* Impact preview + confirmation */}
      {preview && (
        <Modal
          title="Etki Özeti — Onay Gerekiyor"
          onClose={() => setPreview(null)}
          width="max-w-2xl"
          footer={
            <>
              <button
                type="button"
                className="btn-default"
                onClick={() => setPreview(null)}
                disabled={applyOverride.isPending}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="btn-danger"
                disabled={applyOverride.isPending}
                onClick={() => applyOverride.mutate()}
              >
                {applyOverride.isPending ? 'Uygulanıyor…' : 'Onaylıyorum, Uygula'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <table className="data-table">
              <tbody>
                <PreviewRow label="Talep No" value={preview.requestNo} />
                <PreviewRow label="Talep Eden" value={preview.requesterName} />
                <PreviewRow
                  label="İş Akışı"
                  value={`${preview.workflowName} v${preview.workflowVersionNumber}`}
                />
                <PreviewRow label="Yapılacak İşlem" value={preview.operationLabel} emphasize />
                <PreviewRow label="Müdahale Nedeni" value={preview.reasonLabel} />
                {preview.reasonNote && (
                  <PreviewRow label="Açıklama" value={preview.reasonNote} />
                )}
                <PreviewRow label="Mevcut Adım" value={preview.currentStepName ?? '—'} />
                <PreviewRow label="Mevcut Durum" value={preview.currentStatusName ?? '—'} />
                <PreviewRow
                  label="Mevcut Sorumlu"
                  value={preview.currentAssigneeLabel ?? '—'}
                />
                <PreviewRow label="Yeni Adım" value={preview.newStepName ?? '—'} emphasize />
                <PreviewRow label="Yeni Durum" value={preview.newStatusName ?? '—'} emphasize />
                <PreviewRow
                  label="Yeni Sorumlu"
                  value={preview.newAssigneeLabel ?? '—'}
                  emphasize
                />
                <PreviewRow label="Kapanacak Görev" value={preview.taskToClose ?? '—'} />
                <PreviewRow label="Oluşacak Görev" value={preview.taskToCreate ?? '—'} />
                <PreviewRow label="SLA Etkisi" value={preview.slaImpact} />
                <PreviewRow
                  label="Bildirim Etkisi"
                  value={preview.notificationImpact.join(' ')}
                />
              </tbody>
            </table>

            {preview.warnings.length > 0 && (
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2">
                <p className="text-[12px] font-semibold text-amber-900">Dikkat</p>
                <ul className="mt-1 space-y-1 text-[12px] text-amber-900">
                  {preview.warnings.map((warning, index) => (
                    <li key={index}>• {warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[11px] text-ink-500">
              Onayladığınızda işlem ADMIN_OVERRIDE olarak audit&apos;e yazılacak ve geri
              alınamayacaktır.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PreviewRow({
  label,
  value,
  emphasize = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <tr>
      <th className="w-48 text-left">{label}</th>
      <td className={emphasize ? 'font-medium text-ink-900' : 'text-ink-700'}>{value}</td>
    </tr>
  );
}
