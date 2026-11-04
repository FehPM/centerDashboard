import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { UsersTab } from '../components/UsersTab.js';

// Formato real (userSelect em apps/api/src/internal/users.ts).
const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', name: 'Ana Admin', email: 'ana@loja.com', role: 'ADMIN', active: true, mustChangePassword: false, ...over,
});

describe('UsersTab', () => {
  beforeEach(() => localStorage.setItem('center.operator.token', 't'));

  it('creating an admin posts name, email and temporaryPassword', async () => {
    let users = [user()];
    const posts: Array<Record<string, unknown>> = [];
    mswServer.use(
      http.get('*/internal/organizations/org1/users', () => HttpResponse.json(users)),
      http.post('*/internal/organizations/org1/users', async ({ request }) => {
        posts.push((await request.json()) as Record<string, unknown>);
        users = [...users, user({ id: 'u2', name: 'Beto', email: 'beto@loja.com', mustChangePassword: true })];
        return HttpResponse.json(users[1], { status: 201 });
      }),
    );
    renderWithProviders(<UsersTab organizationId="org1" />);
    expect(await screen.findByText('ana@loja.com')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nome'), 'Beto');
    await userEvent.type(screen.getByLabelText('E-mail'), 'beto@loja.com');
    await userEvent.type(screen.getByLabelText('Senha provisória'), 'senha-provisoria-1');
    await userEvent.click(screen.getByRole('button', { name: 'Criar Admin' }));
    await waitFor(() => expect(posts).toEqual([
      { name: 'Beto', email: 'beto@loja.com', temporaryPassword: 'senha-provisoria-1' },
    ]));
    expect(await screen.findByText('beto@loja.com')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome')).toHaveValue('');
  });

  it('shows the API error, e.g. e-mail already in use', async () => {
    mswServer.use(
      http.get('*/internal/organizations/org1/users', () => HttpResponse.json([])),
      http.post('*/internal/organizations/org1/users', () =>
        HttpResponse.json({ error: 'email_in_use', message: 'e-mail já cadastrado' }, { status: 409 })),
    );
    renderWithProviders(<UsersTab organizationId="org1" />);
    await screen.findByText('Nenhum usuário');
    await userEvent.type(screen.getByLabelText('Nome'), 'Beto');
    await userEvent.type(screen.getByLabelText('E-mail'), 'beto@loja.com');
    await userEvent.type(screen.getByLabelText('Senha provisória'), 'senha-provisoria-1');
    await userEvent.click(screen.getByRole('button', { name: 'Criar Admin' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('e-mail já cadastrado');
  });

  it('deactivates a user after confirmation', async () => {
    const calls: string[] = [];
    mswServer.use(
      http.get('*/internal/organizations/org1/users', () => HttpResponse.json([user()])),
      http.post('*/internal/users/u1/deactivate', () => {
        calls.push('deactivate');
        return HttpResponse.json({ id: 'u1', active: false });
      }),
    );
    const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<UsersTab organizationId="org1" />);
    const row = await screen.findByRole('row', { name: /ana@loja.com/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Desativar' }));
    expect(calls).toHaveLength(0);
    await userEvent.click(within(row).getByRole('button', { name: 'Desativar' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    confirm.mockRestore();
  });

  it('resets the password with a provisional one', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    mswServer.use(
      http.get('*/internal/organizations/org1/users', () => HttpResponse.json([user({ active: false })])),
      http.post('*/internal/users/u1/reset-password', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json({ id: 'u1', mustChangePassword: true });
      }),
    );
    renderWithProviders(<UsersTab organizationId="org1" />);
    const row = await screen.findByRole('row', { name: /ana@loja.com/ });
    expect(within(row).getByText('Inativo')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Redefinir senha' }));
    await userEvent.type(screen.getByLabelText('Nova senha provisória'), 'outra-senha-123');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(bodies).toEqual([{ temporaryPassword: 'outra-senha-123' }]));
    expect(await screen.findByRole('status')).toHaveTextContent(/Senha redefinida/);
  });
});
