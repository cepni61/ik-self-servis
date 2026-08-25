import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { NotificationItem } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { formatDateTime } from './ui';

interface NavItem {
  to: string;
  label: string;
  /** Bos ise herkese acik. */
  roles?: string[];
}

const MAIN_NAV: NavItem[] = [
  { to: '/taleplerim', label: 'Taleplerim' },
  { to: '/talep/yeni', label: 'Yeni Talep' },
  { to: '/gorevlerim', label: 'Görevlerim', roles: ['MANAGER', 'HR_USER', 'HR_PROCESS_OWNER'] },
  { to: '/raporlar', label: 'Raporlar' },
];

const ADMIN_NAV: NavItem[] = [
  { to: '/yonetim/is-akislari', label: 'İş Akışları' },
  { to: '/yonetim/kategoriler', label: 'Kategoriler' },
  { to: '/yonetim/canli-surecler', label: 'Canlı Süreçler' },
  { to: '/yonetim/ayarlar', label: 'Sistem Ayarları' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.capabilities.isAdmin ?? false;

  const visibleNav = MAIN_NAV.filter(
    (item) => !item.roles || item.roles.some((r) => user?.roles.includes(r)),
  );

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-ink-300 bg-white px-4 py-2">
        <div className="flex items-center gap-6">
          <button
            type="button"
            className="text-left"
            onClick={() => navigate('/taleplerim')}
          >
            <div className="text-[15px] font-semibold text-ink-900">İK Self Servis</div>
            <div className="text-[11px] text-ink-500">İnsan Kaynakları Talep Yönetimi</div>
          </button>

          <nav className="flex items-center gap-1" aria-label="Ana menü">
            {visibleNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `rounded px-3 py-1.5 text-[13px] font-medium ${
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <NotificationBell />
          <div className="hidden border-l border-ink-200 pl-3 text-right sm:block">
            <div className="text-[13px] font-medium text-ink-900">{user?.displayName}</div>
            <div className="text-[11px] text-ink-500">
              {user?.title ?? '—'}
              {user?.department ? ` · ${user.department}` : ''}
            </div>
          </div>
          <button type="button" className="btn-default btn-xs" onClick={logout}>
            Çıkış
          </button>
        </div>
      </header>

      {isAdmin && (
        <div className="flex items-center gap-1 border-b border-ink-200 bg-ink-50 px-4 py-1.5">
          <span className="mr-2 text-[11px] font-semibold tracking-wide text-ink-500 uppercase">
            Yönetim
          </span>
          {ADMIN_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded px-2.5 py-1 text-[12px] font-medium ${
                  isActive
                    ? 'bg-white text-brand-700 ring-1 ring-brand-200'
                    : 'text-ink-600 hover:bg-white hover:text-ink-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      )}

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-4">
        <Outlet />
      </main>

      <footer className="border-t border-ink-200 bg-white px-4 py-2 text-[11px] text-ink-400">
        İK Self Servis · Roller: {user?.roles.join(', ')}
      </footer>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: NotificationItem[]; unreadCount: number }>('/catalog/notifications'),
    refetchInterval: 60_000,
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/catalog/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markRead = useMutation({
    mutationFn: (ids: string[]) => api.post('/catalog/notifications/read', { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        className="btn-default btn-xs"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Bildirimler${unread > 0 ? `, ${unread} okunmamış` : ''}`}
      >
        Bildirimler
        {unread > 0 && (
          <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-hidden
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            tabIndex={-1}
          />
          <div className="absolute right-0 z-20 mt-1 w-96 rounded border border-ink-300 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
              <span className="text-[12px] font-semibold text-ink-700">Bildirimler</span>
              <button
                type="button"
                className="btn-ghost btn-xs"
                disabled={unread === 0 || markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
              >
                Tümünü okundu işaretle
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {(data?.items ?? []).length === 0 && (
                <p className="px-3 py-6 text-center text-[12px] text-ink-500">
                  Bildirim bulunmuyor.
                </p>
              )}
              {(data?.items ?? []).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`block w-full border-b border-ink-100 px-3 py-2 text-left hover:bg-ink-50 ${
                    item.isRead ? '' : 'bg-brand-50/40'
                  }`}
                  onClick={() => {
                    if (!item.isRead) markRead.mutate([item.id]);
                    setOpen(false);
                    if (item.requestId) navigate(`/talep/${item.requestId}`);
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink-900">{item.title}</span>
                    {!item.isRead && (
                      <span className="mt-1 size-1.5 shrink-0 rounded-full bg-brand-500" />
                    )}
                  </div>
                  {item.body && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-600">{item.body}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-ink-400">
                    {formatDateTime(item.createdAt)}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
