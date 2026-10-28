# Evidências das ET04, ET05 e ET06 — Setores e escalas, pesquisas e pesquisa pública

Execução de 27/10/2026, branch local `feature/ET04-ET06-escalas-pesquisas-publica` (base `develop` em `047eab3`), **sem commit**. Ambiente: Windows 11, Node.js 22.22.3, Docker 29.8.2, PostgreSQL 17 em contêiner local descartável (`127.0.0.1:55432`), Chrome instalado (Playwright 1.63, `channel: chrome`). Na 1ª rodada o Supabase local não iniciou (portas 54321–54323 reservadas pelo Windows); na 2ª rodada, com as portas liberadas, `npm run db:start` subiu o Supabase local e a E2E completa (com login) foi executada. Somente dados fictícios; nenhum serviço remoto foi usado.

| Arquivo                          | Conteúdo                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend-testes-saida.txt`       | `vitest run` do backend (unidade, integração e PostgreSQL real): T05, T12–T17, T22–T26, T32, pesquisa pública e regressão                          |
| `backend-testes-junit.xml`       | relatório JUnit da mesma execução                                                                                                                  |
| `frontend-testes-saida.txt`      | `vitest run --maxWorkers=2` do frontend (componentes e fluxos)                                                                                     |
| `frontend-testes-junit.xml`      | relatório JUnit da mesma execução                                                                                                                  |
| `e2e-pesquisa-publica-saida.txt` | `pesquisa-publica.spec.ts` (T01, T03, T27, T28) em 1440 e 360 px, com configuração temporária sem Supabase Auth                                    |
| `e2e-supabase-local-saida.txt`   | `npm run test:e2e -w frontend` com Supabase local: 18/18 (T12, administração, escalas e pesquisas com T02/jsqr, pesquisa pública)                  |
| `telas/`                         | capturas da TL05–TL08 (1440 px) e da TL09 (pergunta geral em 360 e 1440 px; etapa de perguntas específicas) e TL11 (confirmação), geradas pela E2E |

Detalhes das regras e dos contratos: [`../../setores-escalas-e-pesquisas.md`](../../setores-escalas-e-pesquisas.md). Resultados, defeitos e pendências: [`../../plano-e-relatorio-de-testes.md`](../../plano-e-relatorio-de-testes.md#et04-et05-e-et06--execução-de-27102026).
