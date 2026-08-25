import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ErrorNotice } from '../components/ui';
import { roleLabel } from '../components/WorkflowProgress';

interface DevUser {
  id: string;
  displayName: string;
  username: string;
  department: string | null;
  title: string | null;
  managerName: string | null;
  roles: string[];
}

export function LoginPage() {
  const { login, devLogin } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Yalnizca gelistirme ortaminda doner (sunucu kararı).
  const devUsers = useQuery({
    queryKey: ['dev-users'],
    queryFn: () => api.get<{ enabled: boolean; users: DevUser[] }>('/auth/dev-users'),
    retry: false,
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Giriş yapılamadı.');
    } finally {
      setBusy(false);
    }
  };

  const pickDevUser = async (userId: string) => {
    setError(null);
    setBusy(true);
    try {
      await devLogin(userId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Giriş yapılamadı.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-ink-100 px-4 py-12">
      <div className="w-full max-w-4xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-ink-900">İK Self Servis</h1>
          <p className="mt-1 text-[13px] text-ink-600">
            İnsan Kaynakları taleplerinizi oluşturun, takip edin ve sonuçlandırın.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Giriş</h2>
            </div>
            <form className="space-y-3 px-4 py-4" onSubmit={submit}>
              <div>
                <label className="label" htmlFor="username">
                  Kullanıcı adı veya e-posta
                </label>
                <input
                  id="username"
                  className="input"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Şifre
                </label>
                <input
                  id="password"
                  type="password"
                  className="input"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && <ErrorNotice message={error} />}

              <button type="submit" className="btn-primary w-full" disabled={busy}>
                {busy ? 'Giriş yapılıyor…' : 'Giriş yap'}
              </button>

              <p className="hint">
                Kurumsal ortamda giriş, kurum kimlik sağlayıcısı (Entra ID) üzerinden yapılacaktır.
              </p>
            </form>
          </section>

          {devUsers.data?.enabled && (
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Geliştirme — hızlı kullanıcı seçimi</h2>
                <span className="text-[11px] text-ink-500">
                  Yalnızca yerel geliştirme ortamında görünür
                </span>
              </div>
              <div className="max-h-[460px] overflow-y-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Ad Soyad</th>
                      <th>Ünvan / Departman</th>
                      <th>Birinci Yönetici</th>
                      <th>Roller</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {devUsers.data.users.map((user) => (
                      <tr key={user.id}>
                        <td className="font-medium text-ink-900">{user.displayName}</td>
                        <td className="text-ink-600">
                          {user.title ?? '—'}
                          {user.department && (
                            <span className="block text-[11px] text-ink-400">
                              {user.department}
                            </span>
                          )}
                        </td>
                        <td className="text-ink-600">{user.managerName ?? '—'}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {user.roles.map((role) => (
                              <span
                                key={role}
                                className="chip border-ink-200 bg-ink-50 text-ink-600"
                              >
                                {roleLabel(role)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="text-right">
                          <button
                            type="button"
                            className="btn-default btn-xs"
                            disabled={busy}
                            onClick={() => void pickDevUser(user.id)}
                          >
                            Bu kullanıcı ile gir
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
