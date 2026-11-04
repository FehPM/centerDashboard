import { Route, Routes } from 'react-router-dom';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { LoginPage } from '../pages/LoginPage.js';

const URI = 'otpauth://totp/Center:op@blan.com?secret=ABC';

function renderLogin() {
  return renderWithProviders(
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/clientes" element={<p>Tela de clientes</p>} />
    </Routes>,
    { route: '/login' },
  );
}

async function fillCredentials() {
  await userEvent.type(screen.getByLabelText('E-mail'), 'op@blan.com');
  await userEvent.type(screen.getByLabelText('Senha'), 'segredo123');
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
}

describe('LoginPage', () => {
  beforeEach(() => localStorage.clear());

  it('enroll flow shows QR image and secret, submits the code and stores the session token', async () => {
    mswServer.use(
      http.post('*/internal/auth/login', () =>
        HttpResponse.json({ stage: 'enroll', token: 'tmp', otpauthUri: URI, secret: 'ABC123' })),
      http.post('*/internal/auth/totp', async ({ request }) => {
        expect(await request.json()).toEqual({ token: 'tmp', code: '123456' });
        return HttpResponse.json({ token: 'session', operator: { id: 'o1', name: 'Op', email: 'op@blan.com' } });
      }),
    );
    renderLogin();
    await fillCredentials();

    expect(await screen.findByText('Configure o autenticador')).toBeInTheDocument();
    expect(await screen.findByAltText('QR code do autenticador')).toHaveAttribute(
      'src', expect.stringMatching(/^data:image\/png/));
    expect(screen.getByText('ABC123')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Código'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('Tela de clientes')).toBeInTheDocument();
    expect(localStorage.getItem('center.operator.token')).toBe('session');
  });

  it('mfa flow submits the code', async () => {
    mswServer.use(
      http.post('*/internal/auth/login', () => HttpResponse.json({ stage: 'mfa', token: 'tmp' })),
      http.post('*/internal/auth/totp', () =>
        HttpResponse.json({ token: 'session', operator: { id: 'o1', name: 'Op', email: 'op@blan.com' } })),
    );
    renderLogin();
    await fillCredentials();

    expect(await screen.findByLabelText('Código')).toBeInTheDocument();
    expect(screen.queryByText('Configure o autenticador')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Código'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('Tela de clientes')).toBeInTheDocument();
    expect(localStorage.getItem('center.operator.token')).toBe('session');
  });

  it('wrong code shows "Código inválido"', async () => {
    mswServer.use(
      http.post('*/internal/auth/login', () => HttpResponse.json({ stage: 'mfa', token: 'tmp' })),
      http.post('*/internal/auth/totp', () =>
        HttpResponse.json({ error: 'unauthorized', message: 'x' }, { status: 401 })),
    );
    renderLogin();
    await fillCredentials();
    await userEvent.type(await screen.findByLabelText('Código'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByText('Código inválido')).toBeInTheDocument();
    expect(localStorage.getItem('center.operator.token')).toBeNull();
  });

  it('wrong credentials show an error', async () => {
    mswServer.use(
      http.post('*/internal/auth/login', () =>
        HttpResponse.json({ error: 'unauthorized', message: 'x' }, { status: 401 })),
    );
    renderLogin();
    await fillCredentials();
    expect(await screen.findByText('E-mail ou senha inválidos')).toBeInTheDocument();
  });

  it('shows the too-many-attempts message on 429', async () => {
    mswServer.use(
      http.post('*/internal/auth/login', () => HttpResponse.json({ stage: 'mfa', token: 'tmp' })),
      http.post('*/internal/auth/totp', () =>
        HttpResponse.json(
          { error: 'too_many_attempts', message: 'muitas tentativas; tente novamente em alguns minutos' },
          { status: 429 })),
    );
    renderLogin();
    await fillCredentials();
    await userEvent.type(await screen.findByLabelText('Código'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() =>
      expect(screen.getByText('muitas tentativas; tente novamente em alguns minutos')).toBeInTheDocument());
  });

  it('login shows a generic message on 500', async () => {
    mswServer.use(
      http.post('*/internal/auth/login', () => HttpResponse.json({ error: 'x' }, { status: 500 })),
    );
    renderLogin();
    await fillCredentials();
    expect(await screen.findByText('Não foi possível entrar agora. Tente novamente.')).toBeInTheDocument();
  });

  it('Voltar returns to the credentials step', async () => {
    mswServer.use(
      http.post('*/internal/auth/login', () => HttpResponse.json({ stage: 'mfa', token: 'tmp' })),
    );
    renderLogin();
    await fillCredentials();
    await userEvent.click(await screen.findByRole('button', { name: 'Voltar' }));
    expect(screen.getByLabelText('Senha')).toBeInTheDocument();
    expect(screen.queryByLabelText('Código')).not.toBeInTheDocument();
  });
});
