import { scopeGateway, SourceNotAllowedError, type MetricGatewayLike } from '../authz/scoped-gateway.js';

function inner() {
  return {
    listMetrics: jest.fn(async () => [
      { id: 'commerce.revenue', source: 'commerce' },
      { id: 'ga4.sessions', source: 'ga4' },
    ]),
    queryMetric: jest.fn(async () => ({})),
    queryBatch: jest.fn(async () => []),
    callTool: jest.fn(async () => ({})),
  } as unknown as MetricGatewayLike & { callTool: jest.Mock; queryBatch: jest.Mock; listMetrics: jest.Mock };
}

describe('scopeGateway', () => {
  it('throws SourceNotAllowedError before calling the inner gateway', async () => {
    const gw = inner();
    const scoped = scopeGateway(gw, new Set(['commerce']));
    await expect(scoped.callTool('ga4', 'top_events', {})).rejects.toBeInstanceOf(SourceNotAllowedError);
    expect(gw.callTool).not.toHaveBeenCalled();
  });

  it('listMetrics drops descriptors of other sources', async () => {
    const scoped = scopeGateway(inner(), new Set(['commerce']));
    const list = await scoped.listMetrics();
    expect(list.map((m) => m.id)).toEqual(['commerce.revenue']);
  });

  it('queryBatch rejects when any query is outside the set', async () => {
    const gw = inner();
    const scoped = scopeGateway(gw, new Set(['commerce']));
    const q = (metricId: string) => ({ metricId }) as never;
    await expect(scoped.queryBatch([q('commerce.revenue'), q('ga4.sessions')]))
      .rejects.toBeInstanceOf(SourceNotAllowedError);
    expect(gw.queryBatch).not.toHaveBeenCalled();
  });
});
