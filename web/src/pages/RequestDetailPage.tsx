import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, downloadAttachment, uploadFile } from '../api/client';
import type { AvailableAction, RequestDetail } from '../api/types';
import { DynamicForm } from '../components/DynamicForm';
import { Timeline, WorkflowProgress, roleLabel } from '../components/WorkflowProgress';
import {
  EmptyState,
  ErrorNotice,
  KeyValue,
  Modal,
  PriorityChip,
  SlaChip,
  Spinner,
  StatusChip,
  formatBytes,
  formatDate,
  formatDateTime,
  useToast,
} from '../components/ui';
import { useAuth } from '../auth/AuthContext';

export function RequestDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [pendingAction, setPendingAction] = useState<AvailableAction | null>(null);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [internalNote, setInternalNote] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const detailQuery = useQuery({
    queryKey: ['request', id],
    queryFn: () => api.get<RequestDetail>(`/requests/${id}`),
  });

  const detail = detailQuery.data;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['request', id] });
    void queryClient.invalidateQueries({ queryKey: ['my-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  /** Bayat veri / cift islem hatalarini ortak sekilde ele alir. */
  const handleMutationError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError) {
      if (err.isStale) {
        toast.push('error', err.message);
        invalidate(); // ekran guncel veriyi yeniden yukler
        return;
      }
      if (err.isDuplicate) {
        toast.push('info', err.message);
        invalidate();
        return;
      }
      toast.push('error', err.message);
      return;
    }
    toast.push('error', fallback);
  };

  const runAction = useMutation({
    mutationFn: (input: { actionCode: string; comment: string | null }) =>
      api.post<{ statusCode: string }>(
        `/requests/${id}/actions`,
        {
          actionCode: input.actionCode,
          comment: input.comment,
          expectedRowVersion: detail!.rowVersion,
        },
        // Idempotency: ayni adim+aksiyon icin cift gonderim tek islem uretir.
        `${detail!.workflow?.instanceId ?? id}:${detail!.currentStep?.id ?? 'na'}:${input.actionCode}`,
      ),
    onSuccess: () => {
      toast.push('success', 'İşlem uygulandı.');
      setPendingAction(null);
      setComment('');
      invalidate();
    },
    onError: (err) => handleMutationError(err, 'İşlem uygulanamadı.'),
  });

  const submitDraft = useMutation({
    mutationFn: () =>
      api.post(`/requests/${id}/submit`, { expectedRowVersion: detail!.rowVersion }),
    onSuccess: () => {
      toast.push('success', 'Talebiniz gönderildi.');
      invalidate();
    },
    onError: (err) => handleMutationError(err, 'Talep gönderilemedi.'),
  });

  const cancelRequest = useMutation({
    mutationFn: () =>
      api.post(`/requests/${id}/cancel`, {
        expectedRowVersion: detail!.rowVersion,
        comment: cancelReason || null,
      }),
    onSuccess: () => {
      toast.push('success', 'Talep iptal edildi.');
      setCancelOpen(false);
      setCancelReason('');
      invalidate();
    },
    onError: (err) => handleMutationError(err, 'Talep iptal edilemedi.'),
  });

  const addComment = useMutation({
    mutationFn: () =>
      api.post(`/requests/${id}/comments`, { body: newComment, isInternal: internalNote }),
    onSuccess: () => {
      setNewComment('');
      setInternalNote(false);
      invalidate();
    },
    onError: (err) => handleMutationError(err, 'Yorum eklenemedi.'),
  });

  const upload = useMutation({
    mutationFn: (file: File) => uploadFile(id, file),
    onSuccess: () => {
      toast.push('success', 'Dosya yüklendi.');
      if (fileInput.current) fileInput.current.value = '';
      invalidate();
    },
    onError: (err) => handleMutationError(err, 'Dosya yüklenemedi.'),
  });

  const conditionContext = useMemo(
    () => ({
      category: {
        code: detail?.category.code ?? '',
        name: detail?.category.name ?? '',
        requiresManagerApproval: detail?.category.requiresManagerApproval ?? false,
      },
      request: {
        priority: detail?.priority.code ?? 'MEDIUM',
        departmentCode: user?.departmentCode ?? null,
        subject: detail?.subject ?? '',
      },
      requester: {
        id: detail?.requester.id ?? '',
        department: detail?.requester.department ?? null,
        departmentCode: user?.departmentCode ?? null,
        title: detail?.requester.title ?? null,
        hasManager: Boolean(detail?.manager),
      },
      form: detail?.formData ?? {},
    }),
    [detail, user],
  );

  if (detailQuery.isLoading) return <Spinner />;
  if (detailQuery.isError || !detail) {
    return (
      <ErrorNotice
        message={
          detailQuery.error instanceof ApiError
            ? detailQuery.error.message
            : 'Talep yüklenemedi.'
        }
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const confirmAction = () => {
    if (!pendingAction) return;
    if (pendingAction.commentRequired && comment.trim().length === 0) {
      setCommentError('Bu işlem için açıklama girilmesi zorunludur.');
      return;
    }
    setCommentError(null);
    runAction.mutate({ actionCode: pendingAction.code, comment: comment.trim() || null });
  };

  const startAction = (action: AvailableAction) => {
    setComment('');
    setCommentError(null);
    // Açıklama veya onay gerekiyorsa modal; degilse dogrudan uygula.
    if (action.commentRequired || action.confirmationRequired) {
      setPendingAction(action);
    } else {
      runAction.mutate({ actionCode: action.code, comment: null });
    }
  };

  return (
    <div className="space-y-3">
      {/* Baslik */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost btn-xs"
              onClick={() => navigate(-1)}
              aria-label="Geri"
            >
              ← Geri
            </button>
            <h1 className="text-base font-semibold text-ink-900">
              {detail.requestNo}
              <span className="ml-2 font-normal text-ink-600">{detail.subject}</span>
            </h1>
          </div>
          <p className="mt-0.5 ml-1 text-[12px] text-ink-500">
            {detail.category.name} · Oluşturma: {formatDateTime(detail.createdAt)}
            {detail.workflow && ` · İş akışı: ${detail.workflow.definitionName} v${detail.workflow.versionNumber}`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {detail.permissions.canCancel && (
            <button
              type="button"
              className="btn-default"
              onClick={() => setCancelOpen(true)}
              disabled={cancelRequest.isPending}
            >
              Talebi İptal Et
            </button>
          )}
          {detail.permissions.canSubmit && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => submitDraft.mutate()}
              disabled={submitDraft.isPending}
            >
              {submitDraft.isPending ? 'Gönderiliyor…' : 'Gönder'}
            </button>
          )}
          {detail.availableActions.map((action) => (
            <button
              key={action.code}
              type="button"
              className={
                action.variant === 'DANGER'
                  ? 'btn-danger'
                  : action.variant === 'PRIMARY'
                    ? 'btn-primary'
                    : 'btn-default'
              }
              onClick={() => startAction(action)}
              disabled={runAction.isPending}
            >
              {action.name}
            </button>
          ))}
        </div>
      </div>

      {/* Uc soru: nerede, kimde, sirada ne var */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card px-4 py-3">
          <div className="kv-label">Talebim nerede?</div>
          <div className="mt-1 flex items-center gap-2">
            <StatusChip name={detail.status.name} tone={detail.status.tone} />
          </div>
          <p className="mt-1 text-[12px] text-ink-500">
            {detail.currentStep ? `Adım: ${detail.currentStep.stepName}` : 'Süreç kapandı'}
          </p>
        </div>

        <div className="card px-4 py-3">
          <div className="kv-label">Şu anda kimde?</div>
          <p className="mt-1 text-[13px] font-medium text-ink-900">
            {detail.whoHasIt ?? 'İşlem beklenmiyor'}
          </p>
          <p className="mt-1 text-[12px] text-ink-500">
            {detail.sla.dueAt ? (
              <SlaChip status={detail.sla.status} remainingText={detail.sla.remainingText} />
            ) : (
              'SLA tanımlı değil'
            )}
          </p>
        </div>

        <div className="card px-4 py-3">
          <div className="kv-label">Bundan sonra ne olacak?</div>
          <p className="mt-1 text-[13px] font-medium text-ink-900">
            {detail.nextExpectedStep?.stepName ?? 'Bu adım süreci sonlandırıyor'}
          </p>
          {detail.nextExpectedStep?.assigneeLabel && (
            <p className="mt-1 text-[12px] text-ink-500">
              Sorumlu: {detail.nextExpectedStep.assigneeLabel}
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {/* Talep bilgileri */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Talep Bilgileri</h2>
              {detail.permissions.canEdit && (
                <Link to={`/talep/${detail.id}/duzenle`} className="btn-default btn-xs">
                  Taslağı Düzenle
                </Link>
              )}
            </div>
            <div className="grid gap-4 px-4 py-3 sm:grid-cols-4">
              <KeyValue label="Talep Eden">{detail.requester.displayName}</KeyValue>
              <KeyValue label="Departman">{detail.requester.department ?? '—'}</KeyValue>
              <KeyValue label="Ünvan">{detail.requester.title ?? '—'}</KeyValue>
              <KeyValue label="Birinci Yönetici">{detail.manager?.displayName ?? '—'}</KeyValue>
              <KeyValue label="Öncelik">
                <PriorityChip name={detail.priority.name} tone={detail.priority.tone} />
              </KeyValue>
              <KeyValue label="Beklenen Termin">{formatDate(detail.dueDate)}</KeyValue>
              <KeyValue label="Son Güncelleme">{formatDateTime(detail.updatedAt)}</KeyValue>
              <KeyValue label="Kapanma">{formatDateTime(detail.closedAt)}</KeyValue>
            </div>

            {detail.description && (
              <div className="border-t border-ink-100 px-4 py-3">
                <div className="kv-label">Açıklama</div>
                <p className="mt-1 text-[13px] whitespace-pre-wrap text-ink-800">
                  {detail.description}
                </p>
              </div>
            )}

            {detail.formFields.length > 0 && (
              <div className="border-t border-ink-100 px-4 py-3">
                <div className="kv-label mb-2">Kategoriye Özel Bilgiler</div>
                <DynamicForm
                  fields={detail.formFields}
                  values={detail.formData}
                  onChange={() => undefined}
                  context={conditionContext}
                  disabled
                />
              </div>
            )}
          </section>

          {/* Workflow ilerlemesi */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">İş Akışı İlerlemesi</h2>
            </div>
            <WorkflowProgress steps={detail.progress} />
          </section>

          {/* Onay gecmisi */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Onay Geçmişi</h2>
            </div>
            {detail.approvalHistory.length === 0 ? (
              <EmptyState title="Henüz onay/red işlemi yok" />
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Adım</th>
                      <th>İşlem</th>
                      <th>Yapan</th>
                      <th>Açıklama</th>
                      <th>Tarih</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.approvalHistory.map((entry) => (
                      <tr key={entry.id}>
                        <td className="text-ink-700">{entry.stepName ?? '—'}</td>
                        <td>
                          <span
                            className={`chip ${
                              entry.actionKind === 'REJECT'
                                ? 'border-red-200 bg-red-50 text-red-700'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            }`}
                          >
                            {entry.actionName}
                          </span>
                        </td>
                        <td className="text-ink-700">
                          {entry.performedBy.displayName}
                          {entry.performedByRole && (
                            <span className="block text-[11px] text-ink-400">
                              {roleLabel(entry.performedByRole)}
                            </span>
                          )}
                        </td>
                        <td className="max-w-72 text-ink-700">{entry.comment ?? '—'}</td>
                        <td className="whitespace-nowrap text-ink-600">
                          {formatDateTime(entry.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Islem gecmisi */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">İşlem Geçmişi</h2>
              <span className="text-[11px] text-ink-500">
                {detail.timeline.length} kayıt
              </span>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              <Timeline entries={detail.timeline} />
            </div>
          </section>
        </div>

        {/* Yan kolon */}
        <aside className="space-y-3">
          {/* Ekler */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Ekler</h2>
              <span className="text-[11px] text-ink-500">{detail.attachments.length}</span>
            </div>
            <div className="px-4 py-3">
              {detail.attachments.length === 0 && (
                <p className="text-[12px] text-ink-500">Ek dosya yok.</p>
              )}
              <ul className="space-y-1.5">
                {detail.attachments.map((file) => (
                  <li key={file.id} className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      className="text-left text-[13px] text-brand-600 hover:underline"
                      onClick={() =>
                        void downloadAttachment(file.id, file.fileName).catch((err) =>
                          handleMutationError(err, 'Dosya indirilemedi.'),
                        )
                      }
                    >
                      {file.fileName}
                      <span className="block text-[11px] text-ink-400">
                        {formatBytes(file.sizeBytes)} · {file.uploadedBy.displayName} ·{' '}
                        {formatDate(file.uploadedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              {detail.permissions.canUpload && (
                <div className="mt-3 border-t border-ink-100 pt-3">
                  <input
                    ref={fileInput}
                    type="file"
                    className="block w-full text-[12px] text-ink-600 file:mr-2 file:rounded file:border file:border-ink-300 file:bg-white file:px-2 file:py-1 file:text-[12px]"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) upload.mutate(file);
                    }}
                    disabled={upload.isPending}
                  />
                  {upload.isPending && (
                    <p className="hint">Yükleniyor…</p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Yorumlar */}
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Yorumlar</h2>
            </div>
            <div className="max-h-72 space-y-2 overflow-y-auto px-4 py-3">
              {detail.comments.length === 0 && (
                <p className="text-[12px] text-ink-500">Yorum yok.</p>
              )}
              {detail.comments.map((c) => (
                <div key={c.id} className="rounded border border-ink-100 bg-ink-50 px-2.5 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[12px] font-medium text-ink-800">
                      {c.author.displayName}
                    </span>
                    <span className="text-[10px] text-ink-400">
                      {formatDateTime(c.createdAt)}
                    </span>
                  </div>
                  {c.isInternal && (
                    <span className="chip mt-1 border-amber-200 bg-amber-50 text-amber-800">
                      Dahili not
                    </span>
                  )}
                  <p className="mt-1 text-[13px] whitespace-pre-wrap text-ink-800">{c.body}</p>
                </div>
              ))}
            </div>

            {detail.permissions.canComment && (
              <div className="space-y-2 border-t border-ink-200 px-4 py-3">
                <textarea
                  className="input"
                  rows={2}
                  maxLength={4000}
                  placeholder="Yorum ekleyin"
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                />
                {detail.permissions.canViewInternalNotes && (
                  <label className="flex items-center gap-2 text-[12px] text-ink-600">
                    <input
                      type="checkbox"
                      className="size-4 rounded border-ink-300"
                      checked={internalNote}
                      onChange={(e) => setInternalNote(e.target.checked)}
                    />
                    Dahili not (talep sahibi görmez)
                  </label>
                )}
                <button
                  type="button"
                  className="btn-default btn-xs"
                  disabled={newComment.trim().length === 0 || addComment.isPending}
                  onClick={() => addComment.mutate()}
                >
                  Yorum Ekle
                </button>
              </div>
            )}
          </section>

          {detail.permissions.isAdmin && (
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Yönetim</h2>
              </div>
              <div className="px-4 py-3">
                <Link
                  to={`/yonetim/canli-surecler/${detail.id}`}
                  className="btn-default btn-xs w-full"
                >
                  Canlı Süreç Detayı
                </Link>
                <p className="hint">
                  Süreç müdahalesi (sorumlu değiştirme, adım atlatma) bu ekrandan yapılır.
                </p>
              </div>
            </section>
          )}
        </aside>
      </div>

      {/* Aksiyon onay modali */}
      {pendingAction && (
        <Modal
          title={pendingAction.name}
          onClose={() => setPendingAction(null)}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                className="btn-default"
                onClick={() => setPendingAction(null)}
                disabled={runAction.isPending}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className={pendingAction.variant === 'DANGER' ? 'btn-danger' : 'btn-primary'}
                onClick={confirmAction}
                disabled={runAction.isPending}
              >
                {runAction.isPending ? 'Uygulanıyor…' : 'Onayla ve Uygula'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-[13px] text-ink-700">
              <strong>{detail.requestNo}</strong> numaralı talep için{' '}
              <strong>{pendingAction.name}</strong> işlemini uygulamak üzeresiniz.
            </p>
            <div>
              <label className="label" htmlFor="action-comment">
                Açıklama
                {pendingAction.commentRequired && <span className="ml-0.5 text-red-600">*</span>}
              </label>
              <textarea
                id="action-comment"
                className="input"
                rows={3}
                maxLength={4000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={
                  pendingAction.commentRequired
                    ? 'Bu işlem için açıklama zorunludur'
                    : 'İsteğe bağlı'
                }
              />
              {commentError && <p className="field-error">{commentError}</p>}
            </div>
          </div>
        </Modal>
      )}

      {/* Iptal modali */}
      {cancelOpen && (
        <Modal
          title="Talebi İptal Et"
          onClose={() => setCancelOpen(false)}
          width="max-w-lg"
          footer={
            <>
              <button
                type="button"
                className="btn-default"
                onClick={() => setCancelOpen(false)}
                disabled={cancelRequest.isPending}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => cancelRequest.mutate()}
                disabled={cancelRequest.isPending}
              >
                {cancelRequest.isPending ? 'İptal ediliyor…' : 'Talebi İptal Et'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-[13px] text-ink-700">
              <strong>{detail.requestNo}</strong> numaralı talebiniz iptal edilecek. Bu işlem geri
              alınamaz.
            </p>
            <div>
              <label className="label" htmlFor="cancel-reason">
                İptal nedeni
              </label>
              <textarea
                id="cancel-reason"
                className="input"
                rows={3}
                maxLength={2000}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
