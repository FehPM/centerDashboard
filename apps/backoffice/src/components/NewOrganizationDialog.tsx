import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError, backofficeApi, type OrganizationItem } from '../lib/api-client.js';

export function NewOrganizationDialog({ onCreated, onCancel }: {
  onCreated: (org: OrganizationItem) => void; onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => backofficeApi.createOrganization({
      name: name.trim(), ...(slug.trim() ? { slug: slug.trim() } : {}),
    }),
    onSuccess: onCreated,
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Não foi possível criar o cliente'),
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    mutation.mutate();
  }

  return (
    <form onSubmit={submit} className="mb-6 max-w-md space-y-3 rounded-md border p-4"
      style={{ borderColor: 'var(--hairline)' }}>
      <label className="block text-sm">Nome
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={120}
          className="mt-1 block w-full rounded-md border px-2 py-1" />
      </label>
      <label className="block text-sm">Slug (opcional)
        <input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={60}
          className="mt-1 block w-full rounded-md border px-2 py-1" />
      </label>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={mutation.isPending} className="rounded-md border px-3 py-1 text-sm">Criar</button>
        <button type="button" onClick={onCancel} className="rounded-md border px-3 py-1 text-sm">Cancelar</button>
      </div>
    </form>
  );
}
