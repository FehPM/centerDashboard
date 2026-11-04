import { useMe } from '../../hooks/use-me.js';

const dateTimeFormat = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
});

/**
 * Aviso discreto nos módulos de commerce quando a última tentativa de sync
 * falhou. Não bloqueia nada: os dados já sincronizados continuam na tela.
 * A causa nunca aparece aqui (o detalhe fica com a Blan, no back-office) —
 * o servidor só manda `lastAttemptFailed` e `lastSyncedAt`.
 */
export function CommerceSyncNotice() {
  const { data: me } = useMe();
  const sync = me?.commerceSync;
  if (!sync?.lastAttemptFailed) return null;

  const until = sync.lastSyncedAt ? dateTimeFormat.format(new Date(sync.lastSyncedAt)) : null;
  return (
    <p
      role="status"
      className="rounded-md border px-3 py-2 text-sm"
      style={{ borderColor: 'var(--hairline)', backgroundColor: 'var(--surface-1)', color: 'var(--text-secondary)' }}
    >
      {until
        ? `Dados da loja atualizados até ${until}. A atualização mais recente não foi concluída e será tentada de novo automaticamente.`
        : 'Os dados da loja ainda não foram atualizados. Uma nova tentativa será feita automaticamente.'}
    </p>
  );
}
