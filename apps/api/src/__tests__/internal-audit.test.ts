import { internalApp } from './helpers/internal-app.js';
import { bearer, operatorToken } from './helpers/operator.js';

const headers = () => bearer(operatorToken());

type AuditCalls = Array<[{ data: Record<string, unknown> }]>;
const opRow = { id: 'op_1', email: 'op@blan.com', name: 'Operador', active: true };

describe('internal audit and operators', () => {
  it('limit is capped at 100', async () => {
    const findMany = jest.fn(async (_args: unknown) => []);
    const { app } = await internalApp({ operatorAuditLog: { create: jest.fn(), findMany } });
    await app.inject({ method: 'GET', url: '/internal/audit?limit=5000', headers: headers() });
    expect(findMany.mock.calls[0][0]).toMatchObject({ take: 100, orderBy: { createdAt: 'desc' } });
    await app.inject({ method: 'GET', url: '/internal/audit', headers: headers() });
    expect(findMany.mock.calls[1][0]).toMatchObject({ take: 50 });
    await app.close();
  });

  it('filters by organizationId', async () => {
    const findMany = jest.fn(async (_args: unknown) => []);
    const { app } = await internalApp({ operatorAuditLog: { create: jest.fn(), findMany } });
    const before = '2026-11-01T00:00:00.000Z';
    const res = await app.inject({
      method: 'GET',
      url: `/internal/audit?organizationId=org_1&operatorId=op_2&action=module.activate&before=${before}`,
      headers: headers(),
    });
    expect(res.statusCode).toBe(200);
    expect((findMany.mock.calls[0][0] as { where: unknown }).where).toEqual({
      organizationId: 'org_1', operatorId: 'op_2', action: 'module.activate', createdAt: { lt: new Date(before) },
    });
    const bad = await app.inject({ method: 'GET', url: '/internal/audit?before=ontem', headers: headers() });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  it('operator cannot deactivate self', async () => {
    const update = jest.fn();
    const { app, auditCreate } = await internalApp({
      platformOperator: { findUnique: jest.fn(async () => opRow), update },
    });
    const res = await app.inject({ method: 'POST', url: '/internal/operators/op_1/deactivate', headers: headers() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('cannot_deactivate_self');
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it('deactivates another operator with audit', async () => {
    const update = jest.fn(async () => ({}));
    const findUnique = jest.fn(async (a: { where: { id?: string } }) => ({ ...opRow, id: a.where.id }));
    const { app, auditCreate } = await internalApp({ platformOperator: { findUnique, update } });
    const res = await app.inject({ method: 'POST', url: '/internal/operators/op_2/deactivate', headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: 'op_2' }, data: { active: false } });
    expect((auditCreate.mock.calls as unknown as AuditCalls)[0][0].data)
      .toMatchObject({ action: 'operator.deactivate', targetId: 'op_2' });
    await app.close();
  });

  it('creates an operator (audited), 409 on duplicate email and 400 on short password', async () => {
    const create = jest.fn(async () => ({ id: 'op_new' }));
    const findUnique = jest.fn()
      .mockResolvedValueOnce(opRow) // guard
      .mockResolvedValueOnce(null) // duplicidade: livre
      .mockResolvedValueOnce(opRow) // guard
      .mockResolvedValueOnce({ id: 'op_x' }) // duplicidade: existe
      .mockResolvedValue(opRow);
    const { app, auditCreate } = await internalApp({ platformOperator: { findUnique, create } });
    const payload = { email: 'novo@blan.com', name: 'Novo', password: 'senha-longa-123' };
    const ok = await app.inject({ method: 'POST', url: '/internal/operators', headers: headers(), payload });
    expect(ok.statusCode).toBe(201);
    expect(JSON.stringify(ok.json())).not.toContain('passwordHash');
    expect((auditCreate.mock.calls as unknown as AuditCalls)[0][0].data)
      .toMatchObject({ action: 'operator.create', targetId: 'op_new' });
    const dup = await app.inject({ method: 'POST', url: '/internal/operators', headers: headers(), payload });
    expect(dup.statusCode).toBe(409);
    const short = await app.inject({
      method: 'POST', url: '/internal/operators', headers: headers(), payload: { ...payload, password: 'curta' },
    });
    expect(short.statusCode).toBe(400);
    await app.close();
  });
});
