export function AwaitingSetup({ label }: { label: string }) {
  return (
    <section
      className="rounded-lg border p-6"
      style={{ backgroundColor: 'var(--surface-1)', borderColor: 'var(--hairline)' }}
    >
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</h2>
      <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        A equipe Blan está configurando as integrações deste módulo.
      </p>
    </section>
  );
}
