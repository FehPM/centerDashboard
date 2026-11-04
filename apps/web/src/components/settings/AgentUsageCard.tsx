import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../lib/api-client.js';

const number = new Intl.NumberFormat('pt-BR');
const date = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' });

const day = (iso: string) => date.format(new Date(`${iso}T12:00:00-03:00`));

/**
 * Consumo do assistente no mês. Não é segredo: mostra tokens por chave e quem
 * paga (chave do próprio cliente ou a gerenciada pela Blan, cobrada pelo uso).
 * Some quando o módulo do assistente não está contratado.
 */
export function AgentUsageCard() {
  const { data, isError } = useQuery({
    queryKey: ['agent', 'usage'],
    queryFn: () => apiClient.getAgentUsage(),
    retry: false,
  });
  if (isError || !data) return null;

  return (
    <section aria-label="Consumo de IA" className="space-y-2 pt-4">
      <h3 className="font-semibold">Consumo do assistente</h3>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {day(data.from)} a {day(data.to)}: {number.format(data.totals.inputTokens + data.totals.outputTokens)} tokens
        em {number.format(data.totals.messages)} respostas.
      </p>
      {data.byKey.length > 0 && (
        <ul className="divide-y rounded border" style={{ borderColor: 'var(--hairline)' }}>
          {data.byKey.map((row) => (
            <li key={`${row.mode}|${row.keyLabel}`} className="flex items-center justify-between gap-4 p-3 text-sm">
              <div>
                <p className="font-medium">{row.keyLabel}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {number.format(row.inputTokens)} entrada · {number.format(row.outputTokens)} saída
                </p>
              </div>
              <span className="rounded px-2 py-0.5 text-xs font-medium"
                style={{ backgroundColor: 'var(--gridline)', color: 'var(--text-secondary)' }}>
                {row.mode === 'OWN' ? 'Chave própria' : 'Gerenciada'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
