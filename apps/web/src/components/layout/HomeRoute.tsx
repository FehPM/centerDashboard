import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from '../../hooks/use-me.js';
import { NoModulesPage } from '../../pages/NoModulesPage.js';
import { RequireModule } from './RequireModule.js';

/** Rota "/": Visão geral se liberada; senão o primeiro módulo visível; senão aviso. */
export function HomeRoute({ overview }: { overview: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return <p role="status" className="text-sm">Carregando…</p>;
  if (me.modules.some((m) => m.key === 'overview')) {
    return <RequireModule moduleKey="overview">{overview}</RequireModule>;
  }
  const first = me.modules.find((m) => m.menuPath !== null && m.menuPath !== '/');
  if (first?.menuPath) return <Navigate to={first.menuPath} replace />;
  return <NoModulesPage />;
}
