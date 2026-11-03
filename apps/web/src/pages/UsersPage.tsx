import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, type ApiError, type UserView } from '../lib/api-client.js';
import { useMe } from '../hooks/use-me.js';
import { UserForm, type UserFormValues } from '../components/users/UserForm.js';

const NOTICE = 'Passe a senha provisória ao usuário. Ele vai trocá-la no primeiro acesso.';
const btn = 'rounded-md border px-2 py-0.5';

export function UsersPage() {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserView | null>(null);
  const [resetting, setResetting] = useState<UserView | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const users = useQuery<UserView[], ApiError>({ queryKey: ['users'], queryFn: () => apiClient.listUsers() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation<UserView, ApiError, UserFormValues>({
    mutationFn: (values) => apiClient.createUser(values),
    onSuccess: async () => { setNotice(true); setShowForm(false); await refresh(); },
  });
  const toggleActive = useMutation<UserView, ApiError, UserView>({
    mutationFn: (u) => apiClient.updateUser(u.id, { active: !u.active }),
    onSuccess: async () => { setActionError(null); await refresh(); },
    onError: (e) => setActionError(e.message),
  });
  const update = useMutation<UserView, ApiError, UserFormValues>({
    mutationFn: ({ name, role, modules }) => apiClient.updateUser(editing!.id, { name, role, modules }),
    onSuccess: async () => { setEditing(null); await refresh(); },
  });
  const reset = useMutation<void, ApiError, void>({
    mutationFn: () => apiClient.resetUserPassword(resetting!.id, newPassword),
    onSuccess: () => { setResetting(null); setNewPassword(''); setNotice(true); },
  });

  const labelOf = (key: string) => me?.modules.find((m) => m.key === key)?.label ?? key;

  function startEdit(u: UserView): void {
    setEditing(u); setResetting(null); setShowForm(false); setNotice(false); update.reset();
  }
  function startReset(u: UserView): void {
    setResetting(u); setEditing(null); setShowForm(false); setNotice(false); setNewPassword(''); reset.reset();
  }
  function submitReset(event: FormEvent): void {
    event.preventDefault();
    reset.mutate();
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Usuários</h1>
        <button type="button"
          onClick={() => { setShowForm((v) => !v); setEditing(null); setResetting(null); setNotice(false); create.reset(); }}
          className="rounded-md border px-3 py-1.5 text-sm">
          Novo usuário
        </button>
      </div>

      {notice && <p role="status" className="text-sm">{NOTICE}</p>}
      {actionError && <p role="alert" className="text-sm" style={{ color: 'var(--critical)' }}>{actionError}</p>}

      {showForm && (
        <UserForm
          modules={me?.modules ?? []}
          pending={create.isPending}
          error={create.error ? create.error.message : null}
          onSubmit={(values) => create.mutate(values)}
        />
      )}

      {editing && (
        <div className="space-y-2">
          <h2 className="text-sm font-medium">Editar {editing.name}</h2>
          <UserForm
            key={editing.id}
            modules={me?.modules ?? []}
            initial={{ name: editing.name, role: editing.role, modules: editing.modules }}
            pending={update.isPending}
            error={update.error ? update.error.message : null}
            onSubmit={(values) => update.mutate(values)}
          />
        </div>
      )}

      {resetting && (
        <form onSubmit={submitReset} className="space-y-2 rounded-lg border p-4"
          style={{ backgroundColor: 'var(--surface-1)', borderColor: 'var(--hairline)' }}>
          <label htmlFor="reset-password" className="block text-sm">
            Nova senha provisória para {resetting.name}
          </label>
          <input id="reset-password" type="text" value={newPassword} minLength={12} required
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
            style={{ borderColor: 'var(--hairline)', backgroundColor: 'var(--page-plane)', color: 'var(--text-primary)' }} />
          {reset.error && <p role="alert" className="text-sm" style={{ color: 'var(--critical)' }}>{reset.error.message}</p>}
          <button type="submit" disabled={reset.isPending}
            className="rounded-md bg-accent px-3 py-2 text-white disabled:opacity-60">
            Redefinir
          </button>
        </form>
      )}

      {users.isLoading ? <p role="status" className="text-sm">Carregando…</p> : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Ativo</th><th>Módulos</th><th /></tr>
          </thead>
          <tbody>
            {(users.data ?? []).map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.role === 'ADMIN' ? 'Admin' : 'Membro'}</td>
                <td>{u.active ? 'Sim' : 'Não'}</td>
                <td>{u.role === 'ADMIN' ? 'Todos' : u.modules.map(labelOf).join(', ') || '—'}</td>
                <td className="space-x-1">
                  <button type="button" aria-label={`Editar ${u.name}`} onClick={() => startEdit(u)} className={btn}>Editar</button>
                  <button type="button" aria-label={`Redefinir senha de ${u.name}`} onClick={() => startReset(u)} className={btn}>Redefinir senha</button>
                  <button type="button" aria-label={`${u.active ? 'Desativar' : 'Reativar'} ${u.name}`}
                    onClick={() => toggleActive.mutate(u)} className={btn}>
                    {u.active ? 'Desativar' : 'Reativar'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
