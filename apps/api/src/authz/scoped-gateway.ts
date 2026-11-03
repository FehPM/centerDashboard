import { sourceOf, type MetricGateway } from '@center/mcp-core';
import type { MetricSource } from '@center/shared';

export type MetricGatewayLike = Pick<MetricGateway, 'listMetrics' | 'queryMetric' | 'queryBatch' | 'callTool'>;

export class SourceNotAllowedError extends Error {
  constructor(readonly source: MetricSource) {
    super(`fonte não permitida: ${source}`);
    this.name = 'SourceNotAllowedError';
  }
}

/**
 * Envolve o gateway restringindo-o às fontes permitidas. Defesa em profundidade:
 * a checagem acontece antes de qualquer chamada ao gateway interno, então um
 * esquecimento numa rota nunca vaza dados de fonte não contratada.
 */
export function scopeGateway(gateway: MetricGatewayLike, sources: ReadonlySet<MetricSource>): MetricGatewayLike {
  const assertAllowed = (source: MetricSource): void => {
    if (!sources.has(source)) throw new SourceNotAllowedError(source);
  };
  return {
    async listMetrics() {
      const all = await gateway.listMetrics();
      return all.filter((descriptor) => sources.has(descriptor.source));
    },
    async queryMetric(query) {
      assertAllowed(sourceOf(query.metricId));
      return gateway.queryMetric(query);
    },
    async queryBatch(queries) {
      for (const query of queries) assertAllowed(sourceOf(query.metricId));
      return gateway.queryBatch(queries);
    },
    async callTool(source, ...rest) {
      assertAllowed(source);
      return gateway.callTool(source, ...rest);
    },
  } as MetricGatewayLike;
}
