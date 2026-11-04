import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, backofficeApi } from '../lib/api-client.js';

const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const formatDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—';

export function OperatorsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['operators'], queryFn: () => backofficeApi.listOperators(),
  });
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => backofficeApi.createOperator({
      name: form.name.trim(), email: form.email.trim(), password: form.password,
    }),
    onSuccess: async (created) => {
      setForm({ name: '', email: '', password: '' });
      setNotice(`Operador ${created.email} criado. O cadastro do autenticador (TOTP) é feito no primeiro login.`);
      await queryClient.invalidateQueries({ queryKey: ['operators'] });
    },
    onError: (e) => setActionError(errorMessage(e, 'Não foi possível criar o operador')),
  });
  const deactivate = useMutation({
    mutationFn: (id: string) => backofficeApi.deactivateOperator(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['operators'] }),
    onError: (e) => setActionError(errorMessage(e, 'Não foi possível desativar')),
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    setActionError(null);
    setNotice(null);
    create.mutate();
  }

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Operadores</h1>
      {isLoading && <p>Carregando...</p>}
      {error && <p role="alert" className="text-red-600">{errorMessage(error, 'Não foi possível carregar os operadores')}</p>}
      {data && (
        <table className="mb-4 w-full text-left text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-3">Nome</th><th className="py-2 pr-3">E-mail</th>
              <th className="py-2 pr-3">Situação</th><th className="py-2 pr-3">Último login</th><th className="py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {data.map((o) => (
              <tr key={o.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                <td className="py-2 pr-3">{o.name}</td>
                <td className="py-2 pr-3">{o.email}</td>
                <td className="py-2 pr-3">{o.active ? 'Ativo' : 'Inativo'}</td>
                <td className="py-2 pr-3">{formatDate(o.lastLoginAt)}</td>
                <td className="py-2">
                  {o.active && (
                    <button type="button" disabled={deactivate.isPending} className="rounded-md border px-2 py-1"
                      onClick={() => {
                        if (!window.confirm(`Desativar o operador ${o.email}?`)) return;
                        setActionError(null);
                        setNotice(null);
                        deactivate.mutate(o.id);
                      }}>Desativar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {actionError && <p role="alert" className="mb-2 text-sm text-red-600">{actionError}</p>}
      {notice && <p role="status" className="mb-2 text-sm">{notice}</p>}
      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        <label className="text-sm">Nome
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
            className="mt-1 block rounded-md border px-2 py-1" />
        </label>
        <label className="text-sm">E-mail
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required
            className="mt-1 block rounded-md border px-2 py-1" />
        </label>
        <label className="text-sm">Senha
          <input type="password" value={form.password} minLength={12} required autoComplete="new-password"
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="mt-1 block rounded-md border px-2 py-1" />
        </label>
        <button type="submit" disabled={create.isPending} className="rounded-md border px-3 py-1 text-sm">Criar operador</button>
      </form>
    </div>
  );
}
