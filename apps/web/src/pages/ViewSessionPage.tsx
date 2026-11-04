import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthToken, setAuthToken } from '../lib/api-client.js';

/** Recebe o token da visualização no fragmento da URL (`#<jwt>`; não vai ao servidor nem a logs). */
export function ViewSessionPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // StrictMode roda o efeito duas vezes em dev; a 2ª leria o hash já limpo.
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const raw = window.location.hash.replace(/^#/, '');
    const token = raw.startsWith('token=') ? raw.slice('token='.length) : raw;
    if (token) {
      queryClient.clear();
      setAuthToken(token);
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    navigate(token || getAuthToken() ? '/' : '/login', { replace: true });
  }, [navigate, queryClient]);

  return <p role="status" className="p-6 text-sm">Abrindo visualização…</p>;
}
