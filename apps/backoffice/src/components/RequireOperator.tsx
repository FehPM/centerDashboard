import { Navigate, useLocation } from 'react-router-dom';
import { getOperatorToken } from '../lib/api-client.js';
import { useOperator } from '../hooks/use-operator.js';
import { Layout } from './Layout.js';

export function RequireOperator() {
  const location = useLocation();
  const { data: operator, error, refetch } = useOperator();

  // Lê o storage direto: o cliente de API remove o token em qualquer 401, então
  // uma sessão expirada derruba o guard sem estado global.
  if (getOperatorToken() === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (error) {
    return (
      <div role="alert" className="mx-auto max-w-md p-6 text-center">
        <p className="text-sm">Não foi possível carregar sua sessão.</p>
        <button type="button" onClick={() => { void refetch(); }}
          className="mt-4 rounded-md border px-3 py-1 text-sm">
          Tentar novamente
        </button>
      </div>
    );
  }
  if (!operator) return <p className="p-6 text-sm">Carregando…</p>;
  return <Layout operator={operator} />;
}
