// Trava de segurança das suítes que gravam num Postgres real
// (mcp-commerce, mcp-quality, mcp-sprint). Elas criam clientes `org_test_*` e
// apagam os dados deles a cada teste; rodar isso contra o banco de dev polui o
// back-office e quebra de forma confusa se o schema de dev estiver atrasado.
//
// Regra: o nome do banco em DATABASE_URL precisa terminar em `_test`
// (ex.: center_test, como no CI). Sem isso, a suíte nem começa.
function assertTestDatabase(databaseUrl) {
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL não definida. As suítes com banco precisam de um banco de TESTE ' +
        '(ex.: postgresql://center:center@localhost:5432/center_test). Veja "Rodar os testes" no README.',
    );
  }
  let name;
  try {
    name = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL inválida: não foi possível ler o nome do banco.');
  }
  if (!name.endsWith('_test')) {
    throw new Error(
      `Recusado: DATABASE_URL aponta para o banco "${name}", e as suítes com banco só rodam ` +
        'contra um banco cujo nome termina em "_test" (ex.: center_test). Nunca rode os testes ' +
        'contra o banco de dev. Veja "Rodar os testes" no README.',
    );
  }
}

module.exports = { assertTestDatabase };
