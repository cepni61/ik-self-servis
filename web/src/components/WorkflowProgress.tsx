import type { ProgressStep, TimelineEntry } from '../api/types';
import { formatDateTime, SlaChip } from './ui';

/**
 * Is akisi ilerlemesi.
 * Gecmis / mevcut / gelecek / atlanmis adimlar gorsel olarak ayirt edilir.
 */
export function WorkflowProgress({ steps }: { steps: ProgressStep[] }) {
  if (steps.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-ink-500">
        Talep gönderildiğinde iş akışı adımları burada görünecek.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-ink-100">
      {steps.map((step) => (
        <li key={step.id} className="flex gap-3 px-4 py-2.5">
          <StepMarker step={step} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={`text-[13px] ${
                  step.phase === 'current'
                    ? 'font-semibold text-ink-900'
                    : step.phase === 'skipped'
                      ? 'text-ink-400 line-through'
                      : step.phase === 'past'
                        ? 'text-ink-700'
                        : 'text-ink-500'
                }`}
              >
                {step.stepName}
              </span>
              {step.phase === 'current' && (
                <span className="chip border-brand-200 bg-brand-50 text-brand-700">
                  Şu anki adım
                </span>
              )}
              {step.isAwaitingInfo && (
                <span className="chip border-amber-200 bg-amber-50 text-amber-800">
                  Ek bilgi bekleniyor
                </span>
              )}
              {step.phase === 'skipped' && (
                <span className="text-[11px] text-ink-400">{skipLabel(step.skipReason)}</span>
              )}
            </div>

            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-500">
              {step.assigneeLabel && <span>Sorumlu: {step.assigneeLabel}</span>}
              {step.completedAt ? (
                <span>Tamamlandı: {formatDateTime(step.completedAt)}</span>
              ) : step.startedAt ? (
                <span>Başladı: {formatDateTime(step.startedAt)}</span>
              ) : null}
              {step.phase === 'current' && step.dueAt && <SlaChip status={step.slaStatus} />}
            </div>

            {step.resultComment && (
              <p className="mt-1 rounded bg-ink-50 px-2 py-1 text-[12px] text-ink-700">
                {step.resultComment}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function StepMarker({ step }: { step: ProgressStep }) {
  const base =
    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold';
  if (step.phase === 'past') {
    return (
      <span className={`${base} bg-emerald-600 text-white`} aria-hidden>
        ✓
      </span>
    );
  }
  if (step.phase === 'current') {
    return (
      <span className={`${base} bg-brand-600 text-white`} aria-hidden>
        ●
      </span>
    );
  }
  if (step.phase === 'skipped') {
    return (
      <span className={`${base} border border-ink-200 bg-ink-100 text-ink-400`} aria-hidden>
        –
      </span>
    );
  }
  return (
    <span className={`${base} border border-ink-300 bg-white text-ink-400`} aria-hidden>
      {step.sequence}
    </span>
  );
}

function skipLabel(reason: string | null): string {
  switch (reason) {
    case 'CONDITION_NOT_MET':
      return 'Bu talep için gerekli değil';
    case 'ADMIN_OVERRIDE':
      return 'Sistem yöneticisi tarafından atlandı';
    case 'STEP_INACTIVE':
      return 'Adım pasif';
    case 'FLOW_CLOSED':
    case 'REQUEST_CANCELLED':
      return 'Süreç kapandığı için uygulanmadı';
    default:
      return 'Atlandı';
  }
}

/**
 * Islem gecmisi (activity timeline).
 * Audit kayitlarindan uretilir; normal kullaniciya teknik detay gosterilmez.
 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[12px] text-ink-500">Henüz işlem kaydı yok.</p>
    );
  }

  return (
    <ol className="divide-y divide-ink-100">
      {[...entries].reverse().map((entry) => (
        <li key={entry.id} className="px-4 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-ink-800">
              {entry.label}
              {entry.stepName && (
                <span className="ml-1 font-normal text-ink-500">· {entry.stepName}</span>
              )}
            </span>
            <span className="text-[11px] text-ink-400">{formatDateTime(entry.occurredAt)}</span>
          </div>

          <div className="mt-0.5 text-[11px] text-ink-500">
            {entry.userDisplayName ?? 'Sistem'}
            {entry.userRole && ` (${roleLabel(entry.userRole)})`}
            {entry.oldStatusName && entry.newStatusName && (
              <span>
                {' · '}
                {entry.oldStatusName} → {entry.newStatusName}
              </span>
            )}
          </div>

          {entry.description && (
            <p className="mt-1 text-[12px] whitespace-pre-wrap text-ink-700">
              {entry.description}
            </p>
          )}

          {entry.visibility === 'ADMIN' && (
            <span className="chip mt-1 inline-block border-ink-300 bg-ink-100 text-ink-600">
              Yalnızca yönetici görünümü
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

const ROLE_LABELS: Record<string, string> = {
  EMPLOYEE: 'Çalışan',
  MANAGER: 'Yönetici',
  HR_USER: 'İnsan Kaynakları',
  HR_PROCESS_OWNER: 'İK Süreç Sahibi',
  ADMIN: 'Sistem Yöneticisi',
};

export function roleLabel(code: string): string {
  return ROLE_LABELS[code] ?? code;
}
