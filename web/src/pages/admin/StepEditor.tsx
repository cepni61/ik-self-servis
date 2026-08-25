import { useEffect, useState } from 'react';
import type {
  AdminMeta,
  CategoryListItem,
  PriorityInfo,
  StatusInfo,
  WorkflowStepConfig,
} from '../../api/types';
import { Disclosure, Modal } from '../../components/ui';
import { UserSearchInput } from '../../components/UserSearchInput';
import { ConditionEditor, parseConditionJson, type ConditionGroup } from './ConditionEditor';

export interface StepFormState {
  code: string;
  name: string;
  description: string;
  type: string;
  assigneeType: string;
  assigneeRoleCode: string;
  assigneeGroupId: string;
  assigneeUserId: string;
  statusCode: string;
  slaEnabled: boolean;
  slaHours: string;
  slaReminderHours: string;
  slaEscalationHours: string;
  condition: ConditionGroup | null;
  isActive: boolean;
}

export const STEP_TYPE_LABELS: Record<string, string> = {
  START: 'Başlangıç',
  APPROVAL: 'Onay',
  REVIEW: 'Kontrol',
  TASK: 'İşlem',
  END: 'Bitiş',
};

export const ASSIGNEE_TYPE_LABELS: Record<string, string> = {
  REQUESTER: 'Talep Eden',
  REQUESTER_MANAGER: 'Talep Edenin Yöneticisi',
  HR_USER: 'İnsan Kaynakları',
  HR_PROCESS_OWNER: 'İK Süreç Sahibi',
  ROLE: 'Belirli Rol',
  GROUP: 'Belirli Ekip',
  USER: 'Belirli Kullanıcı',
};

function emptyState(): StepFormState {
  return {
    code: '',
    name: '',
    description: '',
    type: 'REVIEW',
    assigneeType: 'HR_USER',
    assigneeRoleCode: '',
    assigneeGroupId: '',
    assigneeUserId: '',
    statusCode: 'HR_REVIEW',
    slaEnabled: false,
    slaHours: '',
    slaReminderHours: '',
    slaEscalationHours: '',
    condition: null,
    isActive: true,
  };
}

function fromStep(step: WorkflowStepConfig): StepFormState {
  return {
    code: step.code,
    name: step.name,
    description: step.description ?? '',
    type: step.type,
    assigneeType: step.assigneeType,
    assigneeRoleCode: step.assigneeRoleCode ?? '',
    assigneeGroupId: step.assigneeGroupId ?? '',
    assigneeUserId: step.assigneeUserId ?? '',
    statusCode: step.statusCode,
    slaEnabled: step.slaEnabled,
    slaHours: step.slaHours ? String(step.slaHours) : '',
    slaReminderHours: step.slaReminderHours ? String(step.slaReminderHours) : '',
    slaEscalationHours: step.slaEscalationHours ? String(step.slaEscalationHours) : '',
    condition: parseConditionJson(step.conditionJson),
    isActive: step.isActive,
  };
}

/**
 * Adim ayarlari.
 * Temel ayarlar gorunur; SLA, kosul ve ileri ayarlar "Advanced Settings"
 * bolumlerinde (progressive disclosure).
 */
export function StepEditor({
  step,
  meta,
  statuses,
  roles,
  groups,
  categories,
  priorities,
  formFieldKeys,
  saving,
  error,
  onSave,
  onClose,
}: {
  /** null ise yeni adim. */
  step: WorkflowStepConfig | null;
  meta: AdminMeta;
  statuses: StatusInfo[];
  roles: Array<{ code: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  categories: CategoryListItem[];
  priorities: PriorityInfo[];
  formFieldKeys: Array<{ key: string; label: string }>;
  saving: boolean;
  error: string | null;
  onSave: (state: StepFormState) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<StepFormState>(() =>
    step ? fromStep(step) : emptyState(),
  );

  useEffect(() => {
    setForm(step ? fromStep(step) : emptyState());
  }, [step]);

  const set = <K extends keyof StepFormState>(key: K, value: StepFormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const codeLocked = Boolean(step);
  const valid = form.name.trim().length >= 2 && form.code.trim().length >= 2 && form.statusCode;

  return (
    <Modal
      title={step ? `Adımı Düzenle: ${step.name}` : 'Yeni Adım'}
      onClose={onClose}
      width="max-w-3xl"
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
        {/* --- Genel --- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="step-name">
              Adım Adı <span className="text-red-600">*</span>
            </label>
            <input
              id="step-name"
              className="input"
              value={form.name}
              onChange={(e) => {
                const name = e.target.value;
                set('name', name);
                // Yeni adimda kod adi otomatik onerilir
                if (!codeLocked && !form.code) {
                  set(
                    'code',
                    name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 40),
                  );
                }
              }}
            />
          </div>

          <div>
            <label className="label" htmlFor="step-code">
              Adım Kodu <span className="text-red-600">*</span>
            </label>
            <input
              id="step-code"
              className="input font-mono"
              value={form.code}
              disabled={codeLocked}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
            />
            {codeLocked && <p className="hint">Mevcut adımın kodu değiştirilemez.</p>}
          </div>

          <div>
            <label className="label" htmlFor="step-type">
              Adım Tipi <span className="text-red-600">*</span>
            </label>
            <select
              id="step-type"
              className="input"
              value={form.type}
              onChange={(e) => set('type', e.target.value)}
            >
              {meta.stepTypes.map((t) => (
                <option key={t} value={t}>
                  {STEP_TYPE_LABELS[t] ?? t}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="step-status">
              Adım Aktifken Talep Durumu <span className="text-red-600">*</span>
            </label>
            <select
              id="step-status"
              className="input"
              value={form.statusCode}
              onChange={(e) => set('statusCode', e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="hint">Talep bu adımdayken kullanıcıya gösterilen durum.</p>
          </div>
        </div>

        {/* --- Sorumlu --- */}
        <div className="rounded border border-ink-200 p-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="step-assignee-type">
                Sorumlu <span className="text-red-600">*</span>
              </label>
              <select
                id="step-assignee-type"
                className="input"
                value={form.assigneeType}
                onChange={(e) => set('assigneeType', e.target.value)}
              >
                {meta.assigneeTypes.map((t) => (
                  <option key={t} value={t}>
                    {ASSIGNEE_TYPE_LABELS[t] ?? t}
                  </option>
                ))}
              </select>
            </div>

            {form.assigneeType === 'ROLE' && (
              <div>
                <label className="label" htmlFor="step-role">
                  Rol <span className="text-red-600">*</span>
                </label>
                <select
                  id="step-role"
                  className="input"
                  value={form.assigneeRoleCode}
                  onChange={(e) => set('assigneeRoleCode', e.target.value)}
                >
                  <option value="">Seçiniz…</option>
                  {roles.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {form.assigneeType === 'GROUP' && (
              <div>
                <label className="label" htmlFor="step-group">
                  Ekip <span className="text-red-600">*</span>
                </label>
                <select
                  id="step-group"
                  className="input"
                  value={form.assigneeGroupId}
                  onChange={(e) => set('assigneeGroupId', e.target.value)}
                >
                  <option value="">Seçiniz…</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {form.assigneeType === 'USER' && (
              <div>
                <label className="label">
                  Kullanıcı <span className="text-red-600">*</span>
                </label>
                <UserSearchInput
                  selectedId={form.assigneeUserId || null}
                  onSelect={(user) => set('assigneeUserId', user?.id ?? '')}
                />
                <p className="hint">
                  Kişiye sabitlemek yerine rol/ekip kullanmak daha dayanıklıdır.
                </p>
              </div>
            )}
          </div>

          {(form.assigneeType === 'HR_USER' || form.assigneeType === 'HR_PROCESS_OWNER') && (
            <p className="mt-2 text-[11px] text-ink-500">
              İK adımlarında görev, ilgili roldeki tüm kullanıcıların görebileceği bir havuz
              görevi olarak açılır. Kategori ayarlarında sorumlu ekip/rol belirtilmişse görev o
              ekibe daraltılır.
            </p>
          )}
        </div>

        {/* --- Ileri ayarlar --- */}
        <Disclosure title="Koşul (bu adım hangi durumlarda çalışır?)" defaultOpen={Boolean(form.condition)}>
          <ConditionEditor
            value={form.condition}
            onChange={(v) => set('condition', v)}
            meta={meta}
            categories={categories}
            priorities={priorities}
            formFieldKeys={formFieldKeys}
          />
          <p className="hint mt-2">
            Koşul sağlanmazsa adım atlanır ve talep bir sonraki uygun adıma geçer.
          </p>
        </Disclosure>

        <Disclosure title="SLA ayarları" defaultOpen={form.slaEnabled}>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-[13px] text-ink-800">
              <input
                type="checkbox"
                className="size-4 rounded border-ink-300"
                checked={form.slaEnabled}
                onChange={(e) => set('slaEnabled', e.target.checked)}
              />
              Bu adım için SLA takibi yapılsın
            </label>

            {form.slaEnabled && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label" htmlFor="sla-hours">
                    Hedef süre (saat) <span className="text-red-600">*</span>
                  </label>
                  <input
                    id="sla-hours"
                    type="number"
                    min={1}
                    max={8760}
                    className="input"
                    value={form.slaHours}
                    onChange={(e) => set('slaHours', e.target.value)}
                  />
                  {form.slaHours && (
                    <p className="hint">
                      ≈ {(Number(form.slaHours) / 24).toFixed(1)} gün
                    </p>
                  )}
                </div>
                <div>
                  <label className="label" htmlFor="sla-reminder">
                    Hatırlatma (saat)
                  </label>
                  <input
                    id="sla-reminder"
                    type="number"
                    min={1}
                    max={8760}
                    className="input"
                    value={form.slaReminderHours}
                    onChange={(e) => set('slaReminderHours', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="sla-escalation">
                    Eskalasyon (saat)
                  </label>
                  <input
                    id="sla-escalation"
                    type="number"
                    min={1}
                    max={8760}
                    className="input"
                    value={form.slaEscalationHours}
                    onChange={(e) => set('slaEscalationHours', e.target.value)}
                  />
                </div>
              </div>
            )}
            <p className="hint">
              Sürenin iş günü mü takvim günü mü sayılacağı, sürüm başlığındaki SLA takvim modu
              ayarına göre belirlenir.
            </p>
          </div>
        </Disclosure>

        <Disclosure title="Diğer ayarlar">
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="step-desc">
                Açıklama
              </label>
              <textarea
                id="step-desc"
                className="input"
                rows={2}
                maxLength={1000}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-[13px] text-ink-800">
              <input
                type="checkbox"
                className="size-4 rounded border-ink-300"
                checked={form.isActive}
                onChange={(e) => set('isActive', e.target.checked)}
              />
              Adım aktif
            </label>
            <p className="hint">
              Pasif adım yeni taleplerde atlanır; mevcut açık kayıtlar etkilenmez.
            </p>
          </div>
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
