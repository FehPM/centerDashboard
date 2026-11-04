import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { OrganizationsPage } from '../pages/OrganizationsPage.js';
import { OrganizationDetailPage } from '../pages/OrganizationDetailPage.js';

const item = (over: Record<string, unknown> = {}) => ({
  id: 'org1', name: 'Loja Alfa', slug: 'loja-alfa', status: 'ACTIVE', createdAt: '2026-11-01T10:00:00.000Z',
  modules: [
    { key: 'overview', status: 'ACTIVE', startsAt: '2026-11-01T03:00:00.000Z', endsAt: null, inForce: true },
    { key: 'sprint', status: 'SUSPENDED', startsAt: '2026-11-01T03:00:00.000Z', endsAt: null, inForce: false },
  ],
  pendingSetup: [],
  ...over,
});

function renderList() {
  return renderWithProviders(
    <Routes>
      <Route path="/clientes" element={<OrganizationsPage />} />
      <Route path="/clientes/:id" element={<p>Página do cliente</p>} />
    </Routes>,
    { route: '/clientes' },
  );
}

describe('OrganizationsPage', () => {
  beforeEach(() => localStorage.setItem('center.operator.token', 't'));

  it('lists clients with in-force module count', async () => {
    mswServer.use(http.get('*/internal/organizations', () => HttpResponse.json([item()])));
    renderList();
    expect(await screen.findByText('Loja Alfa')).toBeInTheDocument();
    expect(screen.getByText('loja-alfa')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Loja Alfa/ })).toHaveTextContent(/Ativo.*1/);
    expect(screen.queryByText('Pendências')).not.toBeInTheDocument();
  });

  it('shows the pending badge', async () => {
    mswServer.use(http.get('*/internal/organizations', () =>
      HttpResponse.json([item({ pendingSetup: ['overview'] })])));
    renderList();
    expect(await screen.findByText('Pendências')).toBeInTheDocument();
  });

  it('creating a client posts name and navigates to its page', async () => {
    let posted: unknown;
    mswServer.use(
      http.get('*/internal/organizations', () => HttpResponse.json([])),
      http.post('*/internal/organizations', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(item({ id: 'novo', name: 'Loja Nova', modules: [] }), { status: 201 });
      }),
    );
    renderList();
    await userEvent.click(await screen.findByRole('button', { name: 'Novo cliente' }));
    await userEvent.type(screen.getByLabelText('Nome'), 'Loja Nova');
    await userEvent.click(screen.getByRole('button', { name: 'Criar' }));
    expect(await screen.findByText('Página do cliente')).toBeInTheDocument();
    expect(posted).toEqual({ name: 'Loja Nova' });
  });

  it('shows slug conflict and can cancel', async () => {
    mswServer.use(
      http.get('*/internal/organizations', () => HttpResponse.json([])),
      http.post('*/internal/organizations', () =>
        HttpResponse.json({ error: 'slug_in_use', message: 'já existe um cliente com esse slug' }, { status: 409 })),
    );
    renderList();
    await userEvent.click(await screen.findByRole('button', { name: 'Novo cliente' }));
    await userEvent.type(screen.getByLabelText('Nome'), 'Loja');
    await userEvent.type(screen.getByLabelText('Slug (opcional)'), 'loja');
    await userEvent.click(screen.getByRole('button', { name: 'Criar' }));
    expect(await screen.findByText('já existe um cliente com esse slug')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument();
  });
});

describe('OrganizationDetailPage', () => {
  beforeEach(() => localStorage.setItem('center.operator.token', 't'));

  it('shows tabs and switches between them', async () => {
    mswServer.use(
      http.get('*/internal/organizations/org1', () => HttpResponse.json({
        ...item(), usersCount: 2, attribution: { organizationId: 'org1', apiUrl: 'http://x' },
      })),
      http.get('*/internal/organizations/org1/integrations', () => HttpResponse.json([])),
      http.get('*/internal/organizations/org1/users', () => HttpResponse.json([])),
    );
    renderWithProviders(
      <Routes><Route path="/clientes/:id" element={<OrganizationDetailPage />} /></Routes>,
      { route: '/clientes/org1' },
    );
    expect(await screen.findByRole('heading', { name: 'Loja Alfa' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Visão geral/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Integrações' }));
    expect(screen.queryByRole('row', { name: /Visão geral/ })).not.toBeInTheDocument();
    expect(await screen.findByRole('group', { name: /E-commerce/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Usuários' }));
    expect(await screen.findByText('Nenhum usuário')).toBeInTheDocument();
  });

  async function renderDetail() {
    const bodies: unknown[] = [];
    mswServer.use(
      http.get('*/internal/organizations/org1', () => HttpResponse.json({
        ...item(), usersCount: 2, attribution: { organizationId: 'org1', apiUrl: 'http://x' },
      })),
      http.patch('*/internal/organizations/org1', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json(item());
      }),
    );
    renderWithProviders(
      <Routes><Route path="/clientes/:id" element={<OrganizationDetailPage />} /></Routes>,
      { route: '/clientes/org1' },
    );
    await screen.findByRole('heading', { name: 'Loja Alfa' });
    return bodies;
  }

  it('suspending a client sends status SUSPENDED after confirmation', async () => {
    const bodies = await renderDetail();
    const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole('button', { name: 'Suspender cliente' }));
    expect(bodies).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Suspender cliente' }));
    await waitFor(() => expect(bodies).toEqual([{ status: 'SUSPENDED' }]));
    confirm.mockRestore();
  });

  it('renaming a client sends the new name', async () => {
    const bodies = await renderDetail();
    const input = screen.getByLabelText('Nome do cliente');
    await userEvent.clear(input);
    await userEvent.type(input, 'Loja Beta');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(bodies).toEqual([{ name: 'Loja Beta' }]));
  });

  it('shows not found', async () => {
    mswServer.use(http.get('*/internal/organizations/zz', () =>
      HttpResponse.json({ error: 'not_found', message: 'cliente não encontrado' }, { status: 404 })));
    renderWithProviders(
      <Routes><Route path="/clientes/:id" element={<OrganizationDetailPage />} /></Routes>,
      { route: '/clientes/zz' },
    );
    expect(await screen.findByText('cliente não encontrado')).toBeInTheDocument();
  });
});
