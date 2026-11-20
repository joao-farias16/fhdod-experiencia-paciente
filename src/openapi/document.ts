/**
 * Documento OpenAPI 3.1 da API FHDOD, servido em /api-docs (Swagger UI) e /api-docs/openapi.json.
 *
 * Fontes de verdade usadas aqui, para que a documentação acompanhe o comportamento real:
 * - corpos e query strings: os MESMOS esquemas Zod que as rotas validam (`*.schemas.ts`),
 *   convertidos com `z.toJSONSchema` (lado de entrada);
 * - respostas: esquemas de `./schemas.ts`, conferidos contra os tipos dos DTOs nos testes;
 * - permissões: catálogo `ENDPOINTS` e matriz `ROLE_PERMISSIONS` usados por `requirePermission`.
 * Método, caminho e autenticação de cada operação são conferidos contra as rotas do Express em
 * tests/integration/api-docs.test.ts.
 */
import { z } from 'zod';

import { USER_ROLES } from '../lib/domain-types.js';
import { listAuditLogsQuerySchema } from '../modules/audit/audit.schemas.js';
import { type EndpointId, ENDPOINTS, ROLE_PERMISSIONS } from '../modules/auth/permissions.js';
import { PASSWORD_MAX_LENGTH, passwordSchema } from '../modules/auth/password-policy.js';
import {
  filtersQuerySchema,
  questionsQuerySchema,
  summaryQuerySchema,
  trendsQuerySchema,
} from '../modules/dashboard/dashboard.schemas.js';
import {
  createManifestationSchema,
  createNoteSchema,
  deleteContactSchema,
  listManifestationsQuerySchema,
  MANIFESTATION_PRIORITIES,
  MANIFESTATION_STATUSES,
  MANIFESTATION_TYPES,
  updateManifestationSchema,
} from '../modules/manifestations/manifestations.schemas.js';
import { submitResponseSchema } from '../modules/public-survey/public-survey.schemas.js';
import { exportQuerySchema, REPORT_ENDPOINTS } from '../modules/reports/reports.schemas.js';
import {
  createSectorSchema,
  listSectorsQuerySchema,
  updateSectorSchema,
} from '../modules/sectors/sectors.schemas.js';
import { ROSTER_HEADER, ROSTER_MAX_BYTES, ROSTER_MAX_ROWS } from '../modules/shifts/roster-csv.js';
import {
  cancelShiftSchema,
  createShiftSchema,
  listShiftsQuerySchema,
} from '../modules/shifts/shifts.schemas.js';
import {
  createSurveySchema,
  listSurveysQuerySchema,
  SLUG_PATTERN,
  updateSurveySchema,
} from '../modules/surveys/surveys.schemas.js';
import {
  createTeamSchema,
  listTeamsQuerySchema,
  updateTeamSchema,
} from '../modules/teams/teams.schemas.js';
import { tvWallQuerySchema } from '../modules/tv-wall/tv-wall.schemas.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
} from '../modules/users/users.schemas.js';
import { idParamsSchema } from '../utils/validation.js';
import { openApiRegistry } from './schemas.js';

/** Versão da API documentada (mesma do package.json; conferida nos testes). */
export const API_VERSION = '0.1.0';

/** Limite do corpo JSON (JSON_BODY_LIMIT de app.ts, '32kb'; conferido nos testes). */
export const DOCUMENTED_JSON_BODY_LIMIT = '32 KB';

/** Objeto JSON genérico (JSON Schema e objetos da OpenAPI). */
export type JsonObject = { [key: string]: unknown };

export type HttpMethod = 'get' | 'post' | 'patch' | 'delete';

export interface OpenApiOperation extends JsonObject {
  operationId: string;
  tags: string[];
  summary: string;
  description: string;
  security: Record<string, string[]>[];
  responses: Record<string, JsonObject>;
}

export interface OpenApiDocument extends JsonObject {
  openapi: '3.1.0';
  info: JsonObject & { title: string; version: string };
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
  components: {
    schemas: Record<string, JsonObject>;
    responses: Record<string, JsonObject>;
    parameters: Record<string, JsonObject>;
    headers: Record<string, JsonObject>;
    securitySchemes: Record<string, JsonObject>;
  };
}

// ---------------------------------------------------------------------------------------------
// Conversão dos esquemas Zod
// ---------------------------------------------------------------------------------------------

/** Remove as palavras-chave de documento raiz que não cabem dentro da OpenAPI. */
function withoutRootKeywords(schema: object): JsonObject {
  return Object.fromEntries(
    Object.entries(schema).filter(([key]) => key !== '$schema' && key !== '$id'),
  );
}

/** JSON Schema do lado de ENTRADA de um esquema de validação (o que o cliente envia). */
function inputSchema(schema: z.ZodType): JsonObject {
  return withoutRootKeywords(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }));
}

function componentSchemas(): Record<string, JsonObject> {
  const { schemas } = z.toJSONSchema(openApiRegistry, {
    io: 'output',
    unrepresentable: 'any',
    uri: (id) => `#/components/schemas/${id}`,
  });
  return Object.fromEntries(
    Object.entries(schemas).map(([id, schema]) => [id, withoutRootKeywords(schema)]),
  );
}

function propertiesOf(schema: JsonObject): Record<string, JsonObject> {
  return (schema.properties ?? {}) as Record<string, JsonObject>;
}

interface FieldDoc {
  description?: string;
  /** Palavras-chave acrescentadas ao esquema gerado (ex.: `format: 'date'`). */
  schema?: JsonObject;
}

/** Acrescenta descrições e formatos às propriedades de primeiro nível de um corpo. */
function documentFields(schema: JsonObject, fields: Record<string, FieldDoc>): JsonObject {
  const properties = propertiesOf(schema);
  for (const [name, doc] of Object.entries(fields)) {
    const current = properties[name];
    if (current === undefined) throw new Error(`Campo inexistente na documentação: ${name}`);
    properties[name] = {
      ...current,
      ...doc.schema,
      ...(doc.description === undefined ? {} : { description: doc.description }),
    };
  }
  return schema;
}

/** Parâmetros de query string a partir do esquema estrito que a rota valida. */
function queryParameters(schema: z.ZodType, fields: Record<string, FieldDoc> = {}): JsonObject[] {
  const json = inputSchema(schema);
  const required = new Set((json.required ?? []) as string[]);
  const properties = propertiesOf(json);
  for (const name of Object.keys(fields)) {
    if (properties[name] === undefined) throw new Error(`Parâmetro inexistente: ${name}`);
  }
  return Object.entries(properties).map(([name, property]) => {
    const doc = fields[name] ?? {};
    return {
      name,
      in: 'query',
      required: required.has(name),
      ...(doc.description === undefined ? {} : { description: doc.description }),
      schema: { ...property, ...doc.schema },
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Blocos reutilizáveis
// ---------------------------------------------------------------------------------------------

const ref = (id: string): JsonObject => ({ $ref: `#/components/schemas/${id}` });
const arrayOf = (items: JsonObject): JsonObject => ({ type: 'array', items });

function envelope(properties: Record<string, JsonObject>): JsonObject {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const data = (schema: JsonObject) => envelope({ data: schema });

function json(description: string, schema: JsonObject, headers?: JsonObject): JsonObject {
  return {
    description,
    ...(headers === undefined ? {} : { headers }),
    content: { 'application/json': { schema } },
  };
}

const headerRef = (name: string): JsonObject => ({ $ref: `#/components/headers/${name}` });
const noStore = { 'Cache-Control': headerRef('CacheControlNoStore') };
const publicCache = { 'Cache-Control': headerRef('CacheControlPublic60') };

/** Resposta de erro no envelope padrão, com os códigos possíveis daquela operação. */
function error(codes: Record<string, string>): JsonObject {
  const lines = Object.entries(codes).map(([code, when]) => `- \`${code}\`: ${when}`);
  return {
    description: lines.join('\n'),
    content: { 'application/json': { schema: ref('ErrorResponse') } },
  };
}

const VALIDATION = 'campos inválidos, ausentes ou não permitidos (detalhes por campo).';
const MALFORMED = 'corpo que não é JSON válido.';
const NOT_FOUND = 'recurso inexistente ou fora do escopo de setores (RN10).';
const OUT_OF_SCOPE = 'filtro com setor, pesquisa ou equipe fora do escopo do usuário (RN10).';

const jsonBody = (schema: JsonObject, description?: string): JsonObject => ({
  required: true,
  ...(description === undefined ? {} : { description }),
  content: { 'application/json': { schema } },
});

const bodyFrom = (schema: z.ZodType, description?: string) =>
  jsonBody(inputSchema(schema), description);

const idParameter = { $ref: '#/components/parameters/Id' };
const idempotencyKey = { $ref: '#/components/parameters/IdempotencyKey' };

const DATE: FieldDoc = {
  description: 'Data local (America/Sao_Paulo) no formato AAAA-MM-DD.',
  schema: { format: 'date' },
};

const PERIOD_DOC: Record<string, FieldDoc> = {
  from: {
    ...DATE,
    description: `${DATE.description ?? ''} Início do período (inclusivo). Padrão: 30 dias antes de \`to\`.`,
  },
  to: {
    ...DATE,
    description: `${DATE.description ?? ''} Fim do período (inclusivo, até 366 dias). Padrão: hoje.`,
  },
};

function csv(values: readonly string[] | 'uuid'): FieldDoc {
  const items = values === 'uuid' ? 'UUIDs' : values.map((value) => `\`${value}\``).join(', ');
  return { description: `Lista separada por vírgulas (até 50 itens): ${items}.` };
}

const COMMON_FILTERS_DOC: Record<string, FieldDoc> = {
  ...PERIOD_DOC,
  sectorIds: csv('uuid'),
  teamIds: {
    description: `${csv('uuid').description ?? ''} Considera somente respostas atribuídas (RN14).`,
  },
  period: { description: 'Turno: considera somente respostas atribuídas (RN14).' },
};

// ---------------------------------------------------------------------------------------------
// Operações
// ---------------------------------------------------------------------------------------------

interface OperationSpec {
  id: EndpointId | 'E34';
  method: HttpMethod;
  /** Caminho relativo ao servidor `/api/v1`, no formato OpenAPI (`{id}`). */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  auth: 'public' | 'bearer';
  /** E04, E05 e E46 funcionam com troca de senha pendente (RF04). */
  allowsPendingPassword?: boolean;
  rateLimit?: string;
  parameters?: JsonObject[];
  requestBody?: JsonObject;
  /** Respostas específicas; 401/403/429/500/503 comuns são acrescentadas automaticamente. */
  responses: Record<string, JsonObject>;
  /** Códigos 403 específicos da operação (além dos da cadeia autenticada). */
  forbidden?: Record<string, string>;
}

const ROLE_LABELS: Record<(typeof USER_ROLES)[number], string> = {
  superadmin: 'superadministrador (SA)',
  sector_admin: 'administrador de setor (AS)',
  management: 'gestão (GE)',
  ombudsman: 'Ouvidoria (OU)',
  viewer: 'visualizador (VI)',
};

function rolesWith(permission: string): string {
  return USER_ROLES.filter((role) =>
    (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission),
  )
    .map((role) => ROLE_LABELS[role])
    .join(', ');
}

function accessDescription(spec: OperationSpec): string {
  if (spec.auth === 'public') return '**Acesso:** público, sem login e sem cookies.';
  if (spec.id === 'E34') {
    const rows = Object.entries(REPORT_ENDPOINTS).map(([type, endpoint]) => {
      const permission = ENDPOINTS[endpoint].access;
      return `\`type=${type}\` → \`${permission}\` (${rolesWith(permission)})`;
    });
    return `**Acesso:** token Bearer; a permissão depende do tipo: ${rows.join('; ')}.`;
  }
  const permission = ENDPOINTS[spec.id].access;
  return `**Acesso:** token Bearer com a permissão \`${permission}\` (${rolesWith(permission)}).`;
}

function buildOperation(spec: OperationSpec): OpenApiOperation {
  const responses: Record<string, JsonObject> = { ...spec.responses };
  if (spec.auth === 'bearer') {
    responses['401'] = { $ref: '#/components/responses/Unauthenticated' };
    responses['403'] = error({
      ACCOUNT_DISABLED: 'conta desativada (mesmo com token ainda válido).',
      ...(spec.allowsPendingPassword === true
        ? {}
        : { PASSWORD_CHANGE_REQUIRED: 'troca de senha pendente (use E05 antes).' }),
      FORBIDDEN: 'perfil sem a permissão exigida (auditado).',
      ...spec.forbidden,
    });
  } else if (spec.forbidden !== undefined) {
    responses['403'] = error(spec.forbidden);
  }
  if (spec.auth === 'bearer' || spec.rateLimit !== undefined) {
    responses['429'] = { $ref: '#/components/responses/RateLimited' };
  }
  responses['500'] = { $ref: '#/components/responses/InternalError' };
  responses['503'] = { $ref: '#/components/responses/ServiceUnavailable' };

  const limits = [
    ...(spec.rateLimit === undefined ? [] : [spec.rateLimit]),
    ...(spec.auth === 'bearer' ? ['300 requisições por minuto por perfil'] : []),
  ];
  const description = [
    `**${spec.id}.** ${spec.description ?? ''}`.trim(),
    accessDescription(spec),
    ...(limits.length === 0 ? [] : [`**Limite:** ${limits.join('; ')} (429 \`RATE_LIMITED\`).`]),
  ].join('\n\n');

  return {
    operationId: spec.id,
    tags: [spec.tag],
    summary: spec.summary,
    description,
    security: spec.auth === 'bearer' ? [{ bearerAuth: [] }] : [],
    ...(spec.parameters === undefined ? {} : { parameters: spec.parameters }),
    ...(spec.requestBody === undefined ? {} : { requestBody: spec.requestBody }),
    responses: Object.fromEntries(Object.entries(responses).sort(([a], [b]) => a.localeCompare(b))),
  };
}

const slugParameter: JsonObject = {
  name: 'slug',
  in: 'path',
  required: true,
  description: 'Endereço da pesquisa (kebab-case). Fora do formato responde 404.',
  schema: { type: 'string', maxLength: 80, pattern: SLUG_PATTERN.source },
};

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function operations(): OperationSpec[] {
  return [
    // ----- Saúde -----
    {
      id: 'E43',
      method: 'get',
      path: '/health',
      tag: 'Saúde',
      summary: 'Verifica a saúde da API e do banco',
      description: 'Executa `SELECT 1` no MySQL; sem resposta em 2 s ou com falha → 503.',
      auth: 'public',
      rateLimit: '60 requisições por minuto por IP',
      responses: { '200': json('API e banco disponíveis.', data(ref('HealthStatus')), noStore) },
    },

    // ----- Autenticação e perfil -----
    {
      id: 'E44',
      method: 'post',
      path: '/auth/login',
      tag: 'Autenticação',
      summary: 'Entra com e-mail e senha',
      description:
        'Cria uma sessão e devolve o token de acesso (JWT) e o token de renovação. Com troca de ' +
        'senha pendente o login é aceito, mas as demais rotas respondem 403 ' +
        '`PASSWORD_CHANGE_REQUIRED` até o E05.',
      auth: 'public',
      rateLimit: '30 requisições a cada 15 minutos por IP',
      requestBody: jsonBody(
        documentFields(
          {
            type: 'object',
            properties: {
              email: { type: 'string', format: 'email', maxLength: 254 },
              password: { type: 'string', minLength: 1, maxLength: PASSWORD_MAX_LENGTH },
            },
            required: ['email', 'password'],
            additionalProperties: false,
          },
          { email: { description: 'E-mail (espaços e maiúsculas são normalizados).' } },
        ),
      ),
      responses: {
        '200': json('Sessão criada.', data(ref('LoginResult')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '401': error({ INVALID_CREDENTIALS: 'e-mail inexistente ou senha incorreta.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
      },
      forbidden: { ACCOUNT_DISABLED: 'conta desativada (com a senha correta).' },
    },
    {
      id: 'E45',
      method: 'post',
      path: '/auth/refresh',
      tag: 'Autenticação',
      summary: 'Renova a sessão',
      description:
        'Troca o token de renovação (uso único) por um novo par de tokens. Reapresentar um token ' +
        'já trocado, fora da janela de 10 s de renovações simultâneas, revoga a sessão.',
      auth: 'public',
      rateLimit: '60 requisições por minuto por IP',
      requestBody: jsonBody({
        type: 'object',
        properties: { refreshToken: { type: 'string', minLength: 1, maxLength: 256 } },
        required: ['refreshToken'],
        additionalProperties: false,
      }),
      responses: {
        '200': json('Novos tokens.', data(ref('SessionTokens')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '401': error({
          UNAUTHENTICATED: 'token desconhecido, expirado, reutilizado ou de sessão encerrada.',
        }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
      },
      forbidden: { ACCOUNT_DISABLED: 'conta desativada.' },
    },
    {
      id: 'E46',
      method: 'post',
      path: '/auth/logout',
      tag: 'Autenticação',
      summary: 'Encerra a sessão atual',
      description: 'Revoga a sessão do token apresentado; os tokens dela deixam de valer.',
      auth: 'bearer',
      allowsPendingPassword: true,
      responses: { '204': { description: 'Sessão encerrada.' } },
    },
    {
      id: 'E04',
      method: 'get',
      path: '/me',
      tag: 'Perfil',
      summary: 'Consulta o próprio perfil, escopo e permissões',
      auth: 'bearer',
      allowsPendingPassword: true,
      responses: { '200': json('Perfil do usuário autenticado.', data(ref('Me')), noStore) },
    },
    {
      id: 'E05',
      method: 'post',
      path: '/me/password',
      tag: 'Perfil',
      summary: 'Troca a própria senha',
      description:
        'Obrigatória no primeiro acesso e após redefinição. Encerra as OUTRAS sessões do usuário ' +
        '(a atual continua válida). A nova senha deve ser diferente da atual.',
      auth: 'bearer',
      allowsPendingPassword: true,
      rateLimit: '5 trocas a cada 15 minutos por perfil',
      requestBody: jsonBody(
        documentFields(inputSchema(z.strictObject({ newPassword: passwordSchema })), {
          newPassword: {
            description: '10 a 72 caracteres (72 bytes em UTF-8), com letras e números (RN28).',
          },
        }),
      ),
      responses: {
        '204': { description: 'Senha alterada.' },
        '400': error({
          VALIDATION_ERROR: `${VALIDATION} Inclui senha igual à atual.`,
          MALFORMED_JSON: MALFORMED,
        }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
      },
    },

    // ----- Usuários -----
    {
      id: 'E06',
      method: 'get',
      path: '/admin/users',
      tag: 'Usuários',
      summary: 'Lista usuários',
      description:
        'Lista paginada com filtros por perfil, situação, setor e busca por nome ou e-mail.',
      auth: 'bearer',
      parameters: queryParameters(listUsersQuerySchema, {
        isActive: { description: 'Situação: `true` ou `false`.' },
        search: { description: 'Trecho do nome ou do e-mail.' },
      }),
      responses: {
        '200': json(
          'Página de usuários.',
          envelope({ data: arrayOf(ref('User')), meta: ref('PageMeta') }),
          noStore,
        ),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
    },
    {
      id: 'E07',
      method: 'post',
      path: '/admin/users',
      tag: 'Usuários',
      summary: 'Cadastra um usuário',
      description:
        'Gera a senha temporária (exibida uma única vez) e exige a troca no primeiro acesso. ' +
        'Escopo (RN18): SA é sempre global; AS tem ao menos um setor e nunca escopo global; GE, OU ' +
        'e VI têm escopo global (`allSectors`) ou ao menos um setor. Para o SA, `allSectors` é ' +
        'verdadeiro por padrão.',
      auth: 'bearer',
      requestBody: bodyFrom(createUserSchema),
      responses: {
        '201': json('Usuário criado.', data(ref('CreatedUser')), noStore),
        '400': error({
          VALIDATION_ERROR: `${VALIDATION} Inclui escopo incompatível com o perfil.`,
          MALFORMED_JSON: MALFORMED,
        }),
        '409': error({ CONFLICT: 'já existe um usuário com este e-mail.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
        '422': error({
          INVALID_SCOPE: 'setor informado não existe.',
          SECTOR_INACTIVE: 'setor informado está desativado.',
        }),
      },
    },
    {
      id: 'E08',
      method: 'patch',
      path: '/admin/users/{id}',
      tag: 'Usuários',
      summary: 'Altera um usuário',
      description:
        'Nome, perfil, escopo e situação. O e-mail é imutável. A desativação bloqueia ' +
        'imediatamente o uso dos tokens, a renovação e o login.',
      auth: 'bearer',
      parameters: [idParameter],
      requestBody: bodyFrom(updateUserSchema, 'Informe ao menos um campo.'),
      responses: {
        '200': json('Usuário alterado.', data(ref('User')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '404': error({ NOT_FOUND: 'usuário inexistente ou de outro hospital.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
        '422': error({
          LAST_SUPERADMIN: 'a operação deixaria o sistema sem superadministrador ativo.',
          SELF_MODIFICATION_FORBIDDEN: 'alteração do próprio perfil, escopo ou situação.',
          INVALID_SCOPE: 'setor informado não existe.',
          SECTOR_INACTIVE: 'setor novo está desativado.',
        }),
      },
    },
    {
      id: 'E09',
      method: 'post',
      path: '/admin/users/{id}/reset-password',
      tag: 'Usuários',
      summary: 'Redefine a senha de um usuário',
      description:
        'Gera uma senha temporária de 16 caracteres, exige a troca no próximo acesso e encerra ' +
        'todas as sessões do usuário.',
      auth: 'bearer',
      parameters: [idParameter],
      responses: {
        '200': json('Senha temporária gerada.', data(ref('TemporaryPassword')), noStore),
        '400': error({ VALIDATION_ERROR: 'identificador inválido.' }),
        '404': error({ NOT_FOUND: 'usuário inexistente ou de outro hospital.' }),
        '422': error({
          SELF_MODIFICATION_FORBIDDEN: 'redefinição da própria senha (use E05).',
          USER_INACTIVE: 'usuário desativado.',
        }),
      },
    },

    // ----- Setores -----
    {
      id: 'E10',
      method: 'get',
      path: '/admin/sectors',
      tag: 'Setores',
      summary: 'Lista os setores do escopo',
      auth: 'bearer',
      parameters: queryParameters(listSectorsQuerySchema, {
        isActive: { description: 'Situação: `true` ou `false`.' },
        search: { description: 'Trecho do código ou do nome.' },
      }),
      responses: {
        '200': json('Setores.', data(arrayOf(ref('Sector'))), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
    },
    {
      id: 'E11',
      method: 'post',
      path: '/admin/sectors',
      tag: 'Setores',
      summary: 'Cadastra um setor',
      auth: 'bearer',
      requestBody: bodyFrom(createSectorSchema),
      responses: {
        '201': json('Setor criado.', data(ref('Sector')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '409': error({ CONFLICT: 'código ou nome já usado no hospital.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
      },
    },
    {
      id: 'E12',
      method: 'patch',
      path: '/admin/sectors/{id}',
      tag: 'Setores',
      summary: 'Altera, desativa ou reativa um setor',
      description: 'O código é imutável: enviar `code` → 400.',
      auth: 'bearer',
      parameters: [idParameter],
      requestBody: bodyFrom(updateSectorSchema, 'Informe ao menos um campo.'),
      responses: {
        '200': json('Setor alterado.', data(ref('Sector')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '404': error({ NOT_FOUND: 'setor inexistente.' }),
        '409': error({ CONFLICT: 'nome já usado no hospital.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
      },
    },

    // ----- Equipes e etapas -----
    {
      id: 'E13',
      method: 'get',
      path: '/admin/teams',
      tag: 'Equipes e etapas',
      summary: 'Lista as equipes do escopo',
      auth: 'bearer',
      parameters: queryParameters(listTeamsQuerySchema, {
        isActive: { description: 'Situação: `true` ou `false`.' },
      }),
      responses: {
        '200': json('Equipes.', data(arrayOf(ref('Team'))), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: OUT_OF_SCOPE },
    },
    {
      id: 'E14',
      method: 'post',
      path: '/admin/teams',
      tag: 'Equipes e etapas',
      summary: 'Cadastra uma equipe',
      description: 'Equipe sem integrantes; código único no setor.',
      auth: 'bearer',
      requestBody: bodyFrom(createTeamSchema),
      responses: {
        '201': json('Equipe criada.', data(ref('Team')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '404': error({ NOT_FOUND: 'setor inexistente.' }),
        '409': error({ CONFLICT: 'código já usado no setor.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
        '422': error({ SECTOR_INACTIVE: 'setor desativado.' }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: 'setor fora do escopo do usuário.' },
    },
    {
      id: 'E15',
      method: 'patch',
      path: '/admin/teams/{id}',
      tag: 'Equipes e etapas',
      summary: 'Altera, desativa ou reativa uma equipe',
      description: 'Somente nome e situação; código e setor são imutáveis.',
      auth: 'bearer',
      parameters: [idParameter],
      requestBody: bodyFrom(updateTeamSchema, 'Informe ao menos um campo.'),
      responses: {
        '200': json('Equipe alterada.', data(ref('Team')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '404': error({ NOT_FOUND }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
        '422': error({ SECTOR_INACTIVE: 'reativação de equipe de setor desativado.' }),
      },
    },
    {
      id: 'E16',
      method: 'get',
      path: '/admin/journey-stages',
      tag: 'Equipes e etapas',
      summary: 'Lista as etapas da jornada do paciente',
      auth: 'bearer',
      responses: { '200': json('Etapas.', data(arrayOf(ref('JourneyStage'))), noStore) },
    },

    // ----- Turnos e escalas -----
    {
      id: 'E17',
      method: 'get',
      path: '/admin/shifts',
      tag: 'Turnos e escalas',
      summary: 'Consulta a escala de um setor',
      description:
        'Turnos que começam ou terminam no intervalo de datas locais (até 62 dias), com horários ' +
        'no fuso do hospital.',
      auth: 'bearer',
      parameters: queryParameters(listShiftsQuerySchema, {
        from: { ...DATE, description: `${DATE.description ?? ''} Início (inclusivo).` },
        to: {
          ...DATE,
          description: `${DATE.description ?? ''} Fim (inclusivo); intervalo de até 62 dias.`,
        },
        includeCancelled: { description: 'Inclui turnos cancelados: `true` ou `false`.' },
      }),
      responses: {
        '200': json('Turnos.', data(arrayOf(ref('Shift'))), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
        '404': error({ NOT_FOUND: 'setor inexistente.' }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: 'setor fora do escopo do usuário.' },
    },
    {
      id: 'E18',
      method: 'post',
      path: '/admin/shifts',
      tag: 'Turnos e escalas',
      summary: 'Cadastra um turno manualmente',
      description:
        'Data e horas locais do hospital; fim menor ou igual ao início indica o dia seguinte; ' +
        'duração de 1 a 24 horas; data de 30 dias antes a 180 dias depois de hoje.',
      auth: 'bearer',
      requestBody: jsonBody(
        documentFields(inputSchema(createShiftSchema), {
          date: DATE,
          startTime: { description: 'Hora local de início (HH:MM).' },
          endTime: { description: 'Hora local de fim (HH:MM).' },
        }),
      ),
      responses: {
        '201': json('Turno criado.', data(ref('Shift')), noStore),
        '400': error({
          VALIDATION_ERROR: `${VALIDATION} Inclui duração fora de 1 a 24 horas.`,
          MALFORMED_JSON: MALFORMED,
        }),
        '404': error({ NOT_FOUND: 'equipe inexistente ou fora do escopo.' }),
        '409': error({ SHIFT_OVERLAP: 'a equipe já tem turno sobreposto.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
        '422': error({
          SECTOR_INACTIVE: 'setor desativado.',
          TEAM_INACTIVE: 'equipe desativada.',
          DATE_OUT_OF_RANGE: 'data fora da janela permitida.',
        }),
      },
    },
    {
      id: 'E19',
      method: 'patch',
      path: '/admin/shifts/{id}',
      tag: 'Turnos e escalas',
      summary: 'Cancela um turno',
      description: 'Cancelamento irreversível com motivo; respostas já atribuídas permanecem.',
      auth: 'bearer',
      parameters: [idParameter],
      requestBody: bodyFrom(cancelShiftSchema),
      responses: {
        '200': json('Turno cancelado.', data(ref('Shift')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '404': error({ NOT_FOUND }),
        '409': error({ SHIFT_ALREADY_CANCELLED: 'o turno já foi cancelado.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
      },
    },
    {
      id: 'E20',
      method: 'post',
      path: '/admin/rosters/import',
      tag: 'Turnos e escalas',
      summary: 'Pré-valida um arquivo CSV de escala',
      description:
        'Valida o arquivo e todas as linhas SEM gravar turnos e registra a importação como ' +
        '`validated` (pode ser confirmada em até 30 minutos pelo E21) ou `rejected` (erros por ' +
        `linha e coluna). CSV em UTF-8, separador \`;\`, cabeçalho \`${ROSTER_HEADER.join(';')}\`, ` +
        `datas DD/MM/AAAA, turno MANHA/TARDE/NOITE e horas HH:MM; até ${ROSTER_MAX_ROWS} linhas.`,
      auth: 'bearer',
      rateLimit: '10 envios por hora por perfil',
      requestBody: {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              properties: {
                file: {
                  type: 'string',
                  format: 'binary',
                  description: `Arquivo .csv de até ${ROSTER_MAX_BYTES} bytes (1 MB).`,
                },
              },
              required: ['file'],
              additionalProperties: false,
            },
          },
        },
      },
      responses: {
        '201': json(
          'Importação registrada (`validated` ou `rejected`).',
          data(ref('RosterImport')),
          noStore,
        ),
        '400': error({
          VALIDATION_ERROR: 'arquivo ausente, campos extras no formulário ou CSV ilegível.',
          EMPTY_FILE: 'o arquivo não tem linhas de turnos.',
          TOO_MANY_ROWS: `mais de ${ROSTER_MAX_ROWS} linhas.`,
          ENCODING_INVALID: 'o arquivo não está em UTF-8.',
        }),
        '413': error({ FILE_TOO_LARGE: 'o arquivo excede 1 MB.' }),
        '415': error({ UNSUPPORTED_FILE_TYPE: 'arquivo sem extensão .csv ou que não é texto.' }),
      },
    },
    {
      id: 'E21',
      method: 'post',
      path: '/admin/rosters/imports/{id}/confirm',
      tag: 'Turnos e escalas',
      summary: 'Confirma uma importação de escala',
      description:
        'Somente a própria importação `validated`, em até 30 minutos. Revalida escopo, setores, ' +
        'equipes e sobreposições e grava todos os turnos numa única transação (tudo ou nada).',
      auth: 'bearer',
      parameters: [idParameter],
      responses: {
        '200': json('Turnos gravados.', data(ref('RosterImport')), noStore),
        '400': error({ VALIDATION_ERROR: 'identificador inválido.' }),
        '404': error({ NOT_FOUND: 'importação inexistente ou de outro usuário.' }),
        '409': error({
          IMPORT_ALREADY_COMMITTED: 'importação já confirmada.',
          IMPORT_REJECTED: 'importação com erros.',
          IMPORT_EXPIRED: 'prazo de 30 minutos encerrado.',
          SHIFT_OVERLAP: 'turno sobreposto criado depois da pré-validação.',
        }),
        '422': error({
          SECTOR_INACTIVE: 'setor desativado depois da pré-validação.',
          TEAM_INACTIVE: 'equipe desativada depois da pré-validação.',
        }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: 'setor fora do escopo do usuário.' },
    },

    // ----- Pesquisas -----
    {
      id: 'E22',
      method: 'get',
      path: '/admin/surveys',
      tag: 'Pesquisas',
      summary: 'Lista as pesquisas do escopo',
      auth: 'bearer',
      parameters: queryParameters(listSurveysQuerySchema, {
        status: { description: 'Situação: rascunho, ativa ou inativa.' },
        search: { description: 'Trecho do título ou do endereço.' },
      }),
      responses: {
        '200': json(
          'Página de pesquisas.',
          envelope({ data: arrayOf(ref('SurveySummary')), meta: ref('PageMeta') }),
          noStore,
        ),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: 'setor fora do escopo do usuário.' },
    },
    {
      id: 'E23',
      method: 'get',
      path: '/admin/surveys/{id}',
      tag: 'Pesquisas',
      summary: 'Consulta uma pesquisa, perguntas e versões',
      auth: 'bearer',
      parameters: [idParameter],
      responses: {
        '200': json('Pesquisa.', data(ref('SurveyDetail')), noStore),
        '400': error({ VALIDATION_ERROR: 'identificador inválido.' }),
        '404': error({ NOT_FOUND }),
      },
    },
    {
      id: 'E24',
      method: 'post',
      path: '/admin/surveys',
      tag: 'Pesquisas',
      summary: 'Cria uma pesquisa em rascunho',
      description: 'A pergunta geral (NPS 0–10) é criada automaticamente.',
      auth: 'bearer',
      requestBody: bodyFrom(createSurveySchema),
      responses: {
        '201': json('Pesquisa criada.', data(ref('SurveyDetail')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '404': error({ NOT_FOUND: 'setor inexistente.' }),
        '409': error({ CONFLICT: 'endereço (slug) já usado.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
        '422': error({ SECTOR_INACTIVE: 'setor desativado.' }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: 'setor fora do escopo do usuário.' },
    },
    {
      id: 'E25',
      method: 'patch',
      path: '/admin/surveys/{id}',
      tag: 'Pesquisas',
      summary: 'Altera uma pesquisa e suas perguntas',
      description:
        'Textos editáveis a qualquer tempo; setor, endereço e texto da pergunta geral só antes da ' +
        'primeira publicação. Em `questions`, item sem `id` inclui uma pergunta específica ' +
        '(exige `text` e `journeyStageId`); com `id`, altera a pergunta existente.',
      auth: 'bearer',
      parameters: [idParameter],
      requestBody: bodyFrom(updateSurveySchema, 'Informe ao menos um campo.'),
      responses: {
        '200': json('Pesquisa alterada.', data(ref('SurveyDetail')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '404': error({ NOT_FOUND }),
        '409': error({ CONFLICT: 'endereço (slug) já usado.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
        '422': error({
          FIELD_LOCKED_AFTER_PUBLICATION: 'setor, endereço ou pergunta geral após a publicação.',
          QUESTION_LOCKED: 'texto ou etapa de pergunta já publicada.',
          NPS_QUESTION_REQUIRED: 'tentativa de desativar a pergunta geral.',
          QUESTION_LIMIT_REACHED: 'mais de 10 perguntas específicas ativas.',
          SECTOR_INACTIVE: 'setor desativado.',
        }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: 'novo setor fora do escopo do usuário.' },
    },
    {
      id: 'E26',
      method: 'post',
      path: '/admin/surveys/{id}/publish',
      tag: 'Pesquisas',
      summary: 'Publica uma nova versão da pesquisa',
      description: 'Versão imutável com instantâneo dos textos e perguntas ativas.',
      auth: 'bearer',
      parameters: [idParameter],
      responses: {
        '201': json('Versão publicada.', data(ref('SurveyVersion')), noStore),
        '400': error({ VALIDATION_ERROR: 'identificador inválido.' }),
        '404': error({ NOT_FOUND }),
        '409': error({ NO_CHANGES_TO_PUBLISH: 'nada mudou desde a última versão.' }),
        '422': error({
          SURVEY_INACTIVE: 'pesquisa desativada.',
          SECTOR_INACTIVE: 'setor desativado.',
          NPS_QUESTION_REQUIRED: 'pesquisa sem a pergunta geral.',
        }),
      },
    },
    {
      id: 'E27',
      method: 'get',
      path: '/admin/surveys/{id}/qr',
      tag: 'Pesquisas',
      summary: 'Consulta o link e o conteúdo do QR Code',
      description: 'URLs exatas da versão vigente com `?origem=qr` e `?origem=link`.',
      auth: 'bearer',
      parameters: [idParameter],
      responses: {
        '200': json('Links da pesquisa.', data(ref('SurveyQr')), noStore),
        '400': error({ VALIDATION_ERROR: 'identificador inválido.' }),
        '404': error({ NOT_FOUND }),
        '409': error({ SURVEY_NOT_PUBLISHED: 'pesquisa ainda não publicada.' }),
      },
    },

    // ----- Pesquisa pública -----
    {
      id: 'E01',
      method: 'get',
      path: '/public/surveys/{slug}',
      tag: 'Pesquisa pública',
      summary: 'Consulta a versão vigente de uma pesquisa',
      auth: 'public',
      rateLimit: '60 requisições por minuto por IP',
      parameters: [slugParameter],
      responses: {
        '200': json('Pesquisa.', data(ref('PublicSurvey')), publicCache),
        '404': error({ NOT_FOUND: 'endereço inexistente, fora do formato ou em rascunho.' }),
        '410': error({ SURVEY_UNAVAILABLE: 'pesquisa ou setor desativado.' }),
      },
    },
    {
      id: 'E02',
      method: 'post',
      path: '/public/responses',
      tag: 'Pesquisa pública',
      summary: 'Registra uma avaliação',
      description:
        'Envio idempotente: a mesma `Idempotency-Key` com o mesmo conteúdo devolve o registro ' +
        'original (200 com `Idempotent-Replayed: true`). Somente inteiros: NPS de 0 a 10 e ' +
        'específicas de 1 a 5, sem repetir pergunta. Versão substituída aceita respostas por 24 h.',
      auth: 'public',
      rateLimit: '30 requisições por minuto por IP',
      parameters: [idempotencyKey],
      requestBody: bodyFrom(submitResponseSchema),
      responses: {
        '200': json('Reenvio idempotente: registro original.', data(ref('SubmittedResponse')), {
          ...noStore,
          'Idempotent-Replayed': headerRef('IdempotentReplayed'),
        }),
        '201': json('Avaliação registrada.', data(ref('SubmittedResponse')), noStore),
        '400': error({
          VALIDATION_ERROR: `${VALIDATION} Inclui pergunta que não é desta versão.`,
          IDEMPOTENCY_KEY_INVALID: 'cabeçalho Idempotency-Key ausente ou fora do formato UUID v4.',
          MALFORMED_JSON: MALFORMED,
        }),
        '404': error({ NOT_FOUND: 'versão da pesquisa inexistente.' }),
        '409': error({
          SURVEY_VERSION_OUTDATED: 'versão substituída há mais de 24 h.',
          IDEMPOTENCY_KEY_REUSED: 'mesma chave com conteúdo diferente.',
        }),
        '410': error({ SURVEY_UNAVAILABLE: 'pesquisa ou setor desativado.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
      },
    },

    // ----- Manifestação pública -----
    {
      id: 'E03',
      method: 'post',
      path: '/public/manifestations',
      tag: 'Manifestação pública',
      summary: 'Registra uma manifestação',
      description:
        'Usa o token devolvido por E02 (60 minutos, uso único; uma manifestação por avaliação). ' +
        'Anônima é o padrão; `contact` somente com `anonymous: false` (nome, telefone ou e-mail e ' +
        '`consent: true`). Envio idempotente como no E02.',
      auth: 'public',
      rateLimit: '10 requisições por minuto por IP',
      parameters: [idempotencyKey],
      requestBody: bodyFrom(createManifestationSchema),
      responses: {
        '200': json('Reenvio idempotente: protocolo original.', data(ref('CreatedManifestation')), {
          ...noStore,
          'Idempotent-Replayed': headerRef('IdempotentReplayed'),
        }),
        '201': json('Manifestação registrada.', data(ref('CreatedManifestation')), noStore),
        '400': error({
          VALIDATION_ERROR: `${VALIDATION} Inclui contato em manifestação anônima.`,
          IDEMPOTENCY_KEY_INVALID: 'cabeçalho Idempotency-Key ausente ou fora do formato UUID v4.',
          MALFORMED_JSON: MALFORMED,
        }),
        '409': error({
          MANIFESTATION_ALREADY_EXISTS: 'já existe manifestação para esta avaliação.',
          IDEMPOTENCY_KEY_REUSED: 'mesma chave com conteúdo diferente.',
        }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
        '422': error({ MANIFESTATION_TOKEN_EXPIRED: 'prazo de 60 minutos encerrado.' }),
      },
      forbidden: {
        MANIFESTATION_TOKEN_INVALID: 'token ausente, adulterado ou de outra avaliação.',
      },
    },

    // ----- Ouvidoria -----
    {
      id: 'E35',
      method: 'get',
      path: '/ouvidoria/manifestations',
      tag: 'Ouvidoria',
      summary: 'Lista as manifestações',
      description: 'Trecho de 120 caracteres e somente a existência do contato, nunca seus dados.',
      auth: 'bearer',
      parameters: queryParameters(listManifestationsQuerySchema, {
        status: csv(MANIFESTATION_STATUSES),
        type: csv(MANIFESTATION_TYPES),
        priority: csv(MANIFESTATION_PRIORITIES),
        sectorIds: csv('uuid'),
        ...PERIOD_DOC,
        protocol: { description: 'Protocolo FHD-AAAA-NNNNNN (maiúsculas ou minúsculas).' },
        hasContact: { description: 'Com dados de contato: `true` ou `false`.' },
      }),
      responses: {
        '200': json(
          'Página de manifestações.',
          envelope({ data: arrayOf(ref('ManifestationListItem')), meta: ref('PagePeriodMeta') }),
          noStore,
        ),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: OUT_OF_SCOPE },
    },
    {
      id: 'E36',
      method: 'get',
      path: '/ouvidoria/manifestations/{id}',
      tag: 'Ouvidoria',
      summary: 'Consulta uma manifestação',
      description:
        'Detalhe com a avaliação e a linha do tempo, sem os dados de contato (auditado).',
      auth: 'bearer',
      parameters: [idParameter],
      responses: {
        '200': json('Manifestação.', data(ref('ManifestationDetail')), noStore),
        '400': error({ VALIDATION_ERROR: 'identificador inválido.' }),
        '404': error({ NOT_FOUND }),
      },
    },
    {
      id: 'E37',
      method: 'patch',
      path: '/ouvidoria/manifestations/{id}',
      tag: 'Ouvidoria',
      summary: 'Altera status, prioridade ou providências',
      description:
        'Concorrência otimista: envie o `updatedAt` lido. Transições (RN23): received → ' +
        'in_review | archived; in_review → forwarded | resolved | archived; forwarded → ' +
        'in_review | resolved; resolved → in_review; archived → in_review. Concluir exige ' +
        'providências com 10+ caracteres; arquivar exige `note`.',
      auth: 'bearer',
      parameters: [idParameter],
      requestBody: bodyFrom(updateManifestationSchema),
      responses: {
        '200': json('Manifestação alterada.', data(ref('ManifestationDetail')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '404': error({ NOT_FOUND }),
        '409': error({ STALE_RESOURCE: 'a manifestação foi alterada por outra pessoa.' }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
        '422': error({
          INVALID_STATUS_TRANSITION: 'transição não permitida ou status igual ao atual.',
          ACTIONS_REQUIRED: 'concluir sem providências de 10+ caracteres.',
          NOTE_REQUIRED: 'arquivar sem nota.',
        }),
      },
    },
    {
      id: 'E38',
      method: 'post',
      path: '/ouvidoria/manifestations/{id}/notes',
      tag: 'Ouvidoria',
      summary: 'Registra uma nota interna',
      auth: 'bearer',
      parameters: [idParameter],
      requestBody: bodyFrom(createNoteSchema),
      responses: {
        '201': json('Nota registrada.', data(ref('TimelineEvent')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '404': error({ NOT_FOUND }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
      },
    },
    {
      id: 'E39',
      method: 'get',
      path: '/ouvidoria/manifestations/{id}/contact',
      tag: 'Ouvidoria',
      summary: 'Consulta os dados de contato',
      description: 'Cada consulta é auditada antes da leitura; nunca armazenada em cache.',
      auth: 'bearer',
      parameters: [idParameter],
      responses: {
        '200': json('Contato.', data(ref('ManifestationContact')), noStore),
        '400': error({ VALIDATION_ERROR: 'identificador inválido.' }),
        '404': error({ NOT_FOUND: `${NOT_FOUND} Também quando não há contato.` }),
      },
    },
    {
      id: 'E40',
      method: 'delete',
      path: '/ouvidoria/manifestations/{id}/contact',
      tag: 'Ouvidoria',
      summary: 'Elimina os dados de contato',
      auth: 'bearer',
      parameters: [idParameter],
      requestBody: bodyFrom(deleteContactSchema),
      responses: {
        '204': { description: 'Contato eliminado.' },
        '400': error({ VALIDATION_ERROR: VALIDATION, MALFORMED_JSON: MALFORMED }),
        '404': error({ NOT_FOUND: `${NOT_FOUND} Também quando não há contato.` }),
        '413': { $ref: '#/components/responses/PayloadTooLarge' },
      },
    },

    // ----- Dashboard -----
    {
      id: 'E28',
      method: 'get',
      path: '/dashboard/summary',
      tag: 'Dashboard',
      summary: 'Indicadores gerais',
      description:
        'NPS, distribuição 0–10, manifestações, cobertura de atribuição e, opcionalmente, ' +
        'comparação com o período anterior. Para o VI, grupos com 1 a 4 respostas são suprimidos.',
      auth: 'bearer',
      parameters: queryParameters(summaryQuerySchema, COMMON_FILTERS_DOC),
      responses: {
        '200': json('Indicadores.', data(ref('DashboardSummary')), noStore),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: OUT_OF_SCOPE },
    },
    {
      id: 'E29',
      method: 'get',
      path: '/dashboard/sectors',
      tag: 'Dashboard',
      summary: 'Indicadores por setor',
      auth: 'bearer',
      parameters: queryParameters(filtersQuerySchema, COMMON_FILTERS_DOC),
      responses: {
        '200': json(
          'Setores do escopo ordenados por NPS.',
          envelope({ data: arrayOf(ref('SectorResult')), meta: ref('LocalPeriod') }),
          noStore,
        ),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: OUT_OF_SCOPE },
    },
    {
      id: 'E30',
      method: 'get',
      path: '/dashboard/shifts',
      tag: 'Dashboard',
      summary: 'Indicadores por turno',
      auth: 'bearer',
      parameters: queryParameters(filtersQuerySchema, COMMON_FILTERS_DOC),
      responses: {
        '200': json(
          'Indicadores por turno, com cobertura de atribuição.',
          envelope({ data: arrayOf(ref('ShiftResult')), meta: ref('CoverageMeta') }),
          noStore,
        ),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: OUT_OF_SCOPE },
    },
    {
      id: 'E31',
      method: 'get',
      path: '/dashboard/teams',
      tag: 'Dashboard',
      summary: 'Indicadores por equipe',
      auth: 'bearer',
      parameters: queryParameters(filtersQuerySchema, COMMON_FILTERS_DOC),
      responses: {
        '200': json(
          'Indicadores por equipe, com cobertura de atribuição.',
          envelope({ data: arrayOf(ref('TeamResult')), meta: ref('CoverageMeta') }),
          noStore,
        ),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: OUT_OF_SCOPE },
    },
    {
      id: 'E32',
      method: 'get',
      path: '/dashboard/trends',
      tag: 'Dashboard',
      summary: 'Série temporal do NPS',
      description:
        'Um ponto por intervalo, sem lacunas. Sem `granularity`, usa dia até 31 dias, semana até ' +
        '180 dias e mês acima disso; informada, `day` aceita até 31 dias e `week` até 180.',
      auth: 'bearer',
      parameters: queryParameters(trendsQuerySchema, COMMON_FILTERS_DOC),
      responses: {
        '200': json(
          'Pontos da série.',
          envelope({ data: arrayOf(ref('TrendPoint')), meta: ref('TrendsMeta') }),
          noStore,
        ),
        '400': error({ VALIDATION_ERROR: `${VALIDATION} Inclui granularidade incompatível.` }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: OUT_OF_SCOPE },
    },
    {
      id: 'E33',
      method: 'get',
      path: '/dashboard/questions',
      tag: 'Dashboard',
      summary: 'Resultados por pergunta específica',
      auth: 'bearer',
      parameters: queryParameters(questionsQuerySchema, COMMON_FILTERS_DOC),
      responses: {
        '200': json(
          'Resultados por pergunta.',
          envelope({ data: arrayOf(ref('QuestionResult')), meta: ref('QuestionsMeta') }),
          noStore,
        ),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: OUT_OF_SCOPE },
    },

    // ----- Relatórios -----
    {
      id: 'E34',
      method: 'get',
      path: '/reports/export',
      tag: 'Relatórios',
      summary: 'Exporta um relatório Excel (.xlsx)',
      description:
        'Respostas, indicadores ou manifestações, com os filtros do dashboard. `status`, ' +
        '`manifestationType` e `includeText` existem somente no relatório de manifestações. Até ' +
        '50.000 linhas por aba.',
      auth: 'bearer',
      rateLimit: '10 exportações a cada 10 minutos por perfil',
      parameters: queryParameters(exportQuerySchema, {
        ...COMMON_FILTERS_DOC,
        status: csv(MANIFESTATION_STATUSES),
        manifestationType: csv(MANIFESTATION_TYPES),
        includeText: { description: 'Inclui a descrição das manifestações: `true` ou `false`.' },
      }),
      responses: {
        '200': {
          description: 'Arquivo .xlsx como anexo.',
          headers: { ...noStore, 'Content-Disposition': headerRef('ContentDisposition') },
          content: { [XLSX]: { schema: { type: 'string', format: 'binary' } } },
        },
        '400': error({ VALIDATION_ERROR: `${VALIDATION} Inclui \`type\` ausente ou inválido.` }),
        '422': error({ EXPORT_TOO_LARGE: 'mais de 50.000 linhas.' }),
      },
      forbidden: { SECTOR_OUT_OF_SCOPE: OUT_OF_SCOPE },
    },

    // ----- Auditoria -----
    {
      id: 'E41',
      method: 'get',
      path: '/admin/audit-logs',
      tag: 'Auditoria',
      summary: 'Consulta a trilha de auditoria',
      description: 'Eventos em ordem decrescente; o IP (HMAC) não é devolvido.',
      auth: 'bearer',
      parameters: queryParameters(listAuditLogsQuerySchema, PERIOD_DOC),
      responses: {
        '200': json(
          'Página de eventos.',
          envelope({ data: arrayOf(ref('AuditLog')), meta: ref('PagePeriodMeta') }),
          noStore,
        ),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
    },

    // ----- TV Wall -----
    {
      id: 'E42',
      method: 'get',
      path: '/tv-wall/summary',
      tag: 'TV Wall',
      summary: 'Indicadores agregados para a TV Wall',
      description:
        'Somente agregados com supressão (menos de 5 respostas), até 8 setores, sem textos, ' +
        'contatos ou identificadores. Erros saem com `Cache-Control: no-store`.',
      auth: 'public',
      rateLimit: '30 requisições por minuto por IP',
      parameters: queryParameters(tvWallQuerySchema, {
        period: { description: 'Últimos 7, 30 ou 90 dias (o último dia é hoje).' },
      }),
      responses: {
        '200': json('Indicadores.', data(ref('TvWallSummary')), publicCache),
        '400': error({ VALIDATION_ERROR: VALIDATION }),
      },
    },
  ];
}

const TAGS = [
  ['Saúde', 'Verificação da API e do banco.'],
  ['Autenticação', 'Login, renovação e logout (autenticação própria: bcrypt + JWT + sessões).'],
  ['Perfil', 'Perfil e senha do usuário autenticado.'],
  ['Usuários', 'Administração de usuários (SA).'],
  ['Setores', 'Setores do hospital.'],
  ['Equipes e etapas', 'Equipes dos setores e etapas da jornada do paciente.'],
  ['Turnos e escalas', 'Turnos manuais e importação de escala CSV.'],
  ['Pesquisas', 'Pesquisas, perguntas, versões, link e QR Code.'],
  ['Pesquisa pública', 'Pesquisa respondida pelo paciente, sem login.'],
  ['Manifestação pública', 'Elogio, reclamação ou sugestão após a avaliação, sem login.'],
  ['Ouvidoria', 'Tratamento das manifestações (OU).'],
  ['Dashboard', 'Indicadores de NPS no escopo do usuário.'],
  ['Relatórios', 'Exportação Excel.'],
  ['Auditoria', 'Trilha de auditoria (SA).'],
  ['TV Wall', 'Indicadores públicos agregados.'],
] as const;

const INFO_DESCRIPTION = `API REST do FHDOD — Sistema de Gestão da Experiência do Paciente.

**Autenticação.** Entre com \`POST /auth/login\` (E44) e envie o \`accessToken\` no cabeçalho
\`Authorization: Bearer <token>\` (botão **Authorize**). Renove com \`POST /auth/refresh\` (E45).
O perfil, a situação da conta e o escopo de setores são lidos a cada requisição. Com troca de senha
pendente, somente E04, E05 e E46 respondem; as demais rotas autenticadas devolvem 403
\`PASSWORD_CHANGE_REQUIRED\`.

**Escopo de setores (RN10).** Filtros com setores fora do escopo → 403 \`SECTOR_OUT_OF_SCOPE\`;
recurso individual fora do escopo → 404, sem revelar sua existência.

**Erros.** Sempre no envelope \`{ "error": { "code", "message", "details", "requestId" } }\`.
Campos desconhecidos são recusados (400 \`VALIDATION_ERROR\`). Corpos JSON até ${DOCUMENTED_JSON_BODY_LIMIT}.

**Rastreabilidade.** Toda resposta traz \`X-Request-Id\` (o valor recebido, se for UUID, ou um novo).
Respostas autenticadas usam \`Cache-Control: no-store\`.`;

/** Monta o documento OpenAPI 3.1 completo. */
export function buildOpenApiDocument(): OpenApiDocument {
  const paths: OpenApiDocument['paths'] = {};
  for (const spec of operations()) {
    const item = (paths[spec.path] ??= {});
    if (item[spec.method] !== undefined) {
      throw new Error(`Operação duplicada: ${spec.method.toUpperCase()} ${spec.path}`);
    }
    item[spec.method] = buildOperation(spec);
  }

  const idSchema = propertiesOf(inputSchema(idParamsSchema)).id ?? { type: 'string' };

  return {
    openapi: '3.1.0',
    info: {
      title: 'API FHDOD — Experiência do Paciente',
      version: API_VERSION,
      description: INFO_DESCRIPTION,
      license: { name: 'UNLICENSED (projeto acadêmico)', identifier: 'UNLICENSED' },
    },
    servers: [{ url: '/api/v1', description: 'Versão 1 da API (mesmo endereço desta página)' }],
    tags: TAGS.map(([name, description]) => ({ name, description })),
    paths,
    components: {
      schemas: componentSchemas(),
      parameters: {
        Id: {
          name: 'id',
          in: 'path',
          required: true,
          description: 'Identificador (UUID).',
          schema: idSchema,
        },
        IdempotencyKey: {
          name: 'Idempotency-Key',
          in: 'header',
          required: true,
          description: 'UUID v4 único por envio; repita o mesmo valor nos reenvios automáticos.',
          schema: {
            type: 'string',
            format: 'uuid',
            pattern:
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
          },
        },
      },
      headers: {
        CacheControlNoStore: {
          description: '`no-store`.',
          schema: { type: 'string', const: 'no-store' },
        },
        CacheControlPublic60: {
          description: 'Cache público de 60 s.',
          schema: { type: 'string', const: 'public, max-age=60' },
        },
        IdempotentReplayed: {
          description: 'Presente (`true`) quando a resposta repete um envio anterior.',
          schema: { type: 'string', const: 'true' },
        },
        ContentDisposition: {
          description: 'Anexo com o nome padronizado do arquivo .xlsx.',
          schema: {
            type: 'string',
            example: 'attachment; filename="respostas_20261001_20261030.xlsx"',
          },
        },
        RetryAfter: {
          description: 'Segundos até a janela do limite ser reiniciada.',
          schema: { type: 'integer' },
        },
        RateLimit: {
          description:
            'Cota restante e reinício da janela (draft-ietf-httpapi-ratelimit-headers-08).',
          schema: { type: 'string' },
        },
        RateLimitPolicy: {
          description: 'Política de limite aplicada (draft-ietf-httpapi-ratelimit-headers-08).',
          schema: { type: 'string' },
        },
      },
      responses: {
        Unauthenticated: json(
          '`UNAUTHENTICATED`: token ausente, malformado, adulterado, expirado ou de sessão encerrada.',
          ref('ErrorResponse'),
          noStore,
        ),
        RateLimited: json('`RATE_LIMITED`: limite de requisições excedido.', ref('ErrorResponse'), {
          'Retry-After': headerRef('RetryAfter'),
          RateLimit: headerRef('RateLimit'),
          'RateLimit-Policy': headerRef('RateLimitPolicy'),
        }),
        PayloadTooLarge: json(
          `\`PAYLOAD_TOO_LARGE\`: corpo JSON acima de ${DOCUMENTED_JSON_BODY_LIMIT}.`,
          ref('ErrorResponse'),
        ),
        InternalError: json(
          '`INTERNAL_ERROR`: erro inesperado (sem detalhes internos na resposta).',
          ref('ErrorResponse'),
        ),
        ServiceUnavailable: json(
          '`SERVICE_UNAVAILABLE`: banco de dados indisponível (ou TV Wall sem hospital definido).',
          ref('ErrorResponse'),
        ),
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Token de acesso (`accessToken`) devolvido por `POST /auth/login` ou `POST /auth/refresh`.',
        },
      },
    },
  };
}
