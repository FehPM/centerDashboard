import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { IntegrationsTab } from '../components/IntegrationsTab.js';

// Formato real de IntegrationView (apps/api/src/internal/integrations.ts).
const view = (over: Record<string, unknown> = {}) => ({
  kind: 'COMMERCE', provider: 'UAPPI', config: {}, status: 'OK', lastCheckAt: '2026-11-01T12:00:00.000Z',
  lastError: null, secretsConfigured: true, secretsUpdatedAt: '2026-11-01T12:00:00.000Z',
  lastSyncedAt: '2026-11-02T09:30:00.000Z', syncError: null, ...over,
});

function useList(rows: unknown[]) {
  mswServer.use(http.get('*/internal/organizations/org1/integrations', () => HttpResponse.json(rows)));
}

describe('IntegrationsTab', () => {
  beforeEach(() => localStorage.setItem('center.operator.token', 't'));

  it('secret fields start empty and are omitted from the request when untouched', async () => {
    useList([view()]);
    const puts: Array<Record<string, unknown>> = [];
    mswServer.use(http.put('*/internal/organizations/org1/integrations/COMMERCE', async ({ request }) => {
      puts.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(view());
    }));
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const commerce = await screen.findByRole('group', { name: /E-commerce/ });
    const apiKey = within(commerce).getByLabelText('apiKey');
    expect(apiKey).toHaveAttribute('type', 'password');
    expect(apiKey).toHaveValue('');
    expect(apiKey).toHaveAttribute(
      'placeholder', expect.stringMatching(/^Configurado em \d{2}\/\d{2}\/\d{4} — deixe todos em branco para manter$/),
    );

    await userEvent.click(within(commerce).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ provider: 'UAPPI', config: {} });
    expect(puts[0]).not.toHaveProperty('secrets');

    await userEvent.type(within(commerce).getByLabelText('apiKey'), 'nova-chave');
    await userEvent.type(within(commerce).getByLabelText('secretKey'), 'novo-segredo');
    await userEvent.click(within(commerce).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toEqual({
      provider: 'UAPPI', config: {}, secrets: { apiKey: 'nova-chave', secretKey: 'novo-segredo' },
    });
  });

  it('blocks saving when only some of the secrets of a kind are typed', async () => {
    useList([view()]);
    const puts: unknown[] = [];
    mswServer.use(http.put('*/internal/organizations/org1/integrations/COMMERCE', async ({ request }) => {
      puts.push(await request.json());
      return HttpResponse.json(view());
    }));
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const commerce = await screen.findByRole('group', { name: /E-commerce/ });
    await userEvent.type(within(commerce).getByLabelText('secretKey'), 'novo-segredo');
    await userEvent.click(within(commerce).getByRole('button', { name: 'Salvar' }));
    expect(await within(commerce).findByRole('alert'))
      .toHaveTextContent('Para trocar as credenciais, informe apiKey e secretKey');
    expect(puts).toHaveLength(0);
  });

  it('keeps unsaved edits when the list is refetched in the background', async () => {
    const sprintRow = (boardId: string) =>
      view({ kind: 'SPRINT_BOARD', provider: 'MONDAY', config: { boardId }, secretsConfigured: false });
    let current = sprintRow('1');
    let gets = 0;
    mswServer.use(http.get('*/internal/organizations/org1/integrations', () => {
      gets += 1;
      return HttpResponse.json([current]);
    }));
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const sprint = await screen.findByRole('group', { name: /Sprint/ });
    const field = within(sprint).getByLabelText('boardId');
    await userEvent.clear(field);
    await userEvent.type(field, '999');
    // Refetch real (TanStack refaz a consulta ao voltar o foco) já com a config alterada no servidor.
    current = sprintRow('2');
    window.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(gets).toBeGreaterThanOrEqual(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(within(screen.getByRole('group', { name: /Sprint/ })).getByLabelText('boardId')).toHaveValue('999');
  });

  it('clears the partial-secrets error when a secret field is edited', async () => {
    useList([view()]);
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const commerce = await screen.findByRole('group', { name: /E-commerce/ });
    await userEvent.type(within(commerce).getByLabelText('secretKey'), 'x');
    await userEvent.click(within(commerce).getByRole('button', { name: 'Salvar' }));
    expect(await within(commerce).findByRole('alert')).toBeInTheDocument();
    await userEvent.type(within(commerce).getByLabelText('apiKey'), 'y');
    expect(within(commerce).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('sends statusMapping parsed from JSON and rejects invalid JSON', async () => {
    useList([view()]);
    const puts: Array<Record<string, unknown>> = [];
    mswServer.use(http.put('*/internal/organizations/org1/integrations/COMMERCE', async ({ request }) => {
      puts.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(view());
    }));
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const commerce = await screen.findByRole('group', { name: /E-commerce/ });
    const field = within(commerce).getByLabelText('statusMapping (JSON)');
    await userEvent.click(field);
    await userEvent.paste('{nope');
    await userEvent.click(within(commerce).getByRole('button', { name: 'Salvar' }));
    expect(await within(commerce).findByRole('alert')).toHaveTextContent(/JSON/);
    expect(puts).toHaveLength(0);
    await userEvent.clear(field);
    await userEvent.click(field);
    await userEvent.paste('{"paid":"PAID"}');
    await userEvent.click(within(commerce).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ provider: 'UAPPI', config: { statusMapping: { paid: 'PAID' } } });
  });

  it('shows lastError after a failed check', async () => {
    useList([view()]);
    mswServer.use(http.post('*/internal/organizations/org1/integrations/COMMERCE/check', () =>
      HttpResponse.json(view({ status: 'ERROR', lastError: 'credenciais recusadas' }))));
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const commerce = await screen.findByRole('group', { name: /E-commerce/ });
    expect(within(commerce).queryByText(/credenciais recusadas/)).not.toBeInTheDocument();
    await userEvent.click(within(commerce).getByRole('button', { name: 'Testar' }));
    expect(await within(commerce).findByText(/credenciais recusadas/)).toBeInTheDocument();
    expect(within(commerce).getByText('Status: Com erro')).toBeInTheDocument();
  });

  it('shows last sync and offers Testar only for COMMERCE', async () => {
    useList([view(), view({
      kind: 'SPRINT_BOARD', provider: 'MONDAY', config: { boardId: '123' }, secretsConfigured: false,
      secretsUpdatedAt: null, lastSyncedAt: undefined, syncError: undefined,
    })]);
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const commerce = await screen.findByRole('group', { name: /E-commerce/ });
    expect(within(commerce).getByText(/Última sincronização/)).toHaveTextContent('02/11/2026');
    expect(within(commerce).getByRole('button', { name: 'Testar' })).toBeInTheDocument();
    const sprint = screen.getByRole('group', { name: /Sprint/ });
    expect(within(sprint).queryByRole('button', { name: 'Testar' })).not.toBeInTheDocument();
    expect(within(sprint).getByLabelText('boardId')).toHaveValue('123');
  });

  it('shows the service account email for GA4 kinds', async () => {
    useList([
      view({
        kind: 'WEB_ANALYTICS', provider: 'GA4', config: { propertyId: '111' }, secretsConfigured: false,
        secretsUpdatedAt: null, serviceAccountEmail: 'sa@blan.iam.gserviceaccount.com',
      }),
      view({ kind: 'PLAY_STORE', provider: 'GOOGLE_PLAY', config: { packageName: 'com.x' } }),
    ]);
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const web = await screen.findByRole('group', { name: /Web/ });
    expect(within(web).getByText(/Conceda acesso à propriedade para:/))
      .toHaveTextContent('sa@blan.iam.gserviceaccount.com');
    expect(within(screen.getByRole('group', { name: /Play Store/ })).queryByText(/Conceda acesso/))
      .not.toBeInTheDocument();
  });

  it('disables only after confirmation', async () => {
    useList([view()]);
    const calls: string[] = [];
    mswServer.use(http.post('*/internal/organizations/org1/integrations/COMMERCE/disable', () => {
      calls.push('disable');
      return HttpResponse.json(view({ status: 'DISABLED' }));
    }));
    const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const commerce = await screen.findByRole('group', { name: /E-commerce/ });
    await userEvent.click(within(commerce).getByRole('button', { name: 'Desativar' }));
    expect(calls).toHaveLength(0);
    await userEvent.click(within(commerce).getByRole('button', { name: 'Desativar' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    confirm.mockRestore();
  });

  it('shows an API error when saving fails', async () => {
    useList([]);
    mswServer.use(http.put('*/internal/organizations/org1/integrations/SPRINT_BOARD', () =>
      HttpResponse.json({ error: 'bad_request', message: 'boardId: obrigatório' }, { status: 400 })));
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const sprint = await screen.findByRole('group', { name: /Sprint/ });
    expect(within(sprint).getByText('Status: Não configurada')).toBeInTheDocument();
    await userEvent.click(within(sprint).getByRole('button', { name: 'Salvar' }));
    expect(await within(sprint).findByRole('alert')).toHaveTextContent('boardId: obrigatório');
    expect(within(sprint).queryByRole('button', { name: 'Desativar' })).not.toBeInTheDocument();
  });

  it('renders the attribution snippet with the absolute api url and copies it', async () => {
    useList([]);
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderWithProviders(<IntegrationsTab organizationId="org1" />);
    const block = await screen.findByRole('region', { name: 'Script de atribuição' });
    const snippet = within(block).getByTestId('attribution-snippet');
    expect(snippet.textContent).toContain(`apiUrl: '${window.location.origin}'`);
    expect(snippet.textContent).toContain("organizationId: 'org1'");
    expect(snippet.textContent).toContain(
      `<script src="${window.location.origin}/center-attribution.js" defer></script>`,
    );
    await userEvent.click(within(block).getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(snippet.textContent));
    expect(await within(block).findByText('Copiado')).toBeInTheDocument();
  });
});
