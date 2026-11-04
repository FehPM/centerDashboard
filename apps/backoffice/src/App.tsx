import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage.js';
import { OrganizationsPage } from './pages/OrganizationsPage.js';
import { OrganizationDetailPage } from './pages/OrganizationDetailPage.js';
import { AuditPage } from './pages/AuditPage.js';
import { OperatorsPage } from './pages/OperatorsPage.js';
import { RequireOperator } from './components/RequireOperator.js';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireOperator />}>
        <Route path="/clientes" element={<OrganizationsPage />} />
        <Route path="/clientes/:id" element={<OrganizationDetailPage />} />
        <Route path="/auditoria" element={<AuditPage />} />
        <Route path="/operadores" element={<OperatorsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/clientes" replace />} />
    </Routes>
  );
}
