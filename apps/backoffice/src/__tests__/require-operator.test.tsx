import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { RequireOperator } from '../components/RequireOperator.js';

function renderGuarded() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<p>Tela de login</p>} />
      <Route element={<RequireOperator />}>
        <Route path="/clientes" element={<p>Tela de clientes</p>} />
      </Route>
    </Routes>,
    { route: '/clientes' },
  );
}

describe('RequireOperator', () => {
  beforeEach(() => localStorage.clear());

  it('redirects to /login without token', async () => {
    renderGuarded();
    expect(await screen.findByText('Tela de login')).toBeInTheDocument();
  });

  it('me unwraps the operator from the API response', async () => {
    localStorage.setItem('center.operator.token', 'session');
    mswServer.use(
      http.get('*/internal/auth/me', () => HttpResponse.json({ operator: { id: 'o1', name: 'Ana Operadora', email: 'a@blan.com' } })),
    );
    renderGuarded();
    expect(await screen.findByText('Ana Operadora')).toBeInTheDocument();
    expect(screen.getByText('Tela de clientes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Auditoria' })).toBeInTheDocument();
  });

  it('clears the token and redirects when /me answers 401', async () => {
    localStorage.setItem('center.operator.token', 'expired');
    mswServer.use(
      http.get('*/internal/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })),
    );
    renderGuarded();
    expect(await screen.findByText('Tela de login')).toBeInTheDocument();
    expect(localStorage.getItem('center.operator.token')).toBeNull();
  });

  it('logout clears the token and goes to /login', async () => {
    localStorage.setItem('center.operator.token', 'session');
    mswServer.use(
      http.get('*/internal/auth/me', () => HttpResponse.json({ operator: { id: 'o1', name: 'Ana', email: 'a@blan.com' } })),
    );
    renderGuarded();
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    expect(await screen.findByText('Tela de login')).toBeInTheDocument();
    expect(localStorage.getItem('center.operator.token')).toBeNull();
  });
});
