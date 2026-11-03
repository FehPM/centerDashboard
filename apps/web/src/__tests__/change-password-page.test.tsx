import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Navigate, Route, Routes } from 'react-router-dom';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { RequireAuth } from '../components/layout/RequireAuth.js';
import { RequireModule } from '../components/layout/RequireModule.js';
import { ChangePasswordPage } from '../pages/ChangePasswordPage.js';
import { getAuthToken, setAuthToken, type MeView } from '../lib/api-client.js';

function Tree() {
  return (
    <Routes>
      <Route path="/login" element={<p>login</p>} />
      <Route element={<RequireAuth />}>
        <Route path="/trocar-senha" element={<ChangePasswordPage />} />
        <Route path="/" element={<p>home</p>} />
        <Route path="/produtos" element={<RequireModule moduleKey="products"><p>produtos</p></RequireModule>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function me(mustChangePassword: boolean): MeView {
  return {
    user: { id: 'u1', name: 'Ana', email: 'a@x.com', role: 'MEMBER', mustChangePassword },
    organization: { id: 'o1', name: 'Loja' },
    modules: [{ key: 'products', label: 'Produtos', menuPath: '/produtos', state: 'ready' }],
    sources: ['commerce'], viewSession: false,
  };
}

async function fill(current: string, next: string, confirm: string) {
  await userEvent.type(await screen.findByLabelText('Senha atual'), current);
  await userEvent.type(screen.getByLabelText('Nova senha'), next);
  await userEvent.type(screen.getByLabelText('Confirmar nova senha'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
}

beforeEach(() => setAuthToken('t'));
afterEach(() => setAuthToken(null));

describe('ChangePasswordPage', () => {
  it('requires 12+ chars and matching confirmation before submitting', async () => {
    const post = jest.fn();
    mswServer.use(
      http.get('/auth/me', () => HttpResponse.json(me(true))),
      http.post('/auth/password', () => { post(); return new HttpResponse(null, { status: 204 }); }),
    );
    renderWithProviders(<Tree />, { route: '/trocar-senha' });
    await fill('antiga', 'curta', 'curta');
    expect(await screen.findByText('A nova senha precisa ter no mínimo 12 caracteres.')).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Nova senha'));
    await userEvent.clear(screen.getByLabelText('Confirmar nova senha'));
    await userEvent.type(screen.getByLabelText('Nova senha'), 'senha-nova-longa');
    await userEvent.type(screen.getByLabelText('Confirmar nova senha'), 'outra-senha-longa');
    await userEvent.click(screen.getByRole('button', { name: 'Trocar senha' }));
    expect(await screen.findByText('A confirmação precisa ser igual à nova senha.')).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('success navigates home', async () => {
    let changed = false;
    mswServer.use(
      http.get('/auth/me', () => HttpResponse.json(me(!changed))),
      http.post('/auth/password', () => { changed = true; return new HttpResponse(null, { status: 204 }); }),
    );
    renderWithProviders(<Tree />, { route: '/trocar-senha' });
    await fill('antiga', 'senha-nova-longa', 'senha-nova-longa');
    expect(await screen.findByText('home')).toBeInTheDocument();
  });

  it('wrong current password shows the message and keeps the session', async () => {
    mswServer.use(
      http.get('/auth/me', () => HttpResponse.json(me(true))),
      http.post('/auth/password', () => HttpResponse.json({ error: 'unauthorized', message: 'senha atual incorreta' }, { status: 401 })),
    );
    renderWithProviders(<Tree />, { route: '/trocar-senha' });
    await fill('errada', 'senha-nova-longa', 'senha-nova-longa');
    expect(await screen.findByText('senha atual incorreta')).toBeInTheDocument();
    expect(getAuthToken()).toBe('t');
  });

  it('mustChangePassword user is redirected to /trocar-senha from /produtos', async () => {
    mswServer.use(http.get('/auth/me', () => HttpResponse.json(me(true))));
    renderWithProviders(<Tree />, { route: '/produtos' });
    expect(await screen.findByRole('heading', { name: 'Trocar senha' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('produtos')).toBeNull());
  });

  it('forced password page offers Sair and logs out', async () => {
    mswServer.use(http.get('/auth/me', () => HttpResponse.json(me(true))));
    renderWithProviders(<Tree />, { route: '/trocar-senha' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }));
    expect(await screen.findByText('login')).toBeInTheDocument();
    expect(getAuthToken()).toBeNull();
  });
});
