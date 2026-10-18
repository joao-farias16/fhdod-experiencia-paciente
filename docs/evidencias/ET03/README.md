# Evidências da ET03 — Autenticação e permissões

Execução de 18/10/2026, branch local `feature/ET03-autenticacao-permissoes` (base `develop` em `c30d91d`), **sem commit**. Ambiente: Windows 11, Node.js 22.22.3, Docker 29.8.2, Supabase CLI 2.121.0 (PostgreSQL 17 em `127.0.0.1:54322`, Auth em `127.0.0.1:54321`), Chrome instalado (Playwright 1.63, `channel: chrome`). Somente dados fictícios; nenhum serviço remoto foi usado.

| Arquivo                            | Conteúdo                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `backend-testes-saida.txt`         | `vitest run --coverage` do backend (unidade, integração e PostgreSQL real), com cobertura          |
| `backend-testes-junit.xml`         | relatório JUnit da mesma execução                                                                  |
| `backend-supabase-local-saida.txt` | `npm run test:supabase -w backend` — T12, T13 e T16 contra o Supabase Auth local real              |
| `frontend-testes-saida.txt`        | `vitest run --coverage` do frontend (componentes e fluxos), com cobertura                          |
| `frontend-testes-junit.xml`        | relatório JUnit da mesma execução                                                                  |
| `e2e-playwright-saida.txt`         | `npx playwright test` — T12 (1440 px e 360 px) e fluxo administrativo TL16 → TL02 → TL17           |
| `telas/`                           | capturas das telas TL01, TL02, TL16 e TL17 geradas pelo E2E (contas fictícias, excluídas ao final) |

## Mapa dos testes T12–T17

| Teste | Arquivos                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T12   | `backend/tests/db/t12-autenticacao.test.ts`, `backend/tests/supabase/auth-supabase-local.test.ts`, `frontend/src/features/auth/auth-flow.test.tsx`, `frontend/e2e/t12-autenticacao.spec.ts` |
| T13   | `backend/tests/db/t13-senha.test.ts`, `backend/tests/supabase/…`, `frontend/src/features/auth/ChangePasswordPage.test.tsx`, `frontend/e2e/administracao.spec.ts`                            |
| T14   | `backend/tests/db/t14-permissoes.test.ts` (matriz completa 45 × 5 + chamadas diretas a E04–E10 e E41 com 6 perfis)                                                                          |
| T15   | `backend/tests/db/t15-escopo-setor.test.ts`                                                                                                                                                 |
| T16   | `backend/tests/db/t16-bloqueio-conta.test.ts`, `backend/tests/supabase/…`, `frontend/e2e/administracao.spec.ts`                                                                             |
| T17   | `backend/tests/db/t17-auditoria.test.ts`, `frontend/src/features/audit/AuditPage.test.tsx`, `frontend/e2e/administracao.spec.ts`                                                            |

Resultados e defeitos: [`../../plano-e-relatorio-de-testes.md`](../../plano-e-relatorio-de-testes.md#et03--execução-de-18102026).
