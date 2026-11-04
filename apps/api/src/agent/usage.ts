import type { PrismaClient } from '@prisma/client';

export interface UsageRow {
  mode: 'OWN' | 'MANAGED';
  keyLabel: string;
  messages: number;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageSummary {
  from: string;
  to: string;
  totals: { messages: number; inputTokens: number; outputTokens: number };
  /** Cobrável = só o modo MANAGED. O modo OWN aparece para o cliente ver o consumo, sem cobrança nossa. */
  byKey: UsageRow[];
}

/** Respostas anteriores ao registro do modo usaram a chave da plataforma. */
const LEGACY_LABEL = 'Plataforma';

export async function summarizeUsage(
  prisma: PrismaClient, organizationId: string, range: { from: string; to: string },
): Promise<UsageSummary> {
  const groups = await prisma.message.groupBy({
    by: ['llmMode', 'llmKeyLabel'],
    where: {
      role: 'ASSISTANT',
      createdAt: { gte: new Date(`${range.from}T00:00:00-03:00`), lt: new Date(Date.parse(`${range.to}T00:00:00-03:00`) + 86_400_000) },
      conversation: { organizationId },
    },
    _count: { _all: true },
    _sum: { inputTokens: true, outputTokens: true },
  });

  const merged = new Map<string, UsageRow>();
  for (const group of groups) {
    const mode = group.llmMode ?? 'MANAGED';
    const keyLabel = group.llmKeyLabel ?? LEGACY_LABEL;
    const key = `${mode}|${keyLabel}`;
    const row = merged.get(key) ?? { mode, keyLabel, messages: 0, inputTokens: 0, outputTokens: 0 };
    row.messages += group._count._all;
    row.inputTokens += group._sum.inputTokens ?? 0;
    row.outputTokens += group._sum.outputTokens ?? 0;
    merged.set(key, row);
  }
  const byKey = [...merged.values()].sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
  const totals = byKey.reduce(
    (sum, row) => ({
      messages: sum.messages + row.messages,
      inputTokens: sum.inputTokens + row.inputTokens,
      outputTokens: sum.outputTokens + row.outputTokens,
    }),
    { messages: 0, inputTokens: 0, outputTokens: 0 },
  );
  return { ...range, totals, byKey };
}
