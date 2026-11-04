import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { resolveTenant } from '../tenant.js';
import { runAgent } from '../agent/agent.js';
import { appendExchange, loadUserConversationHistory } from '../agent/memory.js';
import { markLlmCredentialsRejected, resolveLlm } from '../agent/llm.js';
import { summarizeUsage } from '../agent/usage.js';
import { assertRange, BadRequestError } from '../range.js';
import type { AppDeps } from '../deps.js';
import { getAccess, requireModule } from '../authz/guards.js';
import { scopeGateway } from '../authz/scoped-gateway.js';

const AskBodySchema = z.object({
  message: z.string().min(1, 'mensagem vazia').max(2000, 'mensagem muito longa (máximo 2000 caracteres)'),
});

/** Mesma regra de `apps/api/src/whatsapp/worker.ts` — "hoje" nunca é `new Date()` dentro da lógica de negócio. */
function todayInSaoPaulo(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Canal interno do agente: mesma lógica (`runAgent`) que o WhatsApp usa,
 * só que autenticado pelo login do painel em vez de um número de telefone
 * vinculado — nenhum webhook público, nenhuma credencial da Meta envolvida.
 */
export async function registerAgentRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const agentGuard = [app.authenticate, requireModule('assistant', deps.prisma)];

  app.get('/api/agent/conversation', { preHandler: agentGuard }, async (request, reply) => {
    const conversation = await loadUserConversationHistory(
      deps.prisma, request.auth.userId, request.auth.organizationId,
    );
    return reply.send({ conversationId: conversation.conversationId, messages: conversation.history });
  });

  // Consumo não é segredo: qualquer usuário com o assistente vê o da própria organização.
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/agent/usage', { preHandler: agentGuard }, async (request, reply) => {
    const today = todayInSaoPaulo();
    const to = request.query.to ?? today;
    const from = request.query.from ?? `${today.slice(0, 8)}01`;
    const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (!isDay(from) || !isDay(to)) return reply.status(400).send({ error: 'bad_request', message: 'use datas YYYY-MM-DD' });
    try {
      assertRange({ from, to });
    } catch (error) {
      if (error instanceof BadRequestError) return reply.status(400).send({ error: 'bad_request', message: error.message });
      throw error;
    }
    return reply.send(await summarizeUsage(deps.prisma, request.auth.organizationId, { from, to }));
  });

  app.post('/api/agent/ask', { preHandler: agentGuard }, async (request, reply) => {
    const parsed = AskBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'bad_request', message: parsed.error.issues[0]?.message ?? 'corpo inválido' });
    }

    const conversation = await loadUserConversationHistory(
      deps.prisma, request.auth.userId, request.auth.organizationId,
    );
    const tenant = await resolveTenant(deps.prisma, request.auth.organizationId);
    const today = todayInSaoPaulo();
    const access = await getAccess(request, deps.prisma);

    const llm = await resolveLlm(deps.prisma, deps.secretBox, request.auth.organizationId, deps.config.anthropicApiKey);
    const result = await runAgent({
      gateway: scopeGateway(deps.gateway, access.sources), tenant, today, access,
      history: conversation.history, userMessage: parsed.data.message,
      ...(llm.model ? { model: llm.model } : {}),
    });
    if (result.credentialsRejected && llm.mode === 'OWN') {
      await markLlmCredentialsRejected(deps.prisma, request.auth.organizationId).catch(() => {});
    }

    // Best-effort: o usuário já recebeu a resposta na chamada HTTP, uma
    // falha ao persistir o histórico não pode virar erro pra ele.
    await appendExchange(deps.prisma, {
      conversationId: conversation.conversationId,
      organizationId: request.auth.organizationId,
      userMessage: parsed.data.message,
      assistantMessage: result.reply,
      toolCalls: result.toolCalls,
      usage: result.usage,
      llm: { mode: llm.mode, keyLabel: llm.keyLabel },
    }).catch(() => {});

    return reply.send({ conversationId: conversation.conversationId, reply: result.reply });
  });
}
