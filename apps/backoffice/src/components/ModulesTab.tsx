import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MODULES } from '@center/entitlements';
import {
  ApiError, backofficeApi, type ModuleUpdate, type OrganizationModuleState,
} from '../lib/api-client.js';

const TZ = 'America/Sao_Paulo';

/** ISO do servidor -> yyyy-mm-dd no fuso de São Paulo (valor do input date). */
function toDateInput(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }) : '';
}

/** O fim é exclusivo na API; o operador vê/informa o último dia válido (inclusive). */
function toInclusiveEndInput(iso: string | null): string {
  return iso ? toDateInput(new Date(new Date(iso).getTime() - 24 * 60 * 60 * 1000).toISOString()) : '';
}

/** Último dia válido (yyyy-mm-dd) -> início do dia seguinte em São Paulo. */
function toExclusiveEndIso(lastDay: string): string {
  const next = new Date(`${lastDay}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return toIso(next.toISOString().slice(0, 10));
}

/** yyyy-mm-dd -> início do dia em São Paulo (UTC-3, sem horário de verão desde 2019). */
function toIso(date: string): string {
  return `${date}T00:00:00-03:00`;
}

function statusLabel(m: OrganizationModuleState | undefined): string {
  if (!m) return 'Não contratado';
  if (m.status === 'SUSPENDED') return 'Suspenso';
  return m.inForce ? 'Ativo' : 'Ativo (fora da vigência)';
}

function ModuleRow({ organizationId, label, moduleKey, state }: {
  organizationId: string; label: string; moduleKey: string; state: OrganizationModuleState | undefined;
}) {
  const queryClient = useQueryClient();
  const initialStart = toDateInput(state?.startsAt ?? null);
  const initialEnd = toInclusiveEndInput(state?.endsAt ?? null);
  const [startsAt, setStartsAt] = useState(initialStart);
  const [endsAt, setEndsAt] = useState(initialEnd);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: ModuleUpdate) => backofficeApi.updateModule(organizationId, moduleKey, body),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['organization', organizationId] }),
      queryClient.invalidateQueries({ queryKey: ['organizations'] }),
    ]),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível salvar'),
  });

  function send(status: ModuleUpdate['status']): void {
    setError(null);
    if (startsAt && endsAt && endsAt < startsAt) {
      setError('A data de fim precisa ser depois do início');
      return;
    }
    mutation.mutate({
      status,
      // Só envia o que o operador mudou, para não reescrever datas existentes.
      ...(startsAt && startsAt !== initialStart ? { startsAt: toIso(startsAt) } : {}),
      ...(endsAt !== initialEnd ? { endsAt: endsAt ? toExclusiveEndIso(endsAt) : null } : {}),
    });
  }

  // Salvar datas só existe para módulo com registro e mantém o status atual.

  return (
    <tr className="border-t" style={{ borderColor: 'var(--hairline)' }}>
      <td className="py-2 pr-3">{label}</td>
      <td className="py-2 pr-3">{statusLabel(state)}</td>
      <td className="py-2 pr-3">
        <input type="date" aria-label={`Início de ${label}`} value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)} className="rounded-md border px-2 py-1 text-sm" />
      </td>
      <td className="py-2 pr-3">
        <input type="date" aria-label={`Fim de ${label}`} value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)} className="rounded-md border px-2 py-1 text-sm" />
      </td>
      <td className="py-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={mutation.isPending} onClick={() => send('ACTIVE')}
            className="rounded-md border px-2 py-1 text-sm">Ativar</button>
          <button type="button" disabled={mutation.isPending} onClick={() => send('SUSPENDED')}
            className="rounded-md border px-2 py-1 text-sm">Suspender</button>
          <button type="button" disabled={mutation.isPending || !state}
            onClick={() => state && send(state.status)}
            className="rounded-md border px-2 py-1 text-sm">Salvar datas</button>
        </div>
        {error && <p role="alert" className="mt-1 text-sm text-red-600">{error}</p>}
      </td>
    </tr>
  );
}

export function ModulesTab({ organizationId, modules }: {
  organizationId: string; modules: OrganizationModuleState[];
}) {
  const byKey = new Map(modules.map((m) => [m.key, m]));
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr>
          <th className="py-2 pr-3">Módulo</th>
          <th className="py-2 pr-3">Status</th>
          <th className="py-2 pr-3">Início</th>
          <th className="py-2 pr-3">Válido até (inclusive)</th>
          <th className="py-2">Ações</th>
        </tr>
      </thead>
      <tbody>
        {MODULES.map((def) => (
          <ModuleRow key={`${def.key}|${byKey.get(def.key)?.status}|${byKey.get(def.key)?.startsAt}|${byKey.get(def.key)?.endsAt}`}
            organizationId={organizationId} label={def.label}
            moduleKey={def.key} state={byKey.get(def.key)} />
        ))}
      </tbody>
    </table>
  );
}
