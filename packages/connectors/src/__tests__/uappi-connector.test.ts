import { Pseudonymizer } from '@center/pii';
import { UappiApiError, type UappiClientLike } from '@center/uappi-client';
import { createUappiConnector } from '../uappi/connector.js';
import { CredentialsRejectedError, isCredentialsRejected, type CanonicalOrderRecord, type ReadFailure } from '../types.js';

const pseudonymizer = new Pseudonymizer('p'.repeat(32));
const logger = jest.fn();
const secrets = { apiKey: 'ak', secretKey: 'sk' };
const window = { from: '2026-07-01', to: '2026-07-20' };

function orderPayload(numeroPedido: string) {
  return {
    idPedido: numeroPedido, numeroPedido, dataEmissao: '2026-07-15 10:00:00', moeda: 'BRL',
    status: { id: 3, descricao: 'Pagamento aprovado' },
    cliente: { idCliente: '555', email: 'ana@example.com' },
    valores: { subtotal: 100, frete: 0, descontos: 0, totalPedido: 100 },
    pagamento: [{ descricao: 'Pix', valor: 100 }],
    itens: [{ sku: 'A1', descricao: 'Produto', quantidade: 1, valorUnitario: 100, valorTotal: 100 }],
  };
}

function fakeClient(pages: unknown[][]): UappiClientLike {
  return {
    listOrders: jest.fn(),
    getOrder: jest.fn(async (n: string) => orderPayload(n)),
    iterateOrders: jest.fn(async function* () { for (const p of pages) yield p; }),
  } as unknown as UappiClientLike;
}

function realConnector(client: UappiClientLike) {
  return createUappiConnector({ baseUrl: 'http://x', mock: false, buildClient: () => client });
}

async function collect(iter: AsyncIterable<CanonicalOrderRecord | ReadFailure>) {
  const out: Array<CanonicalOrderRecord | ReadFailure> = [];
  for await (const r of iter) out.push(r);
  return out;
}

describe('uappi connector', () => {
  it('parseSettings rejects missing secretKey', () => {
    const connector = createUappiConnector({ baseUrl: 'http://x', mock: true });
    expect(() => connector.parseSettings({}, { apiKey: 'ak' })).toThrow();
  });

  it('parseSettings reads statusMapping from config', () => {
    const connector = createUappiConnector({ baseUrl: 'http://x', mock: true });
    expect(connector.parseSettings({ statusMapping: { '7': 'CANCELLED' } }, secrets)).toEqual({
      credentials: secrets, statusOverrides: { '7': 'CANCELLED' },
    });
    expect(connector.parseSettings({}, secrets).statusOverrides).toBeNull();
  });

  it('discover lists orders', () => {
    expect(createUappiConnector({ baseUrl: 'http://x', mock: true }).discover()).toEqual(['orders']);
  });

  it('check is ok in mock mode', async () => {
    const connector = createUappiConnector({ baseUrl: 'http://x', mock: true });
    expect(await connector.check(connector.parseSettings({}, secrets))).toEqual({ ok: true });
  });

  it('check is ok when the first page loads', async () => {
    const client = fakeClient([]);
    (client.listOrders as jest.Mock).mockResolvedValue({ pedidos: [] });
    const connector = realConnector(client);
    expect(await connector.check(connector.parseSettings({}, secrets))).toEqual({ ok: true });
  });

  it('check maps a 401 to "credenciais recusadas pela Uappi"', async () => {
    const client = fakeClient([]);
    (client.listOrders as jest.Mock).mockRejectedValue(new UappiApiError(401, 'nao autorizado'));
    const connector = realConnector(client);
    expect(await connector.check(connector.parseSettings({}, secrets)))
      .toEqual({ ok: false, error: 'credenciais recusadas pela Uappi' });
  });

  it('check maps any other failure to "Uappi indisponível"', async () => {
    const client = fakeClient([]);
    (client.listOrders as jest.Mock).mockRejectedValue(new UappiApiError(500, 'boom'));
    const connector = realConnector(client);
    expect(await connector.check(connector.parseSettings({}, secrets)))
      .toEqual({ ok: false, error: 'Uappi indisponível' });
  });

  it('readOrders yields a failure for a summary without numeroPedido and keeps going', async () => {
    const connector = realConnector(fakeClient([[{ semNumero: true }, { numeroPedido: 'P2' }]]));
    const records = await collect(
      connector.readOrders(connector.parseSettings({}, secrets), window, { pseudonymizer, logger }),
    );
    expect(records.map((r) => r.kind)).toEqual(['failure', 'order']);
  });

  it.each([401, 403])('readOrders turns a %i on the listing into CredentialsRejectedError', async (status) => {
    const client = fakeClient([]);
    (client.iterateOrders as jest.Mock).mockImplementation(async function* () {
      throw new UappiApiError(status, `Uappi respondeu ${status}: corpo do upstream`);
    });
    const connector = realConnector(client);
    const error = await collect(
      connector.readOrders(connector.parseSettings({}, secrets), window, { pseudonymizer, logger }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CredentialsRejectedError);
    expect(isCredentialsRejected(error)).toBe(true);
    // Mensagem fixa: nada do corpo da resposta do provedor.
    expect((error as Error).message).toBe('credenciais recusadas pela Uappi');
  });

  it('readOrders lets an outage (503, timeout) through as a plain, transient error', async () => {
    const client = fakeClient([]);
    (client.iterateOrders as jest.Mock).mockImplementation(async function* () {
      throw new UappiApiError(503, 'Uappi respondeu 503');
    });
    const connector = realConnector(client);
    const error = await collect(
      connector.readOrders(connector.parseSettings({}, secrets), window, { pseudonymizer, logger }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UappiApiError);
    expect(isCredentialsRejected(error)).toBe(false);
  });

  it('isCredentialsRejected also recognises the error by name (another module copy)', () => {
    const foreign = Object.assign(new Error('x'), { name: 'CredentialsRejectedError' });
    expect(isCredentialsRejected(foreign)).toBe(true);
    expect(isCredentialsRejected(new Error('x'))).toBe(false);
    expect(isCredentialsRejected('CredentialsRejectedError')).toBe(false);
  });

  it('records contain only hashed customer fields', async () => {
    const connector = realConnector(fakeClient([[{ numeroPedido: 'P1' }]]));
    const records = await collect(
      connector.readOrders(connector.parseSettings({}, secrets), window, { pseudonymizer, logger }),
    );
    const keys: string[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && !(v instanceof Date)) {
        for (const [k, child] of Object.entries(v)) { keys.push(k); walk(child); }
      }
    };
    // rawPayload mantém as chaves, mas com valores redigidos (checado via JSON abaixo).
    walk(records.map((r) => (r.kind === 'order' ? { ...r.order, rawPayload: undefined, items: r.items } : r)));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((k) => /^(email|documento|cpf|clientId)$/.test(k))).toEqual([]);
    expect(JSON.stringify(records)).not.toContain('ana@example.com');
  });
});
