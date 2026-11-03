import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell.js';
import { RequireModule, RequireAdmin } from './components/layout/RequireModule.js';
import { ViewSessionPage } from './pages/ViewSessionPage.js';
import { HomeRoute } from './components/layout/HomeRoute.js';
import { RequireAuth } from './components/layout/RequireAuth.js';
import { LoginPage } from './pages/LoginPage.js';
import { OverviewPage } from './pages/OverviewPage.js';
import { ProductsPage } from './pages/ProductsPage.js';
import { AcquisitionPage } from './pages/AcquisitionPage.js';
import { AppUsagePage } from './pages/AppUsagePage.js';
import { AppQualityPage } from './pages/AppQualityPage.js';
import { SprintPage } from './pages/SprintPage.js';
import { UsersPage } from './pages/UsersPage.js';
import { ChangePasswordPage } from './pages/ChangePasswordPage.js';
import { SettingsPage } from './pages/SettingsPage.js';

/** "Hoje" desce como prop a partir daqui: nenhum componente chama `new Date()`. */
export function App() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/view-session" element={<ViewSessionPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/trocar-senha" element={<ChangePasswordPage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<HomeRoute overview={<OverviewPage today={today} />} />} />
          <Route path="/produtos" element={<RequireModule moduleKey="products"><ProductsPage today={today} /></RequireModule>} />
          <Route path="/aquisicao" element={<RequireModule moduleKey="acquisition"><AcquisitionPage today={today} /></RequireModule>} />
          <Route path="/uso-do-app" element={<RequireModule moduleKey="app_usage"><AppUsagePage today={today} /></RequireModule>} />
          <Route path="/qualidade" element={<RequireModule moduleKey="quality"><AppQualityPage today={today} /></RequireModule>} />
          <Route path="/sprint" element={<RequireModule moduleKey="sprint"><SprintPage today={today} /></RequireModule>} />
          <Route path="/usuarios" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
          <Route path="/configuracoes" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
