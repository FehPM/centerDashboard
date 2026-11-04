import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { AgentUsageCard } from '../components/settings/AgentUsageCard.js';

const usage = {
  from: '2026-11-01', to: '2026-11-30',
  totals: { messages: 6, inputTokens: 1500, outputTokens: 300 },
  byKey: [
    { mode: 'MANAGED', keyLabel: 'Plataforma', messages: 5, inputTokens: 1200, outputTokens: 250 },
    { mode: 'OWN', keyLabel: 'Chave produção', messages: 1, inputTokens: 300, outputTokens: 50 },
  ],
};

describe('AgentUsageCard', () => {
  it('shows the total and who pays for each key', async () => {
    mswServer.use(http.get('/api/agent/usage', () => HttpResponse.json(usage)));
    renderWithProviders(<AgentUsageCard />);
    expect(await screen.findByText(/1\.800 tokens em 6 respostas/)).toBeInTheDocument();
    expect(screen.getByText('Plataforma')).toBeInTheDocument();
    expect(screen.getByText('Gerenciada')).toBeInTheDocument();
    expect(screen.getByText('Chave produção')).toBeInTheDocument();
    expect(screen.getByText('Chave própria')).toBeInTheDocument();
  });

  it('renders nothing when the assistant module is not available', async () => {
    mswServer.use(http.get('/api/agent/usage', () => HttpResponse.json(
      { error: 'module_not_available', message: 'módulo indisponível' }, { status: 403 },
    )));
    const { container } = renderWithProviders(<AgentUsageCard />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
