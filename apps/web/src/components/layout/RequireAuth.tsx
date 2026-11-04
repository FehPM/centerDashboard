import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { getAuthToken } from '../../lib/api-client.js';
import { useAuth } from '../../hooks/use-auth.js';
import { useMe } from '../../hooks/use-me.js';

export function RequireAuth() {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { data: me, error, refetch } = useMe();

  // Lemos o token direto do storage: o cliente de API o remove em qualquer 401,
  // então uma sessão expirada derruba o guard sem precisar de estado global.
  if (getAuthToken() === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (error) {
    const suspended = error.status === 403 && error.code === 'organization_suspended';
    return (
      <div role="alert" className="mx-auto max-w-md p-6 text-center">
        <p className="text-sm">
          {suspended
            ? 'O acesso desta conta está suspenso. Fale com a Blan.'
            : 'Não foi possível carregar sua sessão.'}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {!suspended && (
            <button
              type="button"
              onClick={() => { void refetch(); }}
              className="rounded-md border px-3 py-1.5 text-sm"
            >
              Tentar novamente
            </button>
          )}
          <button
            type="button"
            onClick={() => { logout(); navigate('/login', { replace: true }); }}
            className="rounded-md border px-3 py-1.5 text-sm"
          >
            Sair
          </button>
        </div>
      </div>
    );
  }
  if (!me) return <p role="status" className="p-6 text-sm">Carregando…</p>;
  if (me.user.mustChangePassword && location.pathname !== '/trocar-senha') {
    return <Navigate to="/trocar-senha" replace />;
  }
  return <Outlet />;
}
