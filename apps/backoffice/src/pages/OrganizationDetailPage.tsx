import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, backofficeApi, type OrgStatus } from '../lib/api-client.js';
import { ModulesTab } from '../components/ModulesTab.js';

const TABS = ['Módulos', 'Integrações', 'Usuários'] as const;
type Tab = (typeof TABS)[number];

export function OrganizationDetailPage() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<Tab>('Módulos');
  const queryClient = useQueryClient();
  const [name, setName] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['organization', id], queryFn: () => backofficeApi.getOrganization(id),
  });
  const update = useMutation({
    mutationFn: (body: { name?: string; status?: OrgStatus }) => backofficeApi.updateOrganization(id, body),
    onSuccess: async () => {
      setName(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['organization', id] }),
        queryClient.invalidateQueries({ queryKey: ['organizations'] }),
      ]);
    },
    onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Não foi possível salvar'),
  });

  if (isLoading) return <p>Carregando...</p>;
  if (error || !data) {
    return <p role="alert" className="text-red-600">
      {error instanceof ApiError ? error.message : 'Não foi possível carregar o cliente'}
    </p>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{data.name}</h1>
        <p className="text-sm">Status: {data.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'}</p>
        {/* Visualização como cliente chega na Task 20. */}
        <button type="button" disabled title="Disponível em breve" className="rounded-md border px-3 py-1 text-sm">
          Visualizar painel
        </button>
      </div>
      <form className="mb-4 flex items-end gap-2" onSubmit={(e) => {
        e.preventDefault();
        setActionError(null);
        if (name !== null && name.trim()) update.mutate({ name: name.trim() });
      }}>
        <label className="text-sm">Nome do cliente
          <input value={name ?? data.name} onChange={(e) => setName(e.target.value)} maxLength={120}
            className="mt-1 block rounded-md border px-2 py-1" />
        </label>
        <button type="submit" disabled={update.isPending} className="rounded-md border px-3 py-1 text-sm">Salvar</button>
        <button type="button" disabled={update.isPending} className="rounded-md border px-3 py-1 text-sm"
          onClick={() => {
            const suspending = data.status === 'ACTIVE';
            const ok = window.confirm(suspending
              ? `Suspender o cliente ${data.name}? Os usuários perdem o acesso.`
              : `Reativar o cliente ${data.name}?`);
            if (!ok) return;
            setActionError(null);
            update.mutate({ status: suspending ? 'SUSPENDED' : 'ACTIVE' });
          }}>
          {data.status === 'ACTIVE' ? 'Suspender cliente' : 'Reativar cliente'}
        </button>
      </form>
      {actionError && <p role="alert" className="mb-4 text-sm text-red-600">{actionError}</p>}
      <div role="tablist" className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className="rounded-md border px-3 py-1 text-sm"
            style={{ fontWeight: tab === t ? 600 : 400 }}>
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'Módulos' && <ModulesTab organizationId={data.id} modules={data.modules} />}
        {/* Integrações e Usuários: preenchidos na Task 20. */}
      </div>
    </div>
  );
}
