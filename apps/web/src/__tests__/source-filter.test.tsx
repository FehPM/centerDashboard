import { screen } from '@testing-library/react';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { SourceFilter } from '../components/filters/SourceFilter.js';
import { setAuthToken } from '../lib/api-client.js';
import { meHandler } from './helpers-me.js';

beforeEach(() => setAuthToken('t'));
afterEach(() => setAuthToken(null));

describe('SourceFilter', () => {
  it('only offers sources present in me.sources', async () => {
    mswServer.use(meHandler({ sources: ['commerce'] }));
    renderWithProviders(<SourceFilter today="2026-03-15" />);
    expect(await screen.findByRole('checkbox', { name: 'Loja (Uappi)' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Analytics' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  });

  it('offers ga4 when acquisition is granted', async () => {
    mswServer.use(meHandler({ sources: ['commerce', 'ga4'] }));
    renderWithProviders(<SourceFilter today="2026-03-15" />);
    expect(await screen.findAllByRole('checkbox')).toHaveLength(2);
  });
});
