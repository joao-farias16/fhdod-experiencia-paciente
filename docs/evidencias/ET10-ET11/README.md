# Evidências — ET10 e ET11 (12/11/2026)

Execuções registradas em [`../../plano-e-relatorio-de-testes.md`](../../plano-e-relatorio-de-testes.md):
1ª rodada (API) e 2ª rodada (TL15 no frontend, E2E e integração).

## 1ª rodada — API (E42)

| Arquivo                      | Conteúdo                                                                                             |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `e42-api-compilada-seed.txt` | E42 na API compilada (`npm start`) com o seed de demonstração: corpo, cabeçalhos, tempos, 400 e 429  |
| `t33-reinicio-local.txt`     | T33 local: resposta registrada pelo E02, API reiniciada, linha presente no MySQL e E42 com o mesmo n |

## 2ª rodada — frontend, E2E e integração

| Arquivo                        | Conteúdo                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend-testes-saida.txt`     | `npm test` da API (unidade, integração e MySQL real), repetido após a mudança do `e2e:fixture`: 30 arquivos, **771 aprovados**                              |
| `backend-testes-junit.xml`     | JUnit da mesma execução (771 testes, 0 falhas, 0 erros)                                                                                                     |
| `frontend-testes-saida.txt`    | `vitest run` do frontend (componentes e unidade): 19 arquivos, **135 aprovados**                                                                            |
| `frontend-testes-junit.xml`    | JUnit da mesma execução (135 testes, 0 falhas, 0 erros)                                                                                                     |
| `e2e-chrome-saida.txt`         | Playwright, projetos `computador-1440`, `celular-360` e `tv-1920` (Chrome): **42 aprovados**, 8 ignorados por projeto, 0 falhas                             |
| `e2e-chrome-junit.xml`         | JUnit da mesma execução (50 casos)                                                                                                                          |
| `e2e-firefox-webkit-saida.txt` | Playwright, projetos `firefox-1440` e `webkit-390`: **28 aprovados**, 6 ignorados por projeto, 0 falhas                                                     |
| `e2e-navegadores-junit.xml`    | JUnit da mesma execução (34 casos)                                                                                                                          |
| `axe-<projeto>.json`           | T39: resultado do axe (WCAG 2.0/2.1/2.2 A e AA) nas 22 telas auditadas, por projeto — 0 violações em todos                                                  |
| `t40-desempenho.json`          | T40: tempos (ms) dos 20 envios e dos 20 carregamentos do painel                                                                                             |
| `telas/TL15-*.png`             | capturas da TV Wall feitas pela E2E: sem respostas, total suprimido, setor com 4 ausente, tela normal (360, 1440, 1920, Firefox, WebKit) e API indisponível |

Ambiente: Windows 10 Pro, Node.js 24.15.0, Chrome instalado e Firefox/WebKit do Playwright 1.63;
MySQL Community 8.0.46 descartável em `127.0.0.1:33306` (só testes; o MySQL local da porta 3306 não
foi usado). Somente dados fictícios. Alterações ainda sem commit nos dois repositórios
(API: base `8015f9c`; frontend: base `6375032`, branch `develop`).
