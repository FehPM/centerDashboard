import { internalApp } from './helpers/internal-app.js';
import { bearer, operatorToken } from './helpers/operator.js';

const headers = () => bearer(operatorToken());

type AuditCalls = Array<[{ data: Record<string, unknown> }]>;

describe('internal users', () => {
  it('creates an ADMIN with mustChangePassword', async () => {
    const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 'u_1', name: args.data.name, email: args.data.email, role: args.data.role,
      active: true, mustChangePassword: args.data.mustChangePassword,
    }));
    const { app, auditCreate } = await internalApp({ user: { findUnique: jest.fn(async () => null), create } });
    const res = await app.inject({
      method: 'POST', url: '/internal/organizations/org_1/users', headers: headers(),
      payload: { name: 'Ana', email: 'ana@loja.com', temporaryPassword: 'senha-provisoria-1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ role: 'ADMIN', mustChangePassword: true });
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ role: 'ADMIN', mustChangePassword: true, organizationId: 'org_1' });
    expect(data.passwordHash).not.toBe('senha-provisoria-1');
    expect(JSON.stringify(res.json())).not.toContain('passwordHash');
    expect((auditCreate.mock.calls as unknown as AuditCalls)[0][0].data)
      .toMatchObject({ action: 'user.create_admin', organizationId: 'org_1', targetId: 'u_1' });
    expect(JSON.stringify(auditCreate.mock.calls)).not.toContain('ana@loja.com');
    await app.close();
  });

  it('email in another organization → 409 email_in_use', async () => {
    const create = jest.fn();
    const { app } = await internalApp({
      user: { findUnique: jest.fn(async () => ({ id: 'u_other' })), create },
    });
    const res = await app.inject({
      method: 'POST', url: '/internal/organizations/org_1/users', headers: headers(),
      payload: { name: 'Ana', email: 'ana@outra.com', temporaryPassword: 'senha-provisoria-1' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'email_in_use', message: 'e-mail já cadastrado' });
    expect(create).not.toHaveBeenCalled();
    await app.close();
  });

  it('P2002 on create → 409 email_in_use', async () => {
    const { app } = await internalApp({
      user: {
        findUnique: jest.fn(async () => null),
        create: jest.fn(async () => { throw Object.assign(new Error('dup'), { code: 'P2002' }); }),
      },
    });
    const res = await app.inject({
      method: 'POST', url: '/internal/organizations/org_1/users', headers: headers(),
      payload: { name: 'Ana', email: 'ana@loja.com', temporaryPassword: 'senha-provisoria-1' },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('rejects a short temporary password', async () => {
    const { app } = await internalApp({ user: { findUnique: jest.fn(), create: jest.fn() } });
    const res = await app.inject({
      method: 'POST', url: '/internal/organizations/org_1/users', headers: headers(),
      payload: { name: 'Ana', email: 'ana@loja.com', temporaryPassword: 'curta' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('deactivates and resets password with audit scoped to the user organization', async () => {
    const update = jest.fn(async () => ({}));
    const { app, auditCreate } = await internalApp({
      user: { findUnique: jest.fn(async () => ({ id: 'u_1', organizationId: 'org_9' })), update },
    });
    const off = await app.inject({ method: 'POST', url: '/internal/users/u_1/deactivate', headers: headers() });
    expect(off.statusCode).toBe(200);
    expect(update).toHaveBeenLastCalledWith({ where: { id: 'u_1' }, data: { active: false } });
    const reset = await app.inject({
      method: 'POST', url: '/internal/users/u_1/reset-password', headers: headers(),
      payload: { temporaryPassword: 'nova-senha-provisoria' },
    });
    expect(reset.statusCode).toBe(200);
    const data = (update.mock.calls[1] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data.mustChangePassword).toBe(true);
    const calls = auditCreate.mock.calls as unknown as AuditCalls;
    expect(calls.map((c) => [c[0].data.action, c[0].data.organizationId])).toEqual([
      ['user.deactivate', 'org_9'], ['user.reset_password', 'org_9'],
    ]);
    expect(JSON.stringify(calls)).not.toContain('nova-senha-provisoria');
    await app.close();
  });
});
