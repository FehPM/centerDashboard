# Rodar o projeto localmente

O roteiro completo fica num lugar só, no [README da raiz](../README.md#rodar-o-projeto-localmente),
para as duas cópias não divergirem. Atalhos:

- [Parte 1 — Painel](../README.md#parte-1--painel): `.env`, carga do `.env` no
  bash e no PowerShell, migração, seed, dados de demonstração, API e sync worker.
- [Banco local de antes do multi-tenant](../README.md#banco-local-de-antes-do-multi-tenant):
  backup, `migrate-to-multitenant` e a migração que remove as colunas antigas.
- [Parte 2 — Back-office e roteiro manual](../README.md#parte-2--back-office-e-roteiro-manual):
  TOTP (cadastro e recuperação em dev), cliente, módulos, integrações, Admin,
  Membro, token para `curl`/`Invoke-RestMethod` e "Visualizar painel".
- [Rodar os testes](../README.md#rodar-os-testes): banco `center_test` separado,
  nunca o de dev.
- [Problemas comuns](../README.md#problemas-comuns).

Design da arquitetura multi-tenant e modular em
[`superpowers/specs/2026-10-29-multi-tenant-modular-design.md`](superpowers/specs/2026-10-29-multi-tenant-modular-design.md);
regras para quem desenvolve no [`CLAUDE.md`](../CLAUDE.md).
