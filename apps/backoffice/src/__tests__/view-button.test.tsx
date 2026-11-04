import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { OrganizationDetailPage } from '../pages/OrganizationDetailPage.js';

const detail = {
  id: 'org1', name: 'Loja Alfa', slug: 'loja-alfa', status: 'ACTIVE', createdAt: '2026-11-01T10:00:00.000Z',
  modules: [], pendingSetup: [], usersCount: 1,
  attribution: { organizationId: 'org1', apiUrl: 'http://localhost:3333' },
};

function renderDetail() {
  mswServer.use(http.get('*/internal/organizations/org1', () => HttpResponse.json(detail)));
  return renderWithProviders(
    <Routes><Route path="/clientes/:id" element={<OrganizationDetailPage />} /></Routes>,
    { route: '/clientes/org1' },
  );
}

describe('Visualizar painel', () => {
  beforeEach(() => localStorage.setItem('center.operator.token', 't'));

  it('opens the returned url in a new tab', async () => {
    mswServer.use(http.post('*/internal/organizations/org1/view-session', () =>
      HttpResponse.json({
        token: 'tok', url: 'http://localhost:3333/view-session#tok', expiresAt: '2026-11-03T13:00:00.000Z',
      })));
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'Visualizar painel' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(
      'http://localhost:3333/view-session#tok', '_blank', 'noopener',
    ));
    expect(await screen.findByRole('link', { name: 'clique aqui' })).toHaveAttribute(
      'href', 'http://localhost:3333/view-session#tok',
    );
    open.mockRestore();
  });

  it('shows the API error when the session cannot be created', async () => {
    mswServer.use(http.post('*/internal/organizations/org1/view-session', () =>
      HttpResponse.json({ error: 'not_found', message: 'cliente não encontrado' }, { status: 404 })));
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'Visualizar painel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cliente não encontrado');
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('renders the Integrações and Usuários tabs', async () => {
    mswServer.use(
      http.get('*/internal/organizations/org1/integrations', () => HttpResponse.json([])),
      http.get('*/internal/organizations/org1/users', () => HttpResponse.json([])),
    );
    renderDetail();
    await userEvent.click(await screen.findByRole('tab', { name: 'Integrações' }));
    expect(await screen.findByRole('group', { name: /E-commerce/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Usuários' }));
    expect(await screen.findByText('Nenhum usuário')).toBeInTheDocument();
  });
});
