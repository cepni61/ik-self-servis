import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, downloadReport, toQuery } from '../api/client';
import type { CategoryListItem, ReportSummary, StatusInfo } from '../api/types';
import {
  ErrorNotice,
  Spinner,
  StatusChip,
  formatHours,
  useToast,
} from '../components/ui';

interface Filters {
  categoryId: string;
  statusCode: string;
  slaStatus: string;
  scope: 'open' | 'closed' | 'all';
  createdFrom: string;
  createdTo: string;
}

const EMPTY: Filters = {
  categoryId: '',
  statusCode: '',
  slaStatus: '',
  scope: 'all',
  createdFrom: '',
  createdTo: '',
};

const SLA_OPTIONS = [
  { value: 'ON_TRACK', label: 'Süresinde' },
  { value: 'AT_RISK', label: 'Riskli' },
  { value: 'BREACHED', label: 'Süresi aşıldı' },
  { value: 'MET', label: 'Süresinde kapandı' },
  { value: 'MISSED', label: 'Gecikmeli kapandı' },
];

export function ReportsPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const toast = useToast();

  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () =>
      api.get<{ categories: CategoryListItem[]; statuses: StatusInfo[] }>('/catalog/bootstrap'),
    staleTime: 5 * 60_000,
  });

  const query = toQuery({
    categoryId: filters.categoryId,
    statusCode: filters.statusCode,
    slaStatus: filters.slaStatus,
    scope: filters.scope === 'all' ? undefined : filters.scope,
    createdFrom: filters.createdFrom,
    createdTo: filters.createdTo,
  });

  const report = useQuery({
    queryKey: ['report', query],
    queryFn: () => api.get<ReportSummary>(`/catalog/reports/summary?${query}`),
  });

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold text-ink-900">Raporlar</h1>
          <p className="text-[12px] text-ink-500">
            Metrikler yalnızca görüntüleme yetkiniz olan kayıtları kapsar.
          </p>
        </div>
        <button
          type="button"
          className="btn-default"
          onClick={() =>
            void downloadReport(query).catch(() =>
              toast.push('error', 'Rapor indirilemedi.'),
            )
          }
        >
          Excel (CSV) İndir
        </button>
      </div>

      <section className="card">
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <div className="w-56">
            <label className="label" htmlFor="r-category">
              Kategori
            </label>
            <select
              id="r-category"
              className="input"
              value={filters.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
            >
              <option value="">Tümü</option>
              {(bootstrap.data?.categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-52">
            <label className="label" htmlFor="r-status">
              Durum
            </label>
            <select
              id="r-status"
              className="input"
              value={filters.statusCode}
              onChange={(e) => set('statusCode', e.target.value)}
            >
              <option value="">Tümü</option>
              {(bootstrap.data?.statuses ?? []).map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-48">
            <label className="label" htmlFor="r-sla">
              SLA Durumu
            </label>
            <select
              id="r-sla"
              className="input"
              value={filters.slaStatus}
              onChange={(e) => set('slaStatus', e.target.value)}
            >
              <option value="">Tümü</option>
              {SLA_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-36">
            <label className="label" htmlFor="r-scope">
              Kapsam
            </label>
            <select
              id="r-scope"
              className="input"
              value={filters.scope}
              onChange={(e) => set('scope', e.target.value as Filters['scope'])}
            >
              <option value="all">Tümü</option>
              <option value="open">Açık</option>
              <option value="closed">Kapanmış</option>
            </select>
          </div>
          <div className="w-40">
            <label className="label" htmlFor="r-from">
              Oluşturma (başlangıç)
            </label>
            <input
              id="r-from"
              type="date"
              className="input"
              value={filters.createdFrom}
              onChange={(e) => set('createdFrom', e.target.value)}
            />
          </div>
          <div className="w-40">
            <label className="label" htmlFor="r-to">
              Oluşturma (bitiş)
            </label>
            <input
              id="r-to"
              type="date"
              className="input"
              value={filters.createdTo}
              onChange={(e) => set('createdTo', e.target.value)}
            />
          </div>
          <button type="button" className="btn-default" onClick={() => setFilters(EMPTY)}>
            Temizle
          </button>
        </div>
      </section>

      {report.isLoading && <Spinner />}
      {report.isError && (
        <ErrorNotice message="Rapor yüklenemedi." onRetry={() => void report.refetch()} />
      )}

      {report.data && (
        <>
          <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Toplam Talep" value={report.data.totals.total} />
            <Metric label="Açık" value={report.data.totals.open} />
            <Metric label="Tamamlanan" value={report.data.totals.completed} />
            <Metric label="Reddedilen" value={report.data.totals.rejected} />
            <Metric label="İptal" value={report.data.totals.cancelled} />
            <Metric label="Taslak" value={report.data.totals.draft} />
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Süre Metrikleri</h2>
              </div>
              <div className="grid gap-4 px-4 py-3 sm:grid-cols-2">
                <div>
                  <div className="kv-label">Ortalama İlk Yanıt Süresi</div>
                  <div className="mt-0.5 text-lg font-semibold text-ink-900">
                    {formatHours(report.data.durations.averageFirstResponseHours)}
                  </div>
                  <p className="hint">
                    {report.data.durations.sampleSizeFirstResponse} kayıt üzerinden
                  </p>
                </div>
                <div>
                  <div className="kv-label">Ortalama Tamamlanma Süresi</div>
                  <div className="mt-0.5 text-lg font-semibold text-ink-900">
                    {formatHours(report.data.durations.averageCompletionHours)}
                  </div>
                  <p className="hint">
                    {report.data.durations.sampleSizeCompletion} kayıt üzerinden
                  </p>
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2 className="card-title">SLA Uyumu</h2>
              </div>
              <div className="grid gap-4 px-4 py-3 sm:grid-cols-2">
                <div>
                  <div className="kv-label">Süresinde Kapanma Oranı</div>
                  <div className="mt-0.5 text-lg font-semibold text-ink-900">
                    {report.data.sla.compliancePercent === null
                      ? '—'
                      : `${report.data.sla.compliancePercent}%`}
                  </div>
                  <p className="hint">
                    {report.data.sla.met} süresinde · {report.data.sla.missed} gecikmeli
                  </p>
                </div>
                <div className="space-y-1 text-[13px]">
                  <Row label="Açık ve süresi aşılmış" value={report.data.sla.breachedOpen} />
                  <Row label="Açık ve riskli" value={report.data.sla.atRiskOpen} />
                  <Row label="SLA tanımsız" value={report.data.sla.notApplicable} />
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Kategori Bazında</h2>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Kategori</th>
                    <th className="text-right">Toplam</th>
                    <th className="text-right">Açık</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.byCategory.map((row) => (
                    <tr key={row.id}>
                      <td className="text-ink-800">{row.name}</td>
                      <td className="text-right font-medium text-ink-900">{row.count}</td>
                      <td className="text-right text-ink-600">{row.openCount}</td>
                    </tr>
                  ))}
                  {report.data.byCategory.length === 0 && (
                    <tr>
                      <td colSpan={3} className="text-center text-ink-500">
                        Kayıt yok
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Durum Bazında</h2>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Durum</th>
                    <th className="text-right">Adet</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.byStatus.map((row) => (
                    <tr key={row.code}>
                      <td>
                        <StatusChip name={row.name} tone={row.tone} />
                      </td>
                      <td className="text-right font-medium text-ink-900">{row.count}</td>
                    </tr>
                  ))}
                  {report.data.byStatus.length === 0 && (
                    <tr>
                      <td colSpan={2} className="text-center text-ink-500">
                        Kayıt yok
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>

          {report.data.byDepartment.length > 0 && (
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Departman Bazında</h2>
              </div>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Departman</th>
                    <th className="text-right">Adet</th>
                  </tr>
                </thead>
                <tbody>
                  {report.data.byDepartment.map((row) => (
                    <tr key={row.department}>
                      <td className="text-ink-800">{row.department}</td>
                      <td className="text-right font-medium text-ink-900">{row.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="card px-4 py-3">
      <div className="kv-label">{label}</div>
      <div className="mt-0.5 text-xl font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-ink-600">{label}</span>
      <span className="font-medium text-ink-900">{value}</span>
    </div>
  );
}
