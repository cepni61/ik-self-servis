import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// ---------------------------------------------------------------------------
// Durum / SLA gostergeleri
// ---------------------------------------------------------------------------

const TONE_CLASSES: Record<string, string> = {
  neutral: 'border-ink-300 bg-ink-100 text-ink-700',
  info: 'border-brand-200 bg-brand-50 text-brand-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  danger: 'border-red-200 bg-red-50 text-red-700',
};

export function StatusChip({
  name,
  tone = 'neutral',
}: {
  name: string;
  tone?: string;
}) {
  return <span className={`chip ${TONE_CLASSES[tone] ?? TONE_CLASSES.neutral}`}>{name}</span>;
}

const SLA_META: Record<string, { label: string; tone: string }> = {
  NA: { label: 'SLA yok', tone: 'neutral' },
  ON_TRACK: { label: 'Süresinde', tone: 'success' },
  AT_RISK: { label: 'Riskli', tone: 'warning' },
  BREACHED: { label: 'Süre aşıldı', tone: 'danger' },
  MET: { label: 'Süresinde kapandı', tone: 'success' },
  MISSED: { label: 'Gecikmeli kapandı', tone: 'danger' },
};

export function SlaChip({ status, remainingText }: { status: string; remainingText?: string | null }) {
  const meta = SLA_META[status] ?? SLA_META.NA;
  if (status === 'NA') return <span className="text-ink-400">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`chip ${TONE_CLASSES[meta.tone]}`}>{meta.label}</span>
      {remainingText && <span className="text-[11px] text-ink-500">{remainingText}</span>}
    </span>
  );
}

export function PriorityChip({ name, tone }: { name: string; tone: string }) {
  return <span className={`chip ${TONE_CLASSES[tone] ?? TONE_CLASSES.neutral}`}>{name}</span>;
}

// ---------------------------------------------------------------------------
// Tarih bicimlendirme
// ---------------------------------------------------------------------------

const dateTimeFormat = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFormat.format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatHours(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 24) return `${hours} saat`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest > 0 ? `${days} gün ${rest} saat` : `${days} gün`;
}

// ---------------------------------------------------------------------------
// Bildirim (toast)
// ---------------------------------------------------------------------------

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<{
  push: (kind: ToastKind, message: string) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, kind === 'error' ? 8000 : 4000);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-96 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto rounded border px-3 py-2 text-[13px] shadow-sm ${
              toast.kind === 'success'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : toast.kind === 'error'
                  ? 'border-red-300 bg-red-50 text-red-800'
                  : 'border-brand-200 bg-brand-50 text-brand-700'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span>{toast.message}</span>
              <button
                type="button"
                aria-label="Kapat"
                className="text-ink-400 hover:text-ink-700"
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast, ToastProvider içinde kullanılmalıdır.');
  return ctx;
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 'max-w-2xl',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink-900/40 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`w-full ${width} rounded border border-ink-300 bg-white shadow-lg`}>
        <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="text-lg leading-none text-ink-400 hover:text-ink-700"
          >
            ×
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-ink-200 bg-ink-50 px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Kucuk yardimci bilesenler
// ---------------------------------------------------------------------------

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="kv-label">{label}</div>
      <div className="kv-value">{children ?? '—'}</div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-[13px] font-medium text-ink-600">{title}</p>
      {hint && <p className="mt-1 text-[12px] text-ink-500">{hint}</p>}
    </div>
  );
}

export function Spinner({ label = 'Yükleniyor…' }: { label?: string }) {
  return (
    <div className="px-4 py-10 text-center text-[13px] text-ink-500" role="status">
      {label}
    </div>
  );
}

export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-800">
      <div className="flex items-start justify-between gap-3">
        <span>{message}</span>
        {onRetry && (
          <button type="button" className="btn-default btn-xs shrink-0" onClick={onRetry}>
            Yeniden dene
          </button>
        )}
      </div>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between border-t border-ink-200 px-4 py-2.5 text-[12px] text-ink-600">
      <span>
        Toplam <strong className="text-ink-800">{total}</strong> kayıt · Sayfa {page}/{totalPages}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          className="btn-default btn-xs"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        >
          Önceki
        </button>
        <button
          type="button"
          className="btn-default btn-xs"
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        >
          Sonraki
        </button>
      </div>
    </div>
  );
}

/** Ileri ayarlari gizleyen basit acilir bolum (progressive disclosure). */
export function Disclosure({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-ink-200">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] font-medium text-ink-700 hover:bg-ink-50"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="text-ink-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="border-t border-ink-200 px-3 py-3">{children}</div>}
    </div>
  );
}
