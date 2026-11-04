import { StrictMode } from 'react';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '../test/render.js';
import { ViewSessionPage } from '../pages/ViewSessionPage.js';
import { getAuthToken, setAuthToken } from '../lib/api-client.js';

afterEach(() => { setAuthToken(null); window.history.replaceState(null, '', '/'); });

function mount() {
  renderWithProviders(
    <Routes>
      <Route path="/view-session" element={<ViewSessionPage />} />
      <Route path="/" element={<p>home</p>} />
      <Route path="/login" element={<p>login</p>} />
    </Routes>,
    { route: '/view-session' },
  );
}

describe('ViewSessionPage', () => {
  it('stores the token and removes it from the URL', async () => {
    window.history.replaceState(null, '', '/view-session#abc.def');
    mount();
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(getAuthToken()).toBe('abc.def');
    expect(window.location.hash).toBe('');
  });

  it('accepts the raw token after # (format built by the API)', async () => {
    window.history.replaceState(null, '', '/view-session#abc.def.ghi');
    mount();
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(getAuthToken()).toBe('abc.def.ghi');
    expect(window.location.hash).toBe('');
  });

  it('survives StrictMode double effects and ends on home with the token stored', async () => {
    window.history.replaceState(null, '', '/view-session#abc.def');
    renderWithProviders(
      <StrictMode>
        <Routes>
          <Route path="/view-session" element={<ViewSessionPage />} />
          <Route path="/" element={<p>home</p>} />
          <Route path="/login" element={<p>login</p>} />
        </Routes>
      </StrictMode>,
      { route: '/view-session' },
    );
    expect(await screen.findByText('home')).toBeInTheDocument();
    expect(screen.queryByText('login')).not.toBeInTheDocument();
    expect(getAuthToken()).toBe('abc.def');
  });

  it('goes to login when there is no token', async () => {
    window.history.replaceState(null, '', '/view-session');
    mount();
    expect(await screen.findByText('login')).toBeInTheDocument();
  });
});
