import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { AdminMeta, NotificationRuleConfig } from '../../api/types';
import { useToast } from '../../components/ui';

const EVENT_LABELS: Record<string, string> = {
  REQUEST_SUBMITTED: 'Talep gönderildi',
  STEP_STARTED: 'Adım başladı',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  ROUTED_TO_HR: 'İK’ya yönlendirildi',
  INFO_REQUESTED: 'Ek bilgi istendi',
  COMPLETED: 'Tamamlandı',
  CANCELLED: 'İptal edildi',
  SLA_WARNING: 'SLA yaklaşıyor',
  SLA_BREACH: 'SLA aşıldı',
  ADMIN_OVERRIDE: 'Yönetici müdahalesi',
  COMMENT_ADDED: 'Yorum eklendi',
};

const RECIPIENT_LABELS: Record<string, string> = {
  REQUESTER: 'Talep eden',
  CURRENT_ASSIGNEE: 'Adımın mevcut sorumlusu',
  REQUESTER_MANAGER: 'Talep edenin yöneticisi',
  ROLE: 'Belirli rol',
  GROUP: 'Belirli ekip',
};

interface DraftRule {
  event: string;
  recipientType: string;
  recipientRoleCode: string;
  recipientGroupId: string;
  channel: string;
  isActive: boolean;
}

/** Hangi olayda hangi rolun bilgilendirilecegini yonetir. */
export function NotificationRulesEditor({
  versionId,
  rowVersion,
  rules,
  meta,
  roles,
  groups,
  editable,
  onSaved,
}: {
  versionId: string;
  rowVersion: number;
  rules: NotificationRuleConfig[];
  meta: AdminMeta;
  roles: Array<{ code: string; name: string }>;
  groups: Array<{ id: string; name: string }>;
  editable: boolean;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<DraftRule[]>([]);

  useEffect(() => {
    setDraft(
      rules.map((r) => ({
        event: r.event,
        recipientType: r.recipientType,
        recipientRoleCode: r.recipientRoleCode ?? '',
        recipientGroupId: r.recipientGroupId ?? '',
        channel: r.channel,
        isActive: r.isActive,
      })),
    );
  }, [rules]);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/admin/workflow-versions/${versionId}/notification-rules`, {
        rules: draft.map((r) => ({
          event: r.event,
          recipientType: r.recipientType,
          recipientRoleCode: r.recipientType === 'ROLE' ? r.recipientRoleCode : null,
          recipientGroupId: r.recipientType === 'GROUP' ? r.recipientGroupId : null,
          channel: r.channel,
          isActive: r.isActive,
        })),
        expectedRowVersion: rowVersion,
      }),
    onSuccess: () => {
      toast.push('success', 'Bildirim kuralları kaydedildi.');
      onSaved();
    },
    onError: (err) =>
      toast.push('error', err instanceof ApiError ? err.message : 'Kaydedilemedi.'),
  });

  const patch = (index: number, changes: Partial<DraftRule>) =>
    setDraft((prev) => prev.map((r, i) => (i === index ? { ...r, ...changes } : r)));

  const dirty = JSON.stringify(draft) !== JSON.stringify(
    rules.map((r) => ({
      event: r.event,
      recipientType: r.recipientType,
      recipientRoleCode: r.recipientRoleCode ?? '',
      recipientGroupId: r.recipientGroupId ?? '',
      channel: r.channel,
      isActive: r.isActive,
    })),
  );

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Olay</th>
              <th>Bilgilendirilecek</th>
              <th>Kanal</th>
              <th>Aktif</th>
              {editable && <th className="w-20" />}
            </tr>
          </thead>
          <tbody>
            {draft.map((rule, index) => (
              <tr key={`${rule.event}-${index}`}>
                <td>
                  <select
                    className="input py-1"
                    disabled={!editable}
                    value={rule.event}
                    onChange={(e) => patch(index, { event: e.target.value })}
                    aria-label="Olay"
                  >
                    {meta.notificationEvents.map((ev) => (
                      <option key={ev} value={ev}>
                        {EVENT_LABELS[ev] ?? ev}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="flex gap-1">
                    <select
                      className="input py-1"
                      disabled={!editable}
                      value={rule.recipientType}
                      onChange={(e) => patch(index, { recipientType: e.target.value })}
                      aria-label="Alıcı"
                    >
                      {meta.notificationRecipientTypes.map((rt) => (
                        <option key={rt} value={rt}>
                          {RECIPIENT_LABELS[rt] ?? rt}
                        </option>
                      ))}
                    </select>
                    {rule.recipientType === 'ROLE' && (
                      <select
                        className="input py-1"
                        disabled={!editable}
                        value={rule.recipientRoleCode}
                        onChange={(e) => patch(index, { recipientRoleCode: e.target.value })}
                        aria-label="Rol"
                      >
                        <option value="">Rol seçin…</option>
                        {roles.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {rule.recipientType === 'GROUP' && (
                      <select
                        className="input py-1"
                        disabled={!editable}
                        value={rule.recipientGroupId}
                        onChange={(e) => patch(index, { recipientGroupId: e.target.value })}
                        aria-label="Ekip"
                      >
                        <option value="">Ekip seçin…</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </td>
                <td>
                  <select
                    className="input py-1"
                    disabled={!editable}
                    value={rule.channel}
                    onChange={(e) => patch(index, { channel: e.target.value })}
                    aria-label="Kanal"
                  >
                    <option value="IN_APP">Uygulama içi</option>
                    <option value="EMAIL">E-posta</option>
                    <option value="TEAMS">Teams</option>
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    className="size-4 rounded border-ink-300"
                    disabled={!editable}
                    checked={rule.isActive}
                    onChange={(e) => patch(index, { isActive: e.target.checked })}
                    aria-label="Aktif"
                  />
                </td>
                {editable && (
                  <td>
                    <button
                      type="button"
                      className="btn-ghost btn-xs text-red-600"
                      onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
                    >
                      Sil
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {draft.length === 0 && (
              <tr>
                <td colSpan={editable ? 5 : 4} className="py-4 text-center text-ink-500">
                  Bildirim kuralı tanımlanmadı — bu sürümde bildirim gönderilmez.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-ink-500">
        E-posta ve Teams kanalları için gönderici entegrasyonu bağlanana kadar bu kanallardaki
        kurallar atlanır (Sistem Ayarları → etkin bildirim kanalları).
      </p>

      {editable && (
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-default btn-xs"
            onClick={() =>
              setDraft((prev) => [
                ...prev,
                {
                  event: 'STEP_STARTED',
                  recipientType: 'CURRENT_ASSIGNEE',
                  recipientRoleCode: '',
                  recipientGroupId: '',
                  channel: 'IN_APP',
                  isActive: true,
                },
              ])
            }
          >
            + Kural Ekle
          </button>
          <button
            type="button"
            className="btn-primary btn-xs"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Kaydediliyor…' : 'Kuralları Kaydet'}
          </button>
        </div>
      )}
    </div>
  );
}
