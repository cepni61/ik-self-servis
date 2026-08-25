import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from '../api/client';
import type { CurrentUser } from '../api/types';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  devLogin: (userId: string) => Promise<void>;
  logout: () => void;
  hasRole: (...roles: string[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      // Roller her zaman sunucudan okunur; istemci tarafinda saklanmaz.
      setUser(await api.get<CurrentUser>('/auth/me'));
    } catch {
      setToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    void loadProfile();
  }, [loadProfile]);

  const login = useCallback(
    async (username: string, password: string) => {
      const res = await api.post<{ token: string }>('/auth/login', { username, password });
      setToken(res.token);
      setLoading(true);
      await loadProfile();
    },
    [loadProfile],
  );

  const devLogin = useCallback(
    async (userId: string) => {
      const res = await api.post<{ token: string }>('/auth/dev-login', { userId });
      setToken(res.token);
      setLoading(true);
      await loadProfile();
    },
    [loadProfile],
  );

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const hasRole = useCallback(
    (...roles: string[]) => roles.some((role) => user?.roles.includes(role)),
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, devLogin, logout, hasRole }),
    [user, loading, login, devLogin, logout, hasRole],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth, AuthProvider içinde kullanılmalıdır.');
  return ctx;
}
