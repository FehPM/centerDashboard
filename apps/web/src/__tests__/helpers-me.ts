import { http, HttpResponse } from 'msw';
import type { MeView, ModuleView } from '../lib/api-client.js';

export const MODULES: Record<string, ModuleView> = {
  overview: { key: 'overview', label: 'Visão geral', menuPath: '/', state: 'ready' },
  products: { key: 'products', label: 'Produtos', menuPath: '/produtos', state: 'ready' },
  acquisition: { key: 'acquisition', label: 'Aquisição', menuPath: '/aquisicao', state: 'ready' },
  assistant: { key: 'assistant', label: 'Assistente', menuPath: null, state: 'ready' },
};

export function meHandler(overrides: Partial<MeView> & { role?: 'ADMIN' | 'MEMBER' } = {}) {
  const { role, ...rest } = overrides;
  const me: MeView = {
    user: { id: 'u1', name: 'Ana', email: 'ana@x.com', role: role ?? 'ADMIN', mustChangePassword: false },
    organization: { id: 'o1', name: 'Loja' },
    modules: [MODULES.overview!, MODULES.products!, MODULES.assistant!],
    sources: ['commerce'],
    viewSession: false,
    ...rest,
    // Sem override, toda fonte liberada está pronta (o caso comum nos testes).
    readySources: rest.readySources ?? rest.sources ?? ['commerce'],
    commerceSync: rest.commerceSync ?? null,
  };
  return http.get('/auth/me', () => HttpResponse.json(me));
}
