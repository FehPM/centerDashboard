import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { setOperatorToken, type OperatorView } from '../lib/api-client.js';

const MENU = [
  { to: '/clientes', label: 'Clientes' },
  { to: '/auditoria', label: 'Auditoria' },
  { to: '/operadores', label: 'Operadores' },
];

export function Layout({ operator }: { operator: OperatorView }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  function logout(): void {
    setOperatorToken(null);
    queryClient.clear();
    navigate('/login', { replace: true });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r p-4"
        style={{ backgroundColor: 'var(--surface-1)', borderColor: 'var(--hairline)' }}>
        <p className="mb-4 font-semibold">Center Back-office</p>
        <nav className="space-y-1">
          {MENU.map((item) => (
            <NavLink key={item.to} to={item.to}
              className="block rounded-md px-3 py-2 text-sm"
              style={({ isActive }) => ({
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'var(--hairline)' : 'transparent',
              })}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b px-6 py-3"
          style={{ borderColor: 'var(--hairline)' }}>
          <span className="text-sm">{operator.name}</span>
          <button type="button" onClick={logout} className="rounded-md border px-3 py-1 text-sm"
            style={{ borderColor: 'var(--hairline)' }}>
            Sair
          </button>
        </header>
        <main className="p-6"><Outlet /></main>
      </div>
    </div>
  );
}
