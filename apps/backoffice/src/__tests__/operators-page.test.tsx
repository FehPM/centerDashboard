import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { OperatorsPage } from '../pages/OperatorsPage.js';

const op = (over: Record<string, unknown> = {}) => ({
  id: 'op1', email: 'o@blan.com', name: 'Operadora Um', active: true,
  lastLoginAt: '2026-11-02T10:00:00.000Z', createdAt: '2026-10-01T00:00:00.000Z', ...over,
});

describe('OperatorsPage', () => {
  beforeEach(() => localStorage.setItem('center.operator.token', 't'));
  afterEach(() => jest.restoreAllMocks());

  it('lists, creates and deactivates operators', async () => {
    let list = [op()];
    const posts: Array<Record<string, unknown>> = [];
    const deactivated: string[] = [];
    mswServer.use(
      http.get('*/internal/operators', () => HttpResponse.json(list)),
      http.post('*/internal/operators', async ({ request }) => {
        posts.push((await request.json()) as Record<string, unknown>);
        list = [...list, op({ id: 'op2', email: 'n@blan.com', name: 'Novo', lastLoginAt: null })];
        return HttpResponse.json({ id: 'op2', email: 'n@blan.com', name: 'Novo', active: true }, { status: 201 });
      }),
      http.post('*/internal/operators/op2/deactivate', () => {
        deactivated.push('op2');
        return HttpResponse.json({ id: 'op2', active: false });
      }),
    );
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<OperatorsPage />);
    expect(await screen.findByText('o@blan.com')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Nome'), 'Novo');
    await userEvent.type(screen.getByLabelText('E-mail'), 'n@blan.com');
    await userEvent.type(screen.getByLabelText('Senha'), 'senha-do-operador-1');
    await userEvent.click(screen.getByRole('button', { name: 'Criar operador' }));
    await waitFor(() => expect(posts).toEqual([
      { name: 'Novo', email: 'n@blan.com', password: 'senha-do-operador-1' },
    ]));
    expect(await screen.findByRole('status')).toHaveTextContent(/primeiro login/);
    const row = await screen.findByRole('row', { name: /n@blan.com/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Desativar' }));
    await waitFor(() => expect(deactivated).toEqual(['op2']));
  });

  it('shows the API error when deactivating oneself', async () => {
    mswServer.use(
      http.get('*/internal/operators', () => HttpResponse.json([op()])),
      http.post('*/internal/operators/op1/deactivate', () => HttpResponse.json(
        { error: 'cannot_deactivate_self', message: 'você não pode desativar a si mesmo' }, { status: 400 })),
    );
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<OperatorsPage />);
    const row = await screen.findByRole('row', { name: /o@blan.com/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Desativar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('você não pode desativar a si mesmo');
  });
});
