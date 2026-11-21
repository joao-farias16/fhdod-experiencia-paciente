# TV Wall — E42 (ET10)

Indicadores agregados do hospital para a tela pública TL15 (`/tv` no frontend): RF68–RF72, RN09,
RN21, endpoint E42 e testes T29–T31 da especificação.

- **Backend:** implementado neste repositório (`src/modules/tv-wall/`).
- **Frontend:** TL15 implementada no repositório `fhdod-frontend` (rota `/tv`,
  `src/features/tv-wall/`; documentação em `docs/tv-wall.md` daquele repositório), consumindo
  somente este contrato. Verificada ponta a ponta contra esta API em 12/11/2026.

## Contrato do E42

| Item         | Valor                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------- |
| Método e URL | `GET /api/v1/tv-wall/summary`                                                            |
| Acesso       | público: sem login, sem cookies; um `Authorization` enviado é ignorado                   |
| Parâmetros   | `period` = `7d`, `30d` ou `90d` (opcional; padrão `30d`). Qualquer outro parâmetro → 400 |
| Cache        | `200` com `Cache-Control: public, max-age=60`; erros com `Cache-Control: no-store`       |
| Limite       | 30 requisições por minuto por IP (Seção 10); acima disso, 429 com `Retry-After`          |
| CORS         | somente as origens de `CORS_ORIGIN` (a mesma do frontend)                                |

O período é de dias locais (America/Sao_Paulo) **inclusivos e terminando hoje**: `7d` = hoje e os 6
dias anteriores; `30d` e `90d`, idem.

### Resposta 200

```json
{
  "data": {
    "period": { "key": "7d", "from": "2026-11-05", "to": "2026-11-11" },
    "generatedAt": "2026-11-12T01:04:59.033Z",
    "suppressionThreshold": 5,
    "overall": {
      "n": 118,
      "nps": 37.3,
      "promotersPercent": 57.6,
      "detractorsPercent": 20.3,
      "suppressed": false
    },
    "trend": {
      "granularity": "day",
      "points": [
        { "start": "2026-11-05", "end": "2026-11-05", "n": 21, "nps": 23.8, "suppressed": false },
        { "start": "2026-11-11", "end": "2026-11-11", "n": 0, "nps": null, "suppressed": false }
      ]
    },
    "sectors": [
      {
        "name": "Internação Clínica",
        "n": 20,
        "nps": 70,
        "promotersPercent": 70,
        "detractorsPercent": 0
      }
    ]
  }
}
```

(Exemplo real, encurtado, da API compilada com o seed de demonstração em 12/11/2026.)

| Campo                               | Tipo                     | Regra                                                                                                              |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `period.key`                        | `"7d" \| "30d" \| "90d"` | período efetivo                                                                                                    |
| `period.from`, `period.to`          | `string` (AAAA-MM-DD)    | datas locais inclusivas                                                                                            |
| `generatedAt`                       | `string` (ISO 8601 UTC)  | instante do cálculo; muda a cada consulta (não há cache no servidor)                                               |
| `suppressionThreshold`              | `5`                      | mínimo de respostas para um valor ser exibido (RN21); use no aviso "menos de 5 respostas"                          |
| `overall.n`                         | `number \| null`         | respostas consideradas; `null` quando suprimido                                                                    |
| `overall.nps`                       | `number \| null`         | NPS (RN03), uma casa decimal, −100 a 100; `null` sem respostas ou suprimido                                        |
| `overall.promotersPercent`          | `number \| null`         | % de promotores (9–10), uma casa                                                                                   |
| `overall.detractorsPercent`         | `number \| null`         | % de detratores (0–6), uma casa                                                                                    |
| `overall.suppressed`                | `boolean`                | `true` quando o total tem de 1 a 4 respostas: todos os valores de `overall` vêm `null` (RF71)                      |
| `trend.granularity`                 | `"day" \| "week"`        | `day` para 7d e 30d (7 e 30 pontos); `week` para 90d (13 pontos, o último pode ter menos de 7 dias)                |
| `trend.points[]`                    | lista                    | um ponto por intervalo, contíguos e sem lacunas (RF59); `start`/`end` inclusivos                                   |
| `trend.points[].n` / `.nps`         | `number \| null`         | 0 respostas → `n: 0`, `nps: null`, `suppressed: false`; 1 a 4 → `n: null`, `nps: null`, `suppressed: true`         |
| `sectors[]`                         | lista (0 a 8 itens)      | só setores com **5 ou mais** respostas no período; ordem: maior NPS primeiro, empate pelo nome; no máximo 8 (RF68) |
| `sectors[].name`                    | `string`                 | nome do setor (nunca id, código, equipe ou turno)                                                                  |
| `sectors[].n`, `.nps`, `...Percent` | `number`                 | nunca nulos (o setor só aparece com n ≥ 5)                                                                         |

Nenhum outro campo existe. A resposta passa por um esquema Zod estrito (`tvWallSummarySchema`) antes
de sair: um campo fora da lista gera 500 em vez de chegar à tela.

### Erros

Formato padrão `{ "error": { "code", "message", "details", "requestId" } }`, sempre com
`Cache-Control: no-store`.

| HTTP | `code`                | Quando                                                                              |
| ---- | --------------------- | ----------------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`    | `period` fora de `7d`/`30d`/`90d`, repetido, ou parâmetro desconhecido              |
| 429  | `RATE_LIMITED`        | mais de 30 requisições por minuto pelo mesmo IP; cabeçalho `Retry-After` (segundos) |
| 503  | `SERVICE_UNAVAILABLE` | MySQL indisponível, ou hospital da TV Wall não definido (ver configuração)          |
| 500  | `INTERNAL_ERROR`      | falha inesperada (sem detalhes internos)                                            |

### Comportamento do frontend (RF69, RF70) — implementado na TL15

O que a especificação define para a TL15 e como o frontend (`fhdod-frontend`) atende:

- consulta o E42 a cada 60 s (sem consultar antes de os dados terem 60 s) e recarrega a página a
  cada 6 h — adiando a recarga enquanto a API estiver fora, para não apagar os últimos dados;
- em falha (rede, 429, 503, 500 ou resposta fora do contrato), **mantém os últimos dados válidos**
  e mostra o aviso "Sem conexão com o servidor"; a API responde erros com `no-store` justamente
  para que uma falha nunca substitua o último 200;
- com `overall.suppressed` mostra "Menos de 5 respostas"; com `nps: null` e `n: 0`, "Sem respostas
  no período" — nunca NPS 0; setores e pontos ausentes ou nulos não são reconstruídos;
- rota sem menu e sem nenhum link, fora dos layouts do sistema, sem sessão e sem chamar endpoints
  autenticados (RF72); só os campos desta lista são copiados para a tela;
- 1920 × 1080 sem rolagem: NPS com 160 px, números 64 px, rótulos 32 px, mínimo 24 px e todo texto
  com contraste de 7:1 ou mais (RF70, RNF06), medidos no DOM pela E2E.

Sugestão de tipos (TypeScript) para o frontend, idênticos aos do backend:

```ts
interface TvWallSummary {
  period: { key: '7d' | '30d' | '90d'; from: string; to: string };
  generatedAt: string;
  suppressionThreshold: 5;
  overall: {
    n: number | null;
    nps: number | null;
    promotersPercent: number | null;
    detractorsPercent: number | null;
    suppressed: boolean;
  };
  trend: {
    granularity: 'day' | 'week';
    points: {
      start: string;
      end: string;
      n: number | null;
      nps: number | null;
      suppressed: boolean;
    }[];
  };
  sectors: {
    name: string;
    n: number;
    nps: number;
    promotersPercent: number;
    detractorsPercent: number;
  }[];
}
```

O frontend usa exatamente esses tipos (`src/features/tv-wall/tv-wall-api.ts`), com o
`apiGet('/tv-wall/summary?period=30d')` de `src/lib/api-client.ts` (envelope `{ data }`, `ApiError`
com `status`/`code`) e uma verificação da forma da resposta antes de exibi-la.

## Configuração

| Variável                      | Uso                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `TV_WALL_HOSPITAL_SHORT_NAME` | `short_name` do hospital exibido (ex.: `FHDOD`). Vazia: usa o **único** hospital cadastrado (Seção 2). Nenhum ou vários sem configuração → 503 |

O seed base cria `FHDOD`; o seed de demonstração, `FHDOD-DEMO`. Em ambos o banco tem um único
hospital, então a variável pode ficar vazia. O banco de testes tem vários hospitais (um por
cenário) — por isso os testes sempre a definem. Na E2E do frontend, o `e2e:fixture` cria um
hospital exclusivo da TV Wall, `E2E-TV-<E2E_RUN_ID>`, sem respostas, e o `playwright.config.ts` do
frontend sobe a API com `TV_WALL_HOSPITAL_SHORT_NAME` igual a esse nome (o sufixo é gerado pelo
Playwright e repassado ao fixture em `E2E_RUN_ID`). O motivo do 503 é registrado no log (`warn`),
nunca na resposta.

## Regras e decisões

| Tema                    | Decisão                                                                                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonte dos dados         | respostas persistidas (RN14), consultadas a cada chamada; mesma agregação do dashboard (E28 e E29), verificada no T29                                                                                                                                          |
| Supressão (RN21, RF71)  | sempre aplicada, para qualquer pessoa: setores com menos de 5 respostas nem saem do banco (`HAVING COUNT(*) >= 5`); total e pontos da tendência com 1 a 4 respostas viram `null` com `suppressed: true`; 0 respostas não é suprimido (não há valor a esconder) |
| Setores exibidos        | até 8, ordem do RF55 (maior NPS primeiro, empate pelo nome); setor desativado aparece se tiver 5+ respostas no período (histórico visível, RF15), como no E29                                                                                                  |
| Campos (RF72, Seção 10) | lista explícita validada na saída; sem ids, códigos, equipes, turnos, perfis, textos, contatos, protocolos ou links                                                                                                                                            |
| Recortes                | nenhum filtro de setor, turno, equipe, pesquisa ou origem é aceito (Seção 10: "sem recortes de equipe ou turno")                                                                                                                                               |
| Cache (Seção 9)         | `public, max-age=60` só no 200; não há cache no servidor                                                                                                                                                                                                       |
| Divergência com o PDF   | o PDF cita "cliente Supabase" no RF72; desde a Etapa 3 não existe Supabase: a TV Wall só fala com a API por HTTP                                                                                                                                               |

### Limitação conhecida (não exigida pela especificação)

A supressão é aplicada a cada valor isoladamente, como determinam o RF71 e a RN21. Não há
supressão complementar: se um hospital tiver um setor com 5+ respostas e outro com 1 a 4, a
diferença entre o total geral e os setores exibidos revela o `n` do setor ocultado. A especificação
não pede essa proteção; ela fica registrada para decisão do hospital (Tabela 4 — "indicadores
aprovados para a TV Wall").

## Testes

| Teste                       | Arquivo                                | O que comprova                                                                                                                                                                                                                                         |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T29 (parte de API)          | `tests/db/t29-t31-tv-wall.test.ts`     | caminhos do JSON = lista permitida; sem contato, e-mail, telefone, protocolo, texto, equipe, turno, usuário, UUID ou link, com esses dados no banco; E42 = E28/E29                                                                                     |
| T30                         | idem                                   | setor com 4 ausente, com 5 presente; total 4 → `overall.suppressed`; total 5 → valores; limite e ordem dos 8 setores; tendência suprimida por ponto                                                                                                    |
| T31 (parte de API)          | idem e `tests/unit/tv-wall.test.ts`    | `public, max-age=60`; nova resposta visível com relógio + 60 s; banco fora → 503 `no-store`; série contínua (7, 30 e 13 pontos)                                                                                                                        |
| T38 (E42)                   | `tests/db/t29-t31-tv-wall.test.ts`     | 31ª requisição → 429 com `Retry-After`                                                                                                                                                                                                                 |
| Validação e lista de campos | `tests/unit/tv-wall.test.ts`           | `period` inválido, parâmetros extras, campos proibidos recusados pelo esquema de saída                                                                                                                                                                 |
| Limiares e bordas (T30/T31) | `tests/db/t30-tv-wall-limites.test.ts` | banco sem respostas (n = 0, sem supressão); setor com 1, 4, 5 e 6 respostas; total 1, 4, 5 e 6; 00:00:00 e 23:59:59 locais incluídos e 1 s fora excluído; outro hospital nunca entra; ECONNREFUSED real e pool encerrado → 503 `no-store` sem detalhes |

**Parte de interface (repositório do frontend):** T29, T30 e T31 ponta a ponta em
`e2e/tv-wall.spec.ts`, contra esta API e o MySQL de teste — tráfego só para o E42, sem links nem
dados pessoais, 0/4/5 respostas com a supressão aplicada, relógio + 60 s, API indisponível com os
últimos dados, recuperação, recarga de 6 h e medidas no DOM em 1920 × 1080. Resultados em
[`plano-e-relatorio-de-testes.md`](plano-e-relatorio-de-testes.md).

**Não verificado:** leitura física a 3 m (T31 manual) — não pode ser comprovada por teste
automatizado e não foi realizada.
