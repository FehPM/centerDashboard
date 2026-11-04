import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '../components/layout/RequireAuth.js';
import { RequireAdmin, RequireModule } from '../components/layout/RequireModule.js';
import { HomeRoute } from '../components/layout/HomeRoute.js';

function App() {
  return (
    <Routes>
      <Route path="/login" element={<p>login</p>} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomeRoute overview={<p>visao</p>} />} />
        <Route path="/produtos" element={<RequireModule moduleKey="products"><p>produtos</p></RequireModule>} />
        <Route path="/aquisicao" element={<RequireModule moduleKey="acquisition"><p>aquisicao</p></RequireModule>} />
        <Route path="/sprint" element={<RequireModule moduleKey="sprint"><p>sprint</p></RequireModule>} />
        <Route path="/configuracoes" element={<RequireAdmin><p>config</p></RequireAdmin>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
import { setAuthToken } from '../lib/api-client.js';
import { MODULES, meHandler } from './helpers-me.js';

const NOTICE = 'A equipe Blan está configurando as integrações deste módulo.';

beforeEach(() => setAuthToken('t'));
afterEach(() => setAuthToken(null));

describe('RequireModule', () => {
  it('awaiting_setup renders the setup notice and fires no data request', async () => {
    const batch = jest.fn();
    mswServer.use(
      meHandler({ modules: [{ ...MODULES.products!, state: 'awaiting_setup' }] }),
      http.post('/api/metrics/batch', () => { batch(); return HttpResponse.json({ series: [] }); }),
    );
    renderWithProviders(<App />, { route: '/produtos' });
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(batch).not.toHaveBeenCalled();
  });

  it('member without overview lands on the first visible module', async () => {
    mswServer.use(
      meHandler({ role: 'MEMBER', modules: [{ ...MODULES.products!, state: 'awaiting_setup' }, MODULES.acquisition!] }),
    );
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
  });

  it('redirects a missing module to the home route', async () => {
    mswServer.use(meHandler({ modules: [{ ...MODULES.products!, state: 'awaiting_setup' }] }));
    renderWithProviders(<App />, { route: '/sprint' });
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
  });

  it('no modules → NoModulesPage', async () => {
    mswServer.use(meHandler({ modules: [] }));
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('Nenhum módulo liberado para você. Fale com o administrador da sua conta.')).toBeInTheDocument();
  });

  it('non-admin is redirected away from /configuracoes', async () => {
    mswServer.use(meHandler({ role: 'MEMBER', modules: [] }));
    renderWithProviders(<App />, { route: '/configuracoes' });
    expect(await screen.findByText(/Nenhum módulo liberado/)).toBeInTheDocument();
  });

  it('suspended organization shows the notice and a Sair button', async () => {
    mswServer.use(http.get('/auth/me', () =>
      HttpResponse.json({ error: 'organization_suspended', message: 'x' }, { status: 403 })));
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('O acesso desta conta está suspenso. Fale com a Blan.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sair' }));
    expect(localStorage.getItem('center.token')).toBeNull();
  });

  it('shows an error state on /auth/me failure and retry refetches', async () => {
    let calls = 0;
    mswServer.use(http.get('/auth/me', () => {
      calls += 1;
      return HttpResponse.json({ message: 'boom' }, { status: 500 });
    }));
    renderWithProviders(<App />, { route: '/' });
    expect(await screen.findByText('Não foi possível carregar sua sessão.')).toBeInTheDocument();
    const before = calls;
    await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
  });
});
