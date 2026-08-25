import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { ErrorNotice, Spinner, formatDateTime, useToast } from '../../components/ui';

interface AppSetting {
  key: string;
  value: string;
  valueType: string;
  category: string | null;
  description: string | null;
  updatedAt: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  SLA: 'SLA',
  NOTIFICATION: 'Bildirim',
  SECURITY: 'Güvenlik',
  GENERAL: 'Genel',
};

/**
 * Sistem ayarlari.
 * Bu degerler kod icine gomulmemistir; buradan degistirilebilir.
 * Not: Bu ekran veritabanina serbest erisim SAGLAMAZ; yalnizca beyaz listede
 * olan ayar anahtarlari guncellenebilir (sunucu tarafinda zorlanir).
 */
export function SettingsPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get<AppSetting[]>('/admin/settings'),
  });

  const save = useMutation({
    mutationFn: (input: { key: string; value: string }) =>
      api.patch(`/admin/settings/${encodeURIComponent(input.key)}`, { value: input.value }),
    onSuccess: (_result, input) => {
      toast.push('success', 'Ayar güncellendi.');
      setDrafts((d) => {
        const next = { ...d };
        delete next[input.key];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['admin-settings'] });
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Ayar güncellenemedi.'),
  });

  if (settings.isLoading) return <Spinner />;
  if (settings.isError || !settings.data) {
    return <ErrorNotice message="Ayarlar yüklenemedi." onRetry={() => void settings.refetch()} />;
  }

  const grouped = settings.data.reduce<Record<string, AppSetting[]>>((acc, setting) => {
    const key = setting.category ?? 'GENERAL';
    acc[key] = acc[key] ?? [];
    acc[key].push(setting);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-base font-semibold text-ink-900">Sistem Ayarları</h1>
        <p className="text-[12px] text-ink-500">
          SLA takvimi, bildirim kanalları ve yedek sorumlu gibi değerler koda gömülmemiştir.
        </p>
      </div>

      {Object.entries(grouped).map(([category, items]) => (
        <section key={category} className="card">
          <div className="card-header">
            <h2 className="card-title">{CATEGORY_LABELS[category] ?? category}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Anahtar</th>
                  <th className="w-72">Değer</th>
                  <th>Açıklama</th>
                  <th>Son Güncelleme</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {items.map((setting) => {
                  const draft = drafts[setting.key];
                  const current = draft ?? setting.value;
                  const dirty = draft !== undefined && draft !== setting.value;

                  return (
                    <tr key={setting.key}>
                      <td className="font-mono text-[12px] text-ink-700">{setting.key}</td>
                      <td>
                        {setting.valueType === 'boolean' ? (
                          <select
                            className="input py-1"
                            value={current}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [setting.key]: e.target.value }))
                            }
                            aria-label={setting.key}
                          >
                            <option value="true">Evet</option>
                            <option value="false">Hayır</option>
                          </select>
                        ) : setting.key === 'sla.calendarMode' ? (
                          <select
                            className="input py-1"
                            value={current}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [setting.key]: e.target.value }))
                            }
                            aria-label={setting.key}
                          >
                            <option value="CALENDAR_DAYS">Takvim günü (7/24)</option>
                            <option value="BUSINESS_DAYS">İş günü (mesai, tatil hariç)</option>
                          </select>
                        ) : (
                          <input
                            className={`input py-1 ${
                              setting.valueType === 'json' ? 'font-mono' : ''
                            }`}
                            type={setting.valueType === 'number' ? 'number' : 'text'}
                            value={current}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [setting.key]: e.target.value }))
                            }
                            aria-label={setting.key}
                          />
                        )}
                      </td>
                      <td className="max-w-96 text-[12px] text-ink-600">
                        {setting.description ?? '—'}
                      </td>
                      <td className="whitespace-nowrap text-[12px] text-ink-500">
                        {formatDateTime(setting.updatedAt)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn-primary btn-xs"
                          disabled={!dirty || save.isPending}
                          onClick={() => save.mutate({ key: setting.key, value: current })}
                        >
                          Kaydet
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="card">
        <div className="card-header">
          <h2 className="card-title">İş Kararı Bekleyen Konular</h2>
        </div>
        <ul className="space-y-2 px-4 py-3 text-[13px] text-ink-700">
          <li>
            <strong>SLA takvimi:</strong> Süreler takvim günü olarak hesaplanıyor (varsayılan). İş
            günü/mesai saati hesabı isteniyorsa <code className="font-mono">sla.calendarMode</code>{' '}
            değerini <code className="font-mono">BUSINESS_DAYS</code> yapın ve resmî tatil listesini
            doldurun.
          </li>
          <li>
            <strong>Adım SLA süreleri:</strong> Yönetici onayı 48 saat, İK kontrolü 72 saat olarak
            başlangıç değeri girildi. Gerçek hedefler iş birimi tarafından belirlenmelidir (iş
            akışı sürüm editöründen değiştirilir).
          </li>
          <li>
            <strong>Yedek sorumlu:</strong> Talep edenin yöneticisi tanımsız veya pasifse görev{' '}
            <code className="font-mono">assignee.fallbackRoleCode</code> ayarındaki role düşer.
          </li>
          <li>
            <strong>Kategori–doküman zorunluluğu:</strong> Hangi kategoride hangi belgenin zorunlu
            olduğu tanımlanmadı. Kategori form alanlarına dosya/metin alanı ekleyerek
            yapılandırılabilir.
          </li>
          <li>
            <strong>İK içi görev dağılımı:</strong> Şu anda İK adımları rol/ekip havuzuna düşer.
            Kategori bazlı daraltma için kategori ayarlarındaki “Sorumlu Rol / Sorumlu Ekip”
            alanlarını kullanın.
          </li>
        </ul>
      </section>
    </div>
  );
}
