import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage.js';
import { OrganizationsPage } from './pages/OrganizationsPage.js';
import { OrganizationDetailPage } from './pages/OrganizationDetailPage.js';
import { RequireOperator } from './components/RequireOperator.js';

// Placeholder até as Task 20 trazer as telas reais.
function Soon({ title }: { title: string }) {
  return <h1 className="text-xl font-semibold">{title}</h1>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireOperator />}>
        <Route path="/clientes" element={<OrganizationsPage />} />
        <Route path="/clientes/:id" element={<OrganizationDetailPage />} />
        <Route path="/auditoria" element={<Soon title="Auditoria" />} />
        <Route path="/operadores" element={<Soon title="Operadores" />} />
      </Route>
      <Route path="*" element={<Navigate to="/clientes" replace />} />
    </Routes>
  );
}
