import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { Navigate, Route, Routes } from 'react-router-dom';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { RequireAuth } from '../components/layout/RequireAuth.js';
import { RequireAdmin } from '../components/layout/RequireModule.js';
import { UsersPage } from '../pages/UsersPage.js';
import { setAuthToken } from '../lib/api-client.js';
import { MODULES, meHandler } from './helpers-me.js';

function Tree() {
  return (
    <Routes>
      <Route path="/login" element={<p>login</p>} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<p>home</p>} />
        <Route path="/usuarios" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const existing = { id: 'u9', name: 'Bia', email: 'bia@x.com', role: 'MEMBER', active: true, mustChangePassword: false, modules: ['products'] };

beforeEach(() => setAuthToken('t'));
afterEach(() => setAuthToken(null));

async function fillForm() {
  await userEvent.click(await screen.findByRole('button', { name: 'Novo usuário' }));
  await userEvent.type(screen.getByLabelText('Nome'), 'Caio');
  await userEvent.type(screen.getByLabelText('E-mail'), 'caio@x.com');
  await userEvent.type(screen.getByLabelText('Senha provisória'), 'senha-provisoria-1');
}

describe('UsersPage', () => {
  it('creating a member sends the selected modules and shows the temporary-password notice', async () => {
    let body: unknown;
    let patched: unknown;
    mswServer.use(
      meHandler({ modules: [MODULES.overview!, MODULES.products!, MODULES.assistant!] }),
      http.get('/api/users', () => HttpResponse.json([existing])),
      http.post('/api/users', async ({ request }) => { body = await request.json(); return HttpResponse.json({ ...existing, id: 'u10' }, { status: 201 }); }),
      http.patch('/api/users/u9', async ({ request }) => { patched = await request.json(); return HttpResponse.json({ ...existing, active: false }); }),
    );
    renderWithProviders(<Tree />, { route: '/usuarios' });
    expect(await screen.findByText('bia@x.com')).toBeInTheDocument();
    expect(screen.getByText('Produtos')).toBeInTheDocument();
    await fillForm();
    await userEvent.click(screen.getByLabelText('Produtos'));
    await userEvent.click(screen.getByRole('button', { name: 'Criar usuário' }));
    expect(await screen.findByText('Passe a senha provisória ao usuário. Ele vai trocá-la no primeiro acesso.')).toBeInTheDocument();
    expect(body).toEqual({ name: 'Caio', email: 'caio@x.com', role: 'MEMBER', temporaryPassword: 'senha-provisoria-1', modules: ['products'] });

    await userEvent.click(screen.getByRole('button', { name: 'Desativar Bia' }));
    await waitFor(() => expect(patched).toEqual({ active: false }));
  });

  it('hides module checkboxes for ADMIN and sends no modules', async () => {
    let body: { modules?: string[] } = {};
    mswServer.use(
      meHandler(),
      http.get('/api/users', () => HttpResponse.json([])),
      http.post('/api/users', async ({ request }) => { body = (await request.json()) as typeof body; return HttpResponse.json(existing, { status: 201 }); }),
    );
    renderWithProviders(<Tree />, { route: '/usuarios' });
    await fillForm();
    await userEvent.click(screen.getByLabelText('Produtos'));
    await userEvent.selectOptions(screen.getByLabelText('Papel'), 'ADMIN');
    expect(screen.queryByLabelText('Produtos')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Criar usuário' }));
    await waitFor(() => expect(body.modules).toEqual([]));
  });

  it('shows the server message for email_in_use', async () => {
    mswServer.use(
      meHandler(),
      http.get('/api/users', () => HttpResponse.json([])),
      http.post('/api/users', () => HttpResponse.json({ error: 'email_in_use', message: 'e-mail já cadastrado' }, { status: 409 })),
    );
    renderWithProviders(<Tree />, { route: '/usuarios' });
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: 'Criar usuário' }));
    expect(await screen.findByText('e-mail já cadastrado')).toBeInTheDocument();
  });

  it('shows the server message when deactivation fails', async () => {
    mswServer.use(
      meHandler(),
      http.get('/api/users', () => HttpResponse.json([existing])),
      http.patch('/api/users/u9', () => HttpResponse.json({ error: 'last_admin', message: 'não é possível remover o último admin' }, { status: 409 })),
    );
    renderWithProviders(<Tree />, { route: '/usuarios' });
    await userEvent.click(await screen.findByRole('button', { name: 'Desativar Bia' }));
    expect(await screen.findByText('não é possível remover o último admin')).toBeInTheDocument();
  });

  it('MEMBER is redirected away', async () => {
    mswServer.use(meHandler({ role: 'MEMBER' }), http.get('/api/users', () => HttpResponse.json([])));
    renderWithProviders(<Tree />, { route: '/usuarios' });
    expect(await screen.findByText('home')).toBeInTheDocument();
  });

  it('editing a member sends the new module set', async () => {
    let patched: unknown;
    mswServer.use(
      meHandler({ modules: [MODULES.overview!, MODULES.products!, MODULES.assistant!] }),
      http.get('/api/users', () => HttpResponse.json([existing])),
      http.patch('/api/users/u9', async ({ request }) => { patched = await request.json(); return HttpResponse.json(existing); }),
    );
    renderWithProviders(<Tree />, { route: '/usuarios' });
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Bia' }));
    expect(screen.queryByLabelText('Senha provisória')).toBeNull();
    expect(screen.getByLabelText('Produtos')).toBeChecked();
    await userEvent.click(screen.getByLabelText('Produtos'));
    await userEvent.click(screen.getByLabelText('Assistente'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(patched).toEqual({ name: 'Bia', role: 'MEMBER', modules: ['assistant'] }));
  });

  it('editing shows the server message for last_admin', async () => {
    mswServer.use(
      meHandler(),
      http.get('/api/users', () => HttpResponse.json([{ ...existing, role: 'ADMIN', modules: [] }])),
      http.patch('/api/users/u9', () => HttpResponse.json({ error: 'last_admin', message: 'não é possível remover o último admin' }, { status: 409 })),
    );
    renderWithProviders(<Tree />, { route: '/usuarios' });
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Bia' }));
    await userEvent.selectOptions(screen.getByLabelText('Papel'), 'MEMBER');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('não é possível remover o último admin')).toBeInTheDocument();
  });

  it('reset password sends temporaryPassword and shows the notice', async () => {
    let body: unknown;
    mswServer.use(
      meHandler(),
      http.get('/api/users', () => HttpResponse.json([existing])),
      http.post('/api/users/u9/reset-password', async ({ request }) => { body = await request.json(); return new HttpResponse(null, { status: 204 }); }),
    );
    renderWithProviders(<Tree />, { route: '/usuarios' });
    await userEvent.click(await screen.findByRole('button', { name: 'Redefinir senha de Bia' }));
    await userEvent.type(screen.getByLabelText(/Nova senha provisória/), 'outra-provisoria-9');
    await userEvent.click(screen.getByRole('button', { name: 'Redefinir' }));
    expect(await screen.findByText('Passe a senha provisória ao usuário. Ele vai trocá-la no primeiro acesso.')).toBeInTheDocument();
    expect(body).toEqual({ temporaryPassword: 'outra-provisoria-9' });
  });
});
