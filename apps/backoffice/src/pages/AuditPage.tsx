import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiError, backofficeApi, type AuditItem } from '../lib/api-client.js';

const PAGE_SIZE = 50;
const TZ = 'America/Sao_Paulo';

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'medium' });

export function AuditPage() {
  // Rascunho do formulário; só vira filtro (consulta) ao aplicar.
  const [draft, setDraft] = useState({ organizationId: '', action: '' });
  const [{ organizationId, action }, setApplied] = useState(draft);
  const orgs = useQuery({ queryKey: ['organizations'], queryFn: () => backofficeApi.listOrganizations() });
  const operators = useQuery({ queryKey: ['operators'], queryFn: () => backofficeApi.listOperators() });
  const audit = useInfiniteQuery({
    queryKey: ['audit', organizationId, action],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => backofficeApi.listAudit({
      organizationId, action, before: pageParam, limit: PAGE_SIZE,
    }),
    // Página cheia: pode haver mais; o cursor é o createdAt do item mais antigo.
    getNextPageParam: (last: AuditItem[]) =>
      last.length >= PAGE_SIZE ? last[last.length - 1]?.createdAt : undefined,
  });

  const orgName = new Map(orgs.data?.map((o) => [o.id, o.name]));
  const operatorName = new Map(operators.data?.map((o) => [o.id, o.name]));
  const items = audit.data?.pages.flat() ?? [];

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Auditoria</h1>
      <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        setApplied({ organizationId: draft.organizationId, action: draft.action.trim() });
      }}>
        <label className="text-sm">Cliente
          <select value={draft.organizationId}
            onChange={(e) => setDraft({ ...draft, organizationId: e.target.value })}
            className="mt-1 block rounded-md border px-2 py-1">
            <option value="">Todos</option>
            {orgs.data?.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </label>
        <label className="text-sm">Ação
          <input value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value })}
            placeholder="ação exata, ex.: user.deactivate"
            className="mt-1 block rounded-md border px-2 py-1" />
        </label>
        <button type="submit" className="rounded-md border px-3 py-1 text-sm">Aplicar</button>
      </form>
      {audit.isLoading && <p>Carregando...</p>}
      {audit.error && (
        <p role="alert" className="text-red-600">
          {audit.error instanceof ApiError ? audit.error.message : 'Não foi possível carregar a auditoria'}
        </p>
      )}
      {audit.data && (items.length === 0 ? <p className="text-sm">Nenhum registro</p> : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-3">Data</th><th className="py-2 pr-3">Operador</th>
              <th className="py-2 pr-3">Ação</th><th className="py-2">Cliente</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                <td className="py-2 pr-3">{formatDateTime(i.createdAt)}</td>
                <td className="py-2 pr-3">{i.operatorId ? (operatorName.get(i.operatorId) ?? i.operatorId) : '—'}</td>
                <td className="py-2 pr-3">{i.action}</td>
                <td className="py-2">{i.organizationId ? (orgName.get(i.organizationId) ?? i.organizationId) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
      {audit.hasNextPage && (
        <button type="button" disabled={audit.isFetchingNextPage} onClick={() => void audit.fetchNextPage()}
          className="mt-4 rounded-md border px-3 py-1 text-sm">Carregar mais</button>
      )}
    </div>
  );
}
