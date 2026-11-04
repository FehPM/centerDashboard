import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiError, absoluteApiUrl, backofficeApi, type IntegrationKind, type IntegrationUpdate, type IntegrationView,
  type LlmUsage,
} from '../lib/api-client.js';

const TZ = 'America/Sao_Paulo';

interface KindDef {
  kind: IntegrationKind;
  /** Deve ser igual a `ALLOWED_PROVIDERS[kind]` da API. */
  provider: string;
  label: string;
  /** Campos de `config`; `optional` é omitido do corpo quando vazio. */
  fields: Array<{ name: string; optional?: boolean; options?: Array<{ value: string; label: string }> }>;
  secrets: string[];
  /** COMMERCE: `statusMapping` como JSON opcional. */
  statusMapping?: boolean;
  /** Tipos GA4 mostram a service account da Blan. */
  ga4?: boolean;
  canCheck?: boolean;
}

const KINDS: KindDef[] = [
  { kind: 'COMMERCE', provider: 'UAPPI', label: 'E-commerce (Uappi)', fields: [], secrets: ['apiKey', 'secretKey'], statusMapping: true, canCheck: true },
  { kind: 'WEB_ANALYTICS', provider: 'GA4', label: 'Web (GA4)', fields: [{ name: 'propertyId' }, { name: 'bigQueryDataset', optional: true }], secrets: [], ga4: true },
  { kind: 'APP_ANALYTICS', provider: 'GA4', label: 'App (GA4)', fields: [{ name: 'propertyId' }], secrets: [], ga4: true },
  { kind: 'PLAY_STORE', provider: 'GOOGLE_PLAY', label: 'Play Store', fields: [{ name: 'packageName' }], secrets: ['credentialsJson'] },
  { kind: 'APP_STORE', provider: 'APP_STORE_CONNECT', label: 'App Store', fields: [{ name: 'appId' }], secrets: ['keyJson'] },
  { kind: 'SPRINT_BOARD', provider: 'MONDAY', label: 'Sprint (Monday)', fields: [{ name: 'boardId' }], secrets: [] },
  {
    kind: 'LLM', provider: 'ANTHROPIC', label: 'IA do assistente',
    fields: [
      {
        name: 'mode',
        options: [
          { value: 'MANAGED', label: 'Gerenciada pela Blan (cobrada pelo uso)' },
          { value: 'OWN', label: 'Chave própria do cliente (sem cobrança de tokens)' },
        ],
      },
      { name: 'label' },
      { name: 'model', optional: true },
    ],
    secrets: ['apiKey'],
  },
];

const STATUS_LABEL: Record<IntegrationView['status'], string> = {
  PENDING: 'Pendente', OK: 'OK', ERROR: 'Com erro', DISABLED: 'Desativada',
};

const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: TZ });
const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });

const errorMessage = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

const tokens = new Intl.NumberFormat('pt-BR');

/** Consumo do mês, por chave. Só o modo "Gerenciada" entra na cobrança. */
function LlmUsagePanel({ organizationId }: { organizationId: string }) {
  const { data } = useQuery<LlmUsage>({
    queryKey: ['llm-usage', organizationId],
    queryFn: () => backofficeApi.getLlmUsage(organizationId),
  });
  if (!data) return null;
  return (
    <div className="my-2 text-sm" aria-label="Consumo de IA no mês">
      <p>
        Consumo de {formatDate(`${data.from}T12:00:00-03:00`)} a {formatDate(`${data.to}T12:00:00-03:00`)}:
        {' '}{tokens.format(data.totals.inputTokens + data.totals.outputTokens)} tokens em {data.totals.messages} respostas
      </p>
      {data.byKey.length > 0 && (
        <ul className="list-disc pl-5">
          {data.byKey.map((r) => (
            <li key={`${r.mode}|${r.keyLabel}`}>
              {r.keyLabel} — {r.mode === 'MANAGED' ? 'cobrável' : 'chave do cliente'}:{' '}
              {tokens.format(r.inputTokens)} entrada + {tokens.format(r.outputTokens)} saída
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IntegrationCard({ organizationId, def, row }: {
  organizationId: string; def: KindDef; row: IntegrationView | undefined;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(def.fields.map((f) => [f.name, String(row?.config[f.name] ?? '')])));
  const [mapping, setMapping] = useState(() =>
    row?.config.statusMapping ? JSON.stringify(row.config.statusMapping, null, 2) : '');
  // Segredos nunca vêm preenchidos: só guardam o que o operador digitar.
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const onDone = (saved: IntegrationView) => {
    queryClient.setQueryData<IntegrationView[]>(['integrations', organizationId], (old = []) =>
      old.some((r) => r.kind === saved.kind)
        ? old.map((r) => (r.kind === saved.kind ? saved : r))
        : [...old, saved]);
    void queryClient.invalidateQueries({ queryKey: ['organization', organizationId] });
    void queryClient.invalidateQueries({ queryKey: ['organizations'] });
  };

  const save = useMutation({
    mutationFn: (body: IntegrationUpdate) => backofficeApi.saveIntegration(organizationId, def.kind, body),
    onSuccess: (saved) => {
      // Reidrata o formulário só após o salvamento do próprio operador.
      setSecrets({});
      setValues(Object.fromEntries(def.fields.map((f) => [f.name, String(saved.config[f.name] ?? '')])));
      setMapping(saved.config.statusMapping ? JSON.stringify(saved.config.statusMapping, null, 2) : '');
      onDone(saved);
    },
    onError: (e) => setError(errorMessage(e, 'Não foi possível salvar')),
  });
  const check = useMutation({
    mutationFn: () => backofficeApi.checkIntegration(organizationId, def.kind),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e, 'Não foi possível testar')),
  });
  const disable = useMutation({
    mutationFn: () => backofficeApi.disableIntegration(organizationId, def.kind),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e, 'Não foi possível desativar')),
  });
  const busy = save.isPending || check.isPending || disable.isPending;

  function submit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    const config: Record<string, unknown> = {};
    for (const f of def.fields) {
      const value = (values[f.name] ?? '').trim();
      if (value || !f.optional) config[f.name] = value;
    }
    if (def.statusMapping && mapping.trim()) {
      try {
        const parsed: unknown = JSON.parse(mapping);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
        config.statusMapping = parsed;
      } catch {
        setError('statusMapping precisa ser um JSON de objeto válido');
        return;
      }
    }
    const typed = Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== ''));
    // A API não mescla segredos: trocar um exige reenviar todos do tipo.
    if (Object.keys(typed).length > 0 && Object.keys(typed).length < def.secrets.length) {
      setError(`Para trocar as credenciais, informe ${def.secrets.join(' e ')}`);
      return;
    }
    save.mutate({
      provider: def.provider, config,
      ...(Object.keys(typed).length ? { secrets: typed } : {}),
    });
  }

  const statusText = row ? STATUS_LABEL[row.status] : 'Não configurada';
  const placeholder = row?.secretsConfigured && row.secretsUpdatedAt
    ? `Configurado em ${formatDate(row.secretsUpdatedAt)} — deixe ${def.secrets.length > 1 ? 'todos ' : ''}em branco para manter`
    : undefined;

  return (
    <fieldset className="mb-4 rounded-md border p-4" style={{ borderColor: 'var(--hairline)' }}>
      <legend className="px-1 font-semibold">{def.label}</legend>
      <p className="text-sm">Status: {statusText}</p>
      {row?.lastError && <p className="text-sm text-red-600">Último erro: {row.lastError}</p>}
      {def.kind === 'COMMERCE' && row && (
        <>
          <p className="text-sm">
            Última sincronização: {row.lastSyncedAt ? formatDateTime(row.lastSyncedAt) : 'nunca'}
          </p>
          {row.syncError && <p className="text-sm text-red-600">Erro de sincronização: {row.syncError}</p>}
        </>
      )}
      {def.kind === 'LLM' && row?.keyHint && <p className="text-sm">Chave atual: {row.keyHint}</p>}
      {def.kind === 'LLM' && <LlmUsagePanel organizationId={organizationId} />}
      {def.ga4 && row?.serviceAccountEmail && (
        <p className="text-sm">Conceda acesso à propriedade para: <strong>{row.serviceAccountEmail}</strong></p>
      )}
      <form className="mt-3 flex flex-col gap-2" onSubmit={submit}>
        {def.fields.map((f) => (
          <label key={f.name} className="text-sm">{f.name}
            {f.options ? (
              <select value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                className="mt-1 block w-full rounded-md border px-2 py-1">
                <option value="" disabled>Selecione</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input value={values[f.name] ?? ''} onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                className="mt-1 block w-full rounded-md border px-2 py-1" />
            )}
          </label>
        ))}
        {def.statusMapping && (
          <label className="text-sm">statusMapping (JSON)
            <textarea value={mapping} onChange={(e) => setMapping(e.target.value)} rows={3}
              className="mt-1 block w-full rounded-md border px-2 py-1 font-mono" />
          </label>
        )}
        {def.secrets.map((name) => (
          <label key={name} className="text-sm">{name}
            <input type="password" autoComplete="new-password" value={secrets[name] ?? ''}
              placeholder={placeholder}
              onChange={(e) => { setError(null); setSecrets({ ...secrets, [name]: e.target.value }); }}
              className="mt-1 block w-full rounded-md border px-2 py-1" />
          </label>
        ))}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy} className="rounded-md border px-3 py-1 text-sm">Salvar</button>
          {def.canCheck && row && (
            <button type="button" disabled={busy} className="rounded-md border px-3 py-1 text-sm"
              onClick={() => { setError(null); check.mutate(); }}>Testar</button>
          )}
          {row && row.status !== 'DISABLED' && (
            <button type="button" disabled={busy} className="rounded-md border px-3 py-1 text-sm"
              onClick={() => {
                if (!window.confirm(`Desativar a integração ${def.label}?`)) return;
                setError(null);
                disable.mutate();
              }}>Desativar</button>
          )}
        </div>
      </form>
    </fieldset>
  );
}

/** Snippet de `docs/checkout-attribution.md`; o script é servido na origem da API. */
function AttributionSnippet({ organizationId }: { organizationId: string }) {
  const [copied, setCopied] = useState(false);
  const apiUrl = absoluteApiUrl();
  const snippet = [
    '<script>',
    '  window.CENTER_ATTRIBUTION = {',
    `    apiUrl: '${apiUrl}',`,
    `    organizationId: '${organizationId}'`,
    '  };',
    '</script>',
    `<script src="${apiUrl}/center-attribution.js" defer></script>`,
  ].join('\n');

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section aria-label="Script de atribuição" className="mt-6">
      <h3 className="mb-1 font-semibold">Script de atribuição</h3>
      <p className="mb-2 text-sm">Cole antes de &lt;/body&gt; no site da loja, depois da tag do Google Analytics.</p>
      <pre data-testid="attribution-snippet" className="overflow-x-auto rounded-md border p-3 text-xs"
        style={{ borderColor: 'var(--hairline)' }}>{snippet}</pre>
      <button type="button" onClick={() => void copy()} className="mt-2 rounded-md border px-3 py-1 text-sm">Copiar</button>
      {copied && <span role="status" className="ml-2 text-sm">Copiado</span>}
    </section>
  );
}

export function IntegrationsTab({ organizationId }: { organizationId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['integrations', organizationId],
    queryFn: () => backofficeApi.listIntegrations(organizationId),
  });
  if (isLoading) return <p>Carregando...</p>;
  if (error || !data) {
    return <p role="alert" className="text-red-600">{errorMessage(error, 'Não foi possível carregar as integrações')}</p>;
  }
  const byKind = new Map(data.map((r) => [r.kind, r]));
  return (
    <div>
      {KINDS.map((def) => {
        const row = byKind.get(def.kind);
        return <IntegrationCard key={def.kind}
          organizationId={organizationId} def={def} row={row} />;
      })}
      <AttributionSnippet organizationId={organizationId} />
    </div>
  );
}
