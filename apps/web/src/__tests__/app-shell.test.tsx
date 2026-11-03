import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { AppShell } from '../components/layout/AppShell.js';
import { setAuthToken } from '../lib/api-client.js';
import { MODULES, meHandler } from './helpers-me.js';

function shell() {
  renderWithProviders(
    <Routes><Route element={<AppShell />}><Route path="/" element={<p>conteudo</p>} /></Route></Routes>,
  );
}

beforeEach(() => setAuthToken('t'));
afterEach(() => setAuthToken(null));

describe('AppShell', () => {
  it('menu shows only modules returned by /auth/me', async () => {
    mswServer.use(meHandler());
    shell();
    expect(await screen.findByRole('link', { name: 'Produtos' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Visão geral' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Aquisição' })).not.toBeInTheDocument();
  });

  it('Usuários and Configurações only for ADMIN', async () => {
    mswServer.use(meHandler({ role: 'MEMBER' }));
    shell();
    await screen.findByRole('link', { name: 'Produtos' });
    expect(screen.queryByRole('link', { name: 'Usuários' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configurações' })).not.toBeInTheDocument();
  });

  it('shows Configurações to an ADMIN', async () => {
    mswServer.use(meHandler());
    shell();
    expect(await screen.findByRole('link', { name: 'Configurações' })).toBeInTheDocument();
  });

  it('assistant widget hidden without assistant module', async () => {
    mswServer.use(meHandler({ modules: [MODULES.overview!] }));
    shell();
    await screen.findByRole('link', { name: 'Visão geral' });
    expect(screen.queryByRole('button', { name: /assistente/i })).not.toBeInTheDocument();
  });

  it('shows the assistant widget when the module is present', async () => {
    mswServer.use(meHandler());
    shell();
    await screen.findByRole('link', { name: 'Visão geral' });
    expect(screen.getByRole('button', { name: /assistente/i })).toBeInTheDocument();
  });

  it('view session shows the read-only banner and hides Usuários, Configurações and the assistant', async () => {
    mswServer.use(meHandler({ viewSession: true }));
    shell();
    expect(await screen.findByText('Visualização da equipe Blan — somente leitura')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encerrar visualização' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Usuários' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configurações' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assistente/i })).not.toBeInTheDocument();
  });
});
