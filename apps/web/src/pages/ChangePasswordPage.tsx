import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient, setAuthToken } from '../lib/api-client.js';
import { useAuth } from '../hooks/use-auth.js';

const inputClass = 'w-full rounded-md border px-3 py-2';
const inputStyle = { borderColor: 'var(--hairline)', backgroundColor: 'var(--page-plane)', color: 'var(--text-primary)' };

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => apiClient.changePassword(current, next),
    onSuccess: async (result) => {
      // O token antigo deixou de valer com a troca; o novo veio na resposta.
      if (result?.token) setAuthToken(result.token);
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    },
  });

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    if (next.length < 12) { setLocalError('A nova senha precisa ter no mínimo 12 caracteres.'); return; }
    if (next !== confirm) { setLocalError('A confirmação precisa ser igual à nova senha.'); return; }
    if (next === current) { setLocalError('A nova senha precisa ser diferente da senha atual.'); return; }
    setLocalError(null);
    mutation.mutate();
  }

  const error = localError ?? (mutation.error ? mutation.error.message : null);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg border p-6"
        style={{ backgroundColor: 'var(--surface-1)', borderColor: 'var(--hairline)' }}>
        <h1 className="text-xl font-semibold">Trocar senha</h1>
        <div className="space-y-1">
          <label htmlFor="current" className="block text-sm">Senha atual</label>
          <input id="current" type="password" value={current} autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)} className={inputClass} style={inputStyle} />
        </div>
        <div className="space-y-1">
          <label htmlFor="next" className="block text-sm">Nova senha</label>
          <input id="next" type="password" value={next} autoComplete="new-password"
            onChange={(e) => setNext(e.target.value)} className={inputClass} style={inputStyle} />
        </div>
        <div className="space-y-1">
          <label htmlFor="confirm" className="block text-sm">Confirmar nova senha</label>
          <input id="confirm" type="password" value={confirm} autoComplete="new-password"
            onChange={(e) => setConfirm(e.target.value)} className={inputClass} style={inputStyle} />
        </div>
        {error ? <p role="alert" className="text-sm" style={{ color: 'var(--critical)' }}>{error}</p> : null}
        <button type="submit" disabled={mutation.isPending}
          className="w-full rounded-md bg-accent px-3 py-2 text-white disabled:opacity-60">
          {mutation.isPending ? 'Salvando…' : 'Trocar senha'}
        </button>
        <button type="button" onClick={() => { logout(); navigate('/login', { replace: true }); }}
          className="w-full rounded-md border px-3 py-2 text-sm">
          Sair
        </button>
      </form>
    </div>
  );
}
