import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './pages/LoginPage';
import { MyRequestsPage } from './pages/MyRequestsPage';
import { NewRequestPage } from './pages/NewRequestPage';
import { RequestDetailPage } from './pages/RequestDetailPage';
import { EditDraftPage } from './pages/EditDraftPage';
import { TasksPage } from './pages/TasksPage';
import { ReportsPage } from './pages/ReportsPage';
import { WorkflowListPage } from './pages/admin/WorkflowListPage';
import { WorkflowEditorPage } from './pages/admin/WorkflowEditorPage';
import { WorkflowVersionsPage } from './pages/admin/WorkflowVersionsPage';
import { CategoryListPage } from './pages/admin/CategoryListPage';
import { CategoryDetailPage } from './pages/admin/CategoryDetailPage';
import { LiveOpsListPage } from './pages/admin/LiveOpsListPage';
import { LiveOpsDetailPage } from './pages/admin/LiveOpsDetailPage';
import { SettingsPage } from './pages/admin/SettingsPage';

/**
 * Rota bazli yetki kontrolu YALNIZCA gorunum kolayligi icindir.
 * Gercek yetki kontrolu sunucudadir; bu kontrol atlatilsa bile API reddeder.
 */
function RequireAdmin({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user?.capabilities.isAdmin) {
    return (
      <div className="card px-4 py-8 text-center">
        <p className="text-[13px] font-medium text-ink-700">Bu ekrana erişim yetkiniz yok.</p>
        <p className="mt-1 text-[12px] text-ink-500">
          Yönetim ekranları yalnızca sistem yöneticileri tarafından kullanılabilir.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Oturum kontrol ediliyor…" />
      </div>
    );
  }

  if (!user) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/taleplerim" replace />} />
        <Route path="/taleplerim" element={<MyRequestsPage />} />
        <Route path="/talep/yeni" element={<NewRequestPage />} />
        <Route path="/talep/:id" element={<RequestDetailPage />} />
        <Route path="/talep/:id/duzenle" element={<EditDraftPage />} />
        <Route path="/gorevlerim" element={<TasksPage />} />
        <Route path="/raporlar" element={<ReportsPage />} />

        {/* Yonetim */}
        <Route
          path="/yonetim/is-akislari"
          element={
            <RequireAdmin>
              <WorkflowListPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/yonetim/is-akislari/:definitionId/surumler"
          element={
            <RequireAdmin>
              <WorkflowVersionsPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/yonetim/is-akisi-surum/:versionId"
          element={
            <RequireAdmin>
              <WorkflowEditorPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/yonetim/kategoriler"
          element={
            <RequireAdmin>
              <CategoryListPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/yonetim/kategoriler/:categoryId"
          element={
            <RequireAdmin>
              <CategoryDetailPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/yonetim/canli-surecler"
          element={
            <RequireAdmin>
              <LiveOpsListPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/yonetim/canli-surecler/:requestId"
          element={
            <RequireAdmin>
              <LiveOpsDetailPage />
            </RequireAdmin>
          }
        />
        <Route
          path="/yonetim/ayarlar"
          element={
            <RequireAdmin>
              <SettingsPage />
            </RequireAdmin>
          }
        />

        <Route path="*" element={<Navigate to="/taleplerim" replace />} />
      </Route>
    </Routes>
  );
}
