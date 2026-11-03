import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from '../../hooks/use-me.js';
import { AwaitingSetup } from './AwaitingSetup.js';

/** Barra a rota se o módulo não está em vigor; o filho (e suas consultas) só monta quando pronto. */
export function RequireModule({ moduleKey, children }: { moduleKey: string; children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return <p role="status" className="text-sm">Carregando…</p>;
  const mod = me.modules.find((m) => m.key === moduleKey);
  if (!mod) return <Navigate to="/" replace />;
  if (mod.state === 'awaiting_setup') return <AwaitingSetup label={mod.label} />;
  return <>{children}</>;
}

/** Configurações e Usuários: só Admin, nunca em visualização da Blan. */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  if (!me) return <p role="status" className="text-sm">Carregando…</p>;
  if (me.user.role !== 'ADMIN' || me.viewSession) return <Navigate to="/" replace />;
  return <>{children}</>;
}
