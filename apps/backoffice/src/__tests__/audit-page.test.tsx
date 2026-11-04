import userEvent from '@testing-library/user-event';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../test/msw-server.js';
import { renderWithProviders } from '../test/render.js';
import { AuditPage } from '../pages/AuditPage.js';

// Formato real de OperatorAuditLog (apps/api/src/internal/audit-routes.ts).
const entry = (i: number, over: Record<string, unknown> = {}) => ({
  id: `a${i}`, operatorId: 'op1', action: 'module.update', organizationId: 'org1', targetType: 'Module',
  targetId: 'sprint', metadata: null,
  createdAt: new Date(Date.UTC(2026, 10, 3, 12, 0, 0) - i * 60_000).toISOString(),
  ...over,
});

const orgs = [
  { id: 'org1', name: 'Loja Alfa', slug: 'alfa', status: 'ACTIVE', createdAt: '2026-11-01T10:00:00.000Z', modules: [], pendingSetup: [] },
  { id: 'org2', name: 'Loja Beta', slug: 'beta', status: 'ACTIVE', createdAt: '2026-11-01T10:00:00.000Z', modules: [], pendingSetup: [] },
];
const operators = [
  { id: 'op1', email: 'o@blan.com', name: 'Operadora Um', active: true, lastLoginAt: null, createdAt: '2026-10-01T00:00:00.000Z' },
];

describe('AuditPage', () => {
  beforeEach(() => localStorage.setItem('center.operator.token', 't'));

  it('filters by organization and loads more with before', async () => {
    const queries: URLSearchParams[] = [];
    const firstPage = Array.from({ length: 50 }, (_, i) => entry(i));
    mswServer.use(
      http.get('*/internal/organizations', () => HttpResponse.json(orgs)),
      http.get('*/internal/operators', () => HttpResponse.json(operators)),
      http.get('*/internal/audit', ({ request }) => {
        const q = new URL(request.url).searchParams;
        queries.push(q);
        if (q.get('before')) return HttpResponse.json([entry(99, { action: 'user.deactivate' })]);
        return HttpResponse.json(firstPage);
      }),
    );
    renderWithProviders(<AuditPage />);
    await screen.findAllByRole('row', { name: /module.update/ });
    await userEvent.selectOptions(screen.getByLabelText('Cliente'), 'org1');
    expect(queries.some((q) => q.get('organizationId'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(
      queries.some((q) => q.get('organizationId') === 'org1' && !q.get('before')),
    ).toBe(true));
    expect((await screen.findAllByText('Operadora Um')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Loja Alfa').length).toBeGreaterThan(0);

    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    await waitFor(() => expect(queries.some((q) => q.get('before'))).toBe(true));
    const more = queries.find((q) => q.get('before'));
    expect(more?.get('organizationId')).toBe('org1');
    expect(more?.get('before')).toBe(firstPage[49]?.createdAt);
    expect(await screen.findByRole('row', { name: /user.deactivate/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('filters by action and hides Carregar mais on a short page', async () => {
    const queries: URLSearchParams[] = [];
    mswServer.use(
      http.get('*/internal/organizations', () => HttpResponse.json(orgs)),
      http.get('*/internal/operators', () => HttpResponse.json(operators)),
      http.get('*/internal/audit', ({ request }) => {
        queries.push(new URL(request.url).searchParams);
        return HttpResponse.json([entry(0, { operatorId: null, organizationId: null })]);
      }),
    );
    renderWithProviders(<AuditPage />);
    const row = await screen.findByRole('row', { name: /module.update/ });
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText('Ação'), 'user.deactivate');
    expect(queries.some((q) => q.get('action'))).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(queries.some((q) => q.get('action') === 'user.deactivate')).toBe(true));
  });
});
