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

export type IntegrationKind =
  'COMMERCE' | 'WEB_ANALYTICS' | 'APP_ANALYTICS' | 'PLAY_STORE' | 'APP_STORE' | 'SPRINT_BOARD' | 'LLM';

export interface LlmUsageRow {
  mode: 'OWN' | 'MANAGED'; keyLabel: string; messages: number; inputTokens: number; outputTokens: number;
}
export interface LlmUsage {
  from: string; to: string;
  totals: { messages: number; inputTokens: number; outputTokens: number };
  byKey: LlmUsageRow[];
}

export interface IntegrationView {
  kind: IntegrationKind;
  provider: string;
  config: Record<string, unknown>;
  status: 'PENDING' | 'OK' | 'ERROR' | 'DISABLED';
  lastCheckAt: string | null;
  lastError: string | null;
  secretsConfigured: boolean;
  secretsUpdatedAt: string | null;
  lastSyncedAt?: string | null;
  syncError?: string | null;
  serviceAccountEmail?: string | null;
  /** Só LLM: últimos 4 caracteres da chave própria. */
  keyHint?: string | null;
}

export interface IntegrationUpdate {
  provider: string;
  config: Record<string, unknown>;
  secrets?: Record<string, string>;
}

export interface OrgUser {
  id: string; name: string; email: string; role: 'ADMIN' | 'MEMBER'; active: boolean; mustChangePassword: boolean;
}

export interface AuditItem {
  id: string;
  operatorId: string | null;
  action: string;
  organizationId: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AuditQuery { organizationId?: string; action?: string; before?: string; limit?: number }

export interface OperatorItem {
  id: string; email: string; name: string; active: boolean; lastLoginAt: string | null; createdAt: string;
}

export interface ViewSession { token: string; url: string; expiresAt: string }

/** Base absoluta da API (relativa/vazia resolve contra a origem do back-office). */
export function absoluteApiUrl(): string {
  return new URL(__API_URL__, window.location.origin).href.replace(/\/+$/, '');
}

function post<T>(path: string, body: unknown, keepTokenOn401 = false): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body), keepTokenOn401 });
}

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
  getLlmUsage: (id: string) =>
    request<LlmUsage>(`/internal/organizations/${encodeURIComponent(id)}/llm-usage`),
  listIntegrations: (id: string) =>
    request<IntegrationView[]>(`/internal/organizations/${encodeURIComponent(id)}/integrations`),
  saveIntegration: (id: string, kind: IntegrationKind, body: IntegrationUpdate) =>
    request<IntegrationView>(
      `/internal/organizations/${encodeURIComponent(id)}/integrations/${kind}`,
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  checkIntegration: (id: string, kind: IntegrationKind) =>
    post<IntegrationView>(`/internal/organizations/${encodeURIComponent(id)}/integrations/${kind}/check`, {}),
  disableIntegration: (id: string, kind: IntegrationKind) =>
    post<IntegrationView>(`/internal/organizations/${encodeURIComponent(id)}/integrations/${kind}/disable`, {}),
  listUsers: (id: string) =>
    request<OrgUser[]>(`/internal/organizations/${encodeURIComponent(id)}/users`),
  createAdmin: (id: string, body: { name: string; email: string; temporaryPassword: string }) =>
    post<OrgUser>(`/internal/organizations/${encodeURIComponent(id)}/users`, body),
  deactivateUser: (userId: string) =>
    post<{ id: string; active: false }>(`/internal/users/${encodeURIComponent(userId)}/deactivate`, {}),
  resetUserPassword: (userId: string, temporaryPassword: string) =>
    post<{ id: string; mustChangePassword: true }>(
      `/internal/users/${encodeURIComponent(userId)}/reset-password`, { temporaryPassword }),
  startViewSession: (id: string) =>
    post<ViewSession>(`/internal/organizations/${encodeURIComponent(id)}/view-session`, {}),
  listAudit: (query: AuditQuery) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== '') params.set(key, String(value));
    return request<AuditItem[]>(`/internal/audit?${params.toString()}`);
  },
  listOperators: () => request<OperatorItem[]>('/internal/operators'),
  createOperator: (body: { name: string; email: string; password: string }) =>
    post<{ id: string; email: string; name: string; active: true }>('/internal/operators', body),
  deactivateOperator: (id: string) =>
    post<{ id: string; active: false }>(`/internal/operators/${encodeURIComponent(id)}/deactivate`, {}),
  me: () => request<{ operator: OperatorView }>('/internal/auth/me').then((r) => r.operator),
};
