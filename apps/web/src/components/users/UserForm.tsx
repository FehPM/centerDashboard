import { useState, type FormEvent } from 'react';
import type { ModuleView } from '../../lib/api-client.js';

export interface UserFormValues {
  name: string; email: string; role: 'ADMIN' | 'MEMBER'; temporaryPassword: string; modules: string[];
}

const inputClass = 'w-full rounded-md border px-3 py-2';
const inputStyle = { borderColor: 'var(--hairline)', backgroundColor: 'var(--page-plane)', color: 'var(--text-primary)' };

export function UserForm({ modules, onSubmit, pending, error, initial }: {
  modules: ModuleView[];
  /** Presente = modo edição: sem e-mail nem senha. */
  initial?: { name: string; role: 'ADMIN' | 'MEMBER'; modules: string[] };
  onSubmit: (values: UserFormValues) => void;
  pending: boolean;
  error: string | null;
}) {
  const editing = initial !== undefined;
  const [name, setName] = useState(initial?.name ?? '');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>(initial?.role ?? 'MEMBER');
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [selected, setSelected] = useState<string[]>(initial?.modules ?? []);

  function toggle(key: string): void {
    setSelected((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onSubmit({ name, email, role, temporaryPassword, modules: role === 'ADMIN' ? [] : selected });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border p-4"
      style={{ backgroundColor: 'var(--surface-1)', borderColor: 'var(--hairline)' }}>
      <div className="space-y-1">
        <label htmlFor="user-name" className="block text-sm">Nome</label>
        <input id="user-name" value={name} onChange={(e) => setName(e.target.value)} required
          className={inputClass} style={inputStyle} />
      </div>
      {!editing && (
        <div className="space-y-1">
          <label htmlFor="user-email" className="block text-sm">E-mail</label>
          <input id="user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
            className={inputClass} style={inputStyle} />
        </div>
      )}
      <div className="space-y-1">
        <label htmlFor="user-role" className="block text-sm">Papel</label>
        <select id="user-role" value={role} onChange={(e) => setRole(e.target.value as 'ADMIN' | 'MEMBER')}
          className={inputClass} style={inputStyle}>
          <option value="MEMBER">Membro</option>
          <option value="ADMIN">Admin</option>
        </select>
      </div>
      {!editing && (
        <div className="space-y-1">
          <label htmlFor="user-password" className="block text-sm">Senha provisória</label>
          <input id="user-password" type="text" value={temporaryPassword} minLength={12} required
            onChange={(e) => setTemporaryPassword(e.target.value)} className={inputClass} style={inputStyle} />
        </div>
      )}
      {role === 'MEMBER' && (
        <fieldset className="space-y-1">
          <legend className="text-sm">Módulos</legend>
          {modules.map((m) => (
            <label key={m.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selected.includes(m.key)} onChange={() => toggle(m.key)} />
              {m.label}
            </label>
          ))}
        </fieldset>
      )}
      {error ? <p role="alert" className="text-sm" style={{ color: 'var(--critical)' }}>{error}</p> : null}
      <button type="submit" disabled={pending}
        className="rounded-md bg-accent px-3 py-2 text-white disabled:opacity-60">
        {editing ? (pending ? 'Salvando…' : 'Salvar') : (pending ? 'Criando…' : 'Criar usuário')}
      </button>
    </form>
  );
}
