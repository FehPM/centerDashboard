export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'center.operator.token';

export function setOperatorToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getOperatorToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export interface OperatorView { id: string; name: string; email: string }

export type LoginResult =
  | { stage: 'enroll'; token: string; otpauthUri: string; secret: string }
  | { stage: 'mfa'; token: string };

export interface TotpResult { token: string; operator: OperatorView }

export async function request<T>(
  path: string, init: RequestInit & { keepTokenOn401?: boolean } = {},
): Promise<T> {
  const { keepTokenOn401, ...fetchInit } = init;
  const token = getOperatorToken();
  const response = await fetch(`${__API_URL__}${path}`, {
    ...fetchInit,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...fetchInit.headers,
    },
  });

  if (!response.ok) {
    // Sessão expirada: limpamos o token para o guard redirecionar. Login e TOTP
    // usam 401 para "credencial errada" e não devem derrubar nada.
    if (response.status === 401 && !keepTokenOn401) setOperatorToken(null);
    const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    throw new ApiError(response.status, body.message ?? response.statusText, body.error);
  }
  return (await response.json()) as T;
}

export type OrgStatus = 'ACTIVE' | 'SUSPENDED';

export interface OrganizationModuleState {
  key: string;
  status: OrgStatus;
  startsAt: string;
  endsAt: string | null;
  inForce: boolean;
}

export interface OrganizationItem {
  id: string;
  name: string;
  slug: string | null;
  status: OrgStatus;
  createdAt: string;
  modules: OrganizationModuleState[];
  pendingSetup: string[];
}

export interface OrganizationDetail extends OrganizationItem {
  usersCount: number;
  attribution: { organizationId: string; apiUrl: string };
}

export interface ModuleUpdate {
  status: OrgStatus;
  startsAt?: string;
  endsAt?: string | null;
}

function post<T>(path: string, body: unknown, keepTokenOn401 = false): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body), keepTokenOn401 });
}

// As Tasks 19-20 acrescentam métodos (clientes, auditoria, operadores).
export const backofficeApi = {
  login: (email: string, password: string) =>
    post<LoginResult>('/internal/auth/login', { email, password }, true),
  verifyTotp: (token: string, code: string) =>
    post<TotpResult>('/internal/auth/totp', { token, code }, true),
  listOrganizations: () => request<OrganizationItem[]>('/internal/organizations'),
  createOrganization: (body: { name: string; slug?: string }) =>
    post<OrganizationItem>('/internal/organizations', body),
  getOrganization: (id: string) =>
    request<OrganizationDetail>(`/internal/organizations/${encodeURIComponent(id)}`),
  updateOrganization: (id: string, body: { name?: string; status?: OrgStatus }) =>
    request<OrganizationItem>(`/internal/organizations/${encodeURIComponent(id)}`,
      { method: 'PATCH', body: JSON.stringify(body) }),
  updateModule: (id: string, key: string, body: ModuleUpdate) =>
    request<{ key: string; status: OrgStatus; startsAt: string; endsAt: string | null }>(
      `/internal/organizations/${encodeURIComponent(id)}/modules/${encodeURIComponent(key)}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  me: () => request<{ operator: OperatorView }>('/internal/auth/me').then((r) => r.operator),
};
