import userEvent from '@testing-library/user-event';
import { screen, within, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { ModulesTab } from '../components/ModulesTab.js';
import type { OrganizationModuleState } from '../lib/api-client.js';

const modules: OrganizationModuleState[] = [
  { key: 'overview', status: 'ACTIVE', startsAt: '2026-11-01T03:00:00.000Z', endsAt: null, inForce: true },
  { key: 'sprint', status: 'SUSPENDED', startsAt: '2026-10-01T03:00:00.000Z', endsAt: '2026-12-01T03:00:00.000Z', inForce: false },
];

function capturePut() {
  const calls: Array<{ key: string; body: Record<string, unknown> }> = [];
  mswServer.use(
    http.put('*/internal/organizations/:id/modules/:key', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>;
      calls.push({ key: String(params.key), body });
      return HttpResponse.json({ key: params.key, status: body.status, startsAt: '2026-11-01T03:00:00.000Z', endsAt: null });
    }),
  );
  return calls;
}

describe('ModulesTab', () => {
  beforeEach(() => localStorage.setItem('center.operator.token', 't'));

  it('lists one row per catalog module with labels', () => {
    renderWithProviders(<ModulesTab organizationId="org1" modules={modules} />);
    expect(screen.getByRole('row', { name: /Visão geral/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Assistente de IA/ })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(8); // cabeçalho + 7
  });

  it('activating sends PUT with status ACTIVE', async () => {
    const calls = capturePut();
    renderWithProviders(<ModulesTab organizationId="org1" modules={modules} />);
    const row = screen.getByRole('row', { name: /Produtos/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Ativar' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.key).toBe('products');
    expect(calls[0]?.body.status).toBe('ACTIVE');
  });

  it('suspending sends status SUSPENDED', async () => {
    const calls = capturePut();
    renderWithProviders(<ModulesTab organizationId="org1" modules={modules} />);
    const row = screen.getByRole('row', { name: /Visão geral/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Suspender' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body.status).toBe('SUSPENDED');
  });

  it('picking an inclusive end day sends the start of the next day', async () => {
    const calls = capturePut();
    renderWithProviders(<ModulesTab organizationId="org1" modules={modules} />);
    const row = screen.getByRole('row', { name: /Visão geral/ });
    await userEvent.type(within(row).getByLabelText('Fim de Visão geral'), '2026-12-31');
    await userEvent.click(within(row).getByRole('button', { name: 'Salvar datas' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ status: 'ACTIVE', endsAt: '2027-01-01T00:00:00-03:00' });
  });

  it('stored endsAt displays as the previous day', () => {
    renderWithProviders(<ModulesTab organizationId="org1" modules={modules} />);
    expect(screen.getByLabelText('Fim de Sprint')).toHaveValue('2026-11-30');
  });

  it('activating without touching dates sends only status', async () => {
    const calls = capturePut();
    renderWithProviders(<ModulesTab organizationId="org1" modules={modules} />);
    const row = screen.getByRole('row', { name: /Sprint/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Ativar' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.body).toEqual({ status: 'ACTIVE' });
  });

  it('Salvar datas is disabled for a module that was never contracted', () => {
    renderWithProviders(<ModulesTab organizationId="org1" modules={modules} />);
    const row = screen.getByRole('row', { name: /Produtos/ });
    expect(within(row).getByRole('button', { name: 'Salvar datas' })).toBeDisabled();
  });

  it('end before start is blocked client-side', async () => {
    const calls = capturePut();
    renderWithProviders(<ModulesTab organizationId="org1" modules={modules} />);
    const row = screen.getByRole('row', { name: /Visão geral/ });
    await userEvent.type(within(row).getByLabelText('Fim de Visão geral'), '2026-10-01');
    await userEvent.click(within(row).getByRole('button', { name: 'Salvar datas' }));
    expect(await screen.findByText('A data de fim precisa ser depois do início')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('shows the API error message', async () => {
    mswServer.use(
      http.put('*/internal/organizations/:id/modules/:key', () =>
        HttpResponse.json({ error: 'bad_request', message: 'falhou' }, { status: 400 })),
    );
    renderWithProviders(<ModulesTab organizationId="org1" modules={modules} />);
    const row = screen.getByRole('row', { name: /Produtos/ });
    await userEvent.click(within(row).getByRole('button', { name: 'Ativar' }));
    expect(await screen.findByText('falhou')).toBeInTheDocument();
  });
});
