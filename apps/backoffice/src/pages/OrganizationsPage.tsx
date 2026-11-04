import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { backofficeApi } from '../lib/api-client.js';
import { NewOrganizationDialog } from '../components/NewOrganizationDialog.js';

export function OrganizationsPage() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ['organizations'], queryFn: backofficeApi.listOrganizations,
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Clientes</h1>
        <button type="button" onClick={() => setCreating(true)} className="rounded-md border px-3 py-1 text-sm">
          Novo cliente
        </button>
      </div>
      {creating && (
        <NewOrganizationDialog onCancel={() => setCreating(false)}
          onCreated={(org) => navigate(`/clientes/${org.id}`)} />
      )}
      {isLoading && <p>Carregando...</p>}
      {error && <p role="alert" className="text-red-600">Não foi possível carregar os clientes</p>}
      {data && (
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-3">Nome</th>
              <th className="py-2 pr-3">Slug</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Módulos em vigor</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {data.map((org) => (
              <tr key={org.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                <td className="py-2 pr-3"><Link to={`/clientes/${org.id}`} className="underline">{org.name}</Link></td>
                <td className="py-2 pr-3">{org.slug}</td>
                <td className="py-2 pr-3">{org.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'}</td>
                <td className="py-2 pr-3">{org.modules.filter((m) => m.inForce).length}</td>
                <td className="py-2">
                  {org.pendingSetup.length > 0 && (
                    <span className="rounded-full border px-2 py-0.5 text-xs">Pendências</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
