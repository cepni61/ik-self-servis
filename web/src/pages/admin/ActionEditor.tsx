import { useEffect, useState } from 'react';
import type { AdminMeta, StatusInfo, WorkflowActionConfig, WorkflowStepConfig } from '../../api/types';
import { Disclosure, Modal } from '../../components/ui';

export interface ActionFormState {
  code: string;
  name: string;
  kind: string;
  targetStepMode: string;
  targetStepId: string;
  targetStatusCode: string;
  commentRequired: boolean;
  confirmationRequired: boolean;
  notify: boolean;
  variant: string;
  isActive: boolean;
}

export const ACTION_KIND_LABELS: Record<string, string> = {
  SUBMIT: 'Gönder',
  APPROVE: 'Onayla',
  REJECT: 'Reddet',
  REQUEST_INFO: 'Ek Bilgi İste',
  COMPLETE: 'Tamamla',
  CANCEL: 'İptal Et',
  FORWARD: 'Yönlendir',
};

export const TARGET_MODE_LABELS: Record<string, string> = {
  NEXT: 'Sıradaki uygun adım',
  SPECIFIC: 'Belirli bir adım',
  END: 'Akışı bitir',
  STAY: 'Aynı adımda kal',
  REQUESTER: 'Talep sahibine geri gönder',
};

function emptyState(): ActionFormState {
  return {
    code: '',
    name: '',
    kind: 'APPROVE',
    targetStepMode: 'NEXT',
    targetStepId: '',
    targetStatusCode: '',
    commentRequired: false,
    confirmationRequired: true,
    notify: true,
    variant: 'PRIMARY',
    isActive: true,
  };
}

function fromAction(action: WorkflowActionConfig): ActionFormState {
  return {
    code: action.code,
    name: action.name,
    kind: action.kind,
    targetStepMode: action.targetStepMode,
    targetStepId: action.targetStepId ?? '',
    targetStatusCode: action.targetStatusCode ?? '',
    commentRequired: action.commentRequired,
    confirmationRequired: action.confirmationRequired,
    notify: action.notify,
    variant: action.variant,
    isActive: action.isActive,
  };
}

/** Aksiyon (buton) ayarlari. */
export function ActionEditor({
  action,
  step,
  steps,
  meta,
  statuses,
  saving,
  error,
  onSave,
  onClose,
}: {
  action: WorkflowActionConfig | null;
  step: WorkflowStepConfig;
  steps: WorkflowStepConfig[];
  meta: AdminMeta;
  statuses: StatusInfo[];
  saving: boolean;
  error: string | null;
  onSave: (state: ActionFormState) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ActionFormState>(() =>
    action ? fromAction(action) : emptyState(),
  );

  useEffect(() => {
    setForm(action ? fromAction(action) : emptyState());
  }, [action]);

  const set = <K extends keyof ActionFormState>(key: K, value: ActionFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const codeLocked = Boolean(action);
  const valid =
    form.name.trim().length >= 2 &&
    form.code.trim().length >= 2 &&
    (form.targetStepMode !== 'SPECIFIC' || form.targetStepId);

  /** Aksiyon tipi degistiginde makul varsayilanlari uygula. */
  const applyKindDefaults = (kind: string) => {
    set('kind', kind);
    if (kind === 'REJECT') {
      set('commentRequired', true);
      set('confirmationRequired', true);
      set('variant', 'DANGER');
      set('targetStepMode', 'END');
    } else if (kind === 'REQUEST_INFO') {
      set('commentRequired', true);
      set('variant', 'DEFAULT');
      set('targetStepMode', 'REQUESTER');
    } else if (kind === 'APPROVE' || kind === 'COMPLETE') {
      set('variant', 'PRIMARY');
      set('targetStepMode', 'NEXT');
    }
    if (!codeLocked && !form.code) {
      set('code', kind);
      set('name', ACTION_KIND_LABELS[kind] ?? kind);
    }
  };

  return (
    <Modal
      title={action ? `Aksiyonu Düzenle: ${action.name}` : `Yeni Aksiyon — ${step.name}`}
      onClose={onClose}
      width="max-w-2xl"
      footer={
        <>
          <button type="button" className="btn-default" onClick={onClose} disabled={saving}>
            Vazgeç
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={!valid || saving}
            onClick={() => onSave(form)}
          >
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="action-kind">
              Aksiyon Tipi <span className="text-red-600">*</span>
            </label>
            <select
              id="action-kind"
              className="input"
              value={form.kind}
              onChange={(e) => applyKindDefaults(e.target.value)}
            >
              {meta.actionKinds.map((k) => (
                <option key={k} value={k}>
                  {ACTION_KIND_LABELS[k] ?? k}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="action-name">
              Buton Metni <span className="text-red-600">*</span>
            </label>
            <input
              id="action-name"
              className="input"
              maxLength={60}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="action-code">
              Aksiyon Kodu <span className="text-red-600">*</span>
            </label>
            <input
              id="action-code"
              className="input font-mono"
              value={form.code}
              disabled={codeLocked}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
            />
            {codeLocked && <p className="hint">Mevcut aksiyonun kodu değiştirilemez.</p>}
          </div>

          <div>
            <label className="label" htmlFor="action-target-mode">
              Bu aksiyondan sonra <span className="text-red-600">*</span>
            </label>
            <select
              id="action-target-mode"
              className="input"
              value={form.targetStepMode}
              onChange={(e) => set('targetStepMode', e.target.value)}
            >
              {meta.targetStepModes.map((m) => (
                <option key={m} value={m}>
                  {TARGET_MODE_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          </div>

          {form.targetStepMode === 'SPECIFIC' && (
            <div>
              <label className="label" htmlFor="action-target-step">
                Hedef Adım <span className="text-red-600">*</span>
              </label>
              <select
                id="action-target-step"
                className="input"
                value={form.targetStepId}
                onChange={(e) => set('targetStepId', e.target.value)}
              >
                <option value="">Seçiniz…</option>
                {steps
                  .filter((s) => s.id !== step.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.sequence}. {s.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          <div>
            <label className="label" htmlFor="action-target-status">
              Yeni Talep Durumu
            </label>
            <select
              id="action-target-status"
              className="input"
              value={form.targetStatusCode}
              onChange={(e) => set('targetStatusCode', e.target.value)}
            >
              <option value="">Hedef adımın durumunu kullan</option>
              {statuses.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2 rounded border border-ink-200 p-3">
          <label className="flex items-center gap-2 text-[13px] text-ink-800">
            <input
              type="checkbox"
              className="size-4 rounded border-ink-300"
              checked={form.commentRequired}
              onChange={(e) => set('commentRequired', e.target.checked)}
            />
            Açıklama zorunlu
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-800">
            <input
              type="checkbox"
              className="size-4 rounded border-ink-300"
              checked={form.confirmationRequired}
              onChange={(e) => set('confirmationRequired', e.target.checked)}
            />
            Uygulamadan önce onay istenir
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-800">
            <input
              type="checkbox"
              className="size-4 rounded border-ink-300"
              checked={form.notify}
              onChange={(e) => set('notify', e.target.checked)}
            />
            Bildirim gönderilsin
          </label>
          {form.kind === 'REJECT' && !form.commentRequired && (
            <p className="text-[11px] text-amber-700">
              Red işlemlerinde açıklamanın zorunlu olması önerilir.
            </p>
          )}
        </div>

        <Disclosure title="Görünüm">
          <div className="sm:w-56">
            <label className="label" htmlFor="action-variant">
              Buton Stili
            </label>
            <select
              id="action-variant"
              className="input"
              value={form.variant}
              onChange={(e) => set('variant', e.target.value)}
            >
              <option value="PRIMARY">Birincil (vurgulu)</option>
              <option value="DEFAULT">Normal</option>
              <option value="DANGER">Uyarı (kırmızı)</option>
            </select>
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-800">
            <input
              type="checkbox"
              className="size-4 rounded border-ink-300"
              checked={form.isActive}
              onChange={(e) => set('isActive', e.target.checked)}
            />
            Aksiyon aktif
          </label>
        </Disclosure>

        {error && (
          <p className="rounded border border-red-200 bg-red-50 px-2.5 py-2 text-[12px] text-red-700">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
