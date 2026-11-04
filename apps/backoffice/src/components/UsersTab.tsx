import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, backofficeApi, type OrgUser } from '../lib/api-client.js';

const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const ROLE_LABEL: Record<OrgUser['role'], string> = { ADMIN: 'Admin', MEMBER: 'Membro' };

export function UsersTab({ organizationId }: { organizationId: string }) {
  const queryClient = useQueryClient();
  const key = ['org-users', organizationId];
  const { data, isLoading, error } = useQuery({
    queryKey: key, queryFn: () => backofficeApi.listUsers(organizationId),
  });
  const [form, setForm] = useState({ name: '', email: '', temporaryPassword: '' });
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: key }),
    queryClient.invalidateQueries({ queryKey: ['organization', organizationId] }),
  ]);
  const onError = (fallback: string) => (e: unknown) => setActionError(errorMessage(e, fallback));

  const create = useMutation({
    mutationFn: () => backofficeApi.createAdmin(organizationId, {
      name: form.name.trim(), email: form.email.trim(), temporaryPassword: form.temporaryPassword,
    }),
    onSuccess: async () => {
      setForm({ name: '', email: '', temporaryPassword: '' });
      setNotice('Admin criado. Informe a senha provisória ao cliente; ela será trocada no primeiro acesso.');
      await refresh();
    },
    onError: onError('Não foi possível criar o usuário'),
  });
  const deactivate = useMutation({
    mutationFn: (userId: string) => backofficeApi.deactivateUser(userId),
    onSuccess: refresh,
    onError: onError('Não foi possível desativar'),
  });
  const reset = useMutation({
    mutationFn: (userId: string) => backofficeApi.resetUserPassword(userId, resetPassword),
    onSuccess: async () => {
      setResetting(null);
      setResetPassword('');
      setNotice('Senha redefinida. O usuário precisará trocá-la no próximo acesso.');
      await refresh();
    },
    onError: onError('Não foi possível redefinir a senha'),
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    setActionError(null);
    setNotice(null);
    create.mutate();
  }

  if (isLoading) return <p>Carregando...</p>;
  if (error || !data) {
    return <p role="alert" className="text-red-600">{errorMessage(error, 'Não foi possível carregar os usuários')}</p>;
  }

  return (
    <div>
      {data.length === 0 ? <p className="mb-4 text-sm">Nenhum usuário</p> : (
        <table className="mb-4 w-full text-left text-sm">
          <thead>
            <tr>
              <th className="py-2 pr-3">Nome</th><th className="py-2 pr-3">E-mail</th>
              <th className="py-2 pr-3">Papel</th><th className="py-2 pr-3">Situação</th><th className="py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {data.map((u) => (
              <tr key={u.id} className="border-t" style={{ borderColor: 'var(--hairline)' }}>
                <td className="py-2 pr-3">{u.name}</td>
                <td className="py-2 pr-3">{u.email}</td>
                <td className="py-2 pr-3">{ROLE_LABEL[u.role]}</td>
                <td className="py-2 pr-3">
                  {u.active ? (u.mustChangePassword ? 'Ativo (troca de senha pendente)' : 'Ativo') : 'Inativo'}
                </td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-2">
                    {u.active && (
                      <button type="button" disabled={deactivate.isPending} className="rounded-md border px-2 py-1"
                        onClick={() => {
                          if (!window.confirm(`Desativar o usuário ${u.email}?`)) return;
                          setActionError(null);
                          setNotice(null);
                          deactivate.mutate(u.id);
                        }}>Desativar</button>
                    )}
                    <button type="button" className="rounded-md border px-2 py-1"
                      onClick={() => { setResetting(u.id); setResetPassword(''); setActionError(null); setNotice(null); }}>
                      Redefinir senha
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {resetting && (
        <form className="mb-4 flex items-end gap-2" onSubmit={(e) => {
          e.preventDefault();
          setActionError(null);
          reset.mutate(resetting);
        }}>
          <label className="text-sm">Nova senha provisória
            <input value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} minLength={12} required
              autoComplete="off" className="mt-1 block rounded-md border px-2 py-1" />
          </label>
          <button type="submit" disabled={reset.isPending} className="rounded-md border px-3 py-1 text-sm">Confirmar</button>
          <button type="button" className="rounded-md border px-3 py-1 text-sm"
            onClick={() => setResetting(null)}>Cancelar</button>
        </form>
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
        <label className="text-sm">Senha provisória
          <input value={form.temporaryPassword} minLength={12} required autoComplete="off"
            onChange={(e) => setForm({ ...form, temporaryPassword: e.target.value })}
            className="mt-1 block rounded-md border px-2 py-1" />
        </label>
        <button type="submit" disabled={create.isPending} className="rounded-md border px-3 py-1 text-sm">Criar Admin</button>
      </form>
    </div>
  );
}
