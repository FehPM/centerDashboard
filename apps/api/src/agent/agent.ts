import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs, type LanguageModel, type ModelMessage } from 'ai';
import { getModule } from '@center/entitlements';
import type { MetricGatewayLike } from '../authz/scoped-gateway.js';
import type { TenantContext } from '@center/shared';
import { buildAgentTools, type AgentToolCall, type AgentToolContext } from './tools.js';
import { buildSystemPrompt } from './system-prompt.js';

export { buildSystemPrompt };

export const MAX_HISTORY_MESSAGES = 12;
export const MAX_REPLY_CHARS = 1200;
/** Perguntas cruzadas legitimamente encadeiam 3-4 ferramentas; 8 dá folga sem virar laço. */
export const MAX_STEPS = 8;

const FALLBACK_REPLY = 'Não consegui consultar os dados agora. Tente de novo em alguns instantes.';

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentInput {
  /** Já restrito às fontes liberadas. */
  gateway: MetricGatewayLike;
  tenant: TenantContext;
  today: string;
  history: AgentMessage[];
  userMessage: string;
  access: AgentToolContext['access'];
  /** Injetável para teste; em produção vem de `defaultModel()`. */
  model?: LanguageModel;
}

export interface AgentUsage {
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AgentResult {
  reply: string;
  toolCalls: AgentToolCall[];
  usage: AgentUsage;
}

/**
 * Com `LLM_BASE_URL` definida (ex.: Ollama em http://localhost:11434/v1), o
 * agente fala com esse servidor OpenAI-compatível e nenhum dado sai da rede.
 */
export function defaultModel(apiKey: string): LanguageModel {
  const baseURL = process.env.LLM_BASE_URL;
  if (baseURL) {
    const local = createOpenAICompatible({ name: 'local', baseURL });
    return local(process.env.LLM_MODEL ?? 'qwen3:8b');
  }
  return createAnthropic({ apiKey })('claude-sonnet-5');
}

function truncate(text: string): string {
  return text.length <= MAX_REPLY_CHARS ? text : `${text.slice(0, MAX_REPLY_CHARS - 1)}…`;
}

export async function runAgent(input: AgentInput): Promise<AgentResult> {
  const toolCalls: AgentToolCall[] = [];

  const tools = buildAgentTools({
    gateway: input.gateway,
    tenant: input.tenant,
    today: input.today,
    access: input.access,
    onToolCall: (log) => toolCalls.push(log),
  });

  // Janela deslizante: conversas longas estourariam o contexto e o custo, e o
  // histórico antigo raramente ajuda numa pergunta sobre números.
  const recentHistory = input.history.slice(-MAX_HISTORY_MESSAGES);

  const messages: ModelMessage[] = [
    ...recentHistory.map((message) => ({ role: message.role, content: message.content })),
    { role: 'user' as const, content: input.userMessage },
  ];

  const model = input.model ?? defaultModel(process.env.ANTHROPIC_API_KEY ?? '');
  const modelName = typeof model === 'string' ? model : model.modelId;
  // Só módulos de dados (spec §7.2): o próprio assistente não é um escopo de conteúdo.
  const moduleLabels = input.access.modules
    .filter((key) => key !== 'assistant')
    .map((key) => getModule(key).label);

  try {
    const result = await generateText({
      model,
      system: buildSystemPrompt(input.today, moduleLabels),
      messages,
      tools,
      // Sem este limite, uma ferramenta que falha em laço queima a cota da API.
      stopWhen: stepCountIs(MAX_STEPS),
      temperature: 0,
    });

    const text = result.text.trim();
    const usage: AgentUsage = {
      model: result.response.modelId ?? modelName,
      inputTokens: result.totalUsage.inputTokens ?? null,
      outputTokens: result.totalUsage.outputTokens ?? null,
    };
    return { reply: text === '' ? FALLBACK_REPLY : truncate(text), toolCalls, usage };
  } catch (error) {
    // Falha do provedor não pode virar 500 no webhook: o usuário precisa
    // receber uma mensagem, e a Meta precisa receber 200 — por isso este
    // catch NUNCA relança. Mas engolir o erro em silêncio é exatamente como
    // uma ANTHROPIC_API_KEY inválida/expirada vira "toda resposta do
    // WhatsApp é o fallback", sem nenhum sinal em lugar nenhum: o log daqui é
    // a ÚNICA visibilidade que existe, porque `whatsapp/worker.ts` só loga
    // quando `runAgent` lança — o que ele nunca faz, precisamente por causa
    // deste catch.
    console.error('runAgent: provedor de modelo falhou, devolvendo resposta de fallback', error);
    return {
      reply: FALLBACK_REPLY, toolCalls,
      usage: { model: modelName, inputTokens: null, outputTokens: null },
    };
  }
}
