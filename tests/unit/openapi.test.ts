import { readFileSync } from 'node:fs';

import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';

import { JSON_BODY_LIMIT } from '../../src/app.js';
import type { AuditLogDto } from '../../src/modules/audit/audit.service.js';
import type { getMe, login } from '../../src/modules/auth/auth.service.js';
import type { SessionTokens } from '../../src/modules/auth/auth.types.js';
import { ENDPOINTS } from '../../src/modules/auth/permissions.js';
import type {
  Coverage,
  DistributionItem,
  NpsIndicator,
  QuestionResultDto,
  SectorResultDto,
  ShiftResultDto,
  SummaryDto,
  TeamResultDto,
  TrendPointDto,
} from '../../src/modules/dashboard/dashboard.service.js';
import type { HealthStatus } from '../../src/modules/health/health.routes.js';
import { createUserSchema } from '../../src/modules/users/users.schemas.js';
import type {
  ContactDto,
  ManifestationDetailDto,
  ManifestationListItemDto,
  TimelineEventDto,
} from '../../src/modules/manifestations/ombudsman.service.js';
import type { CreatedManifestationDto } from '../../src/modules/manifestations/public-manifestation.service.js';
import type {
  PublicSurveyDto,
  SubmittedResponseDto,
} from '../../src/modules/public-survey/public-survey.service.js';
import type { SectorDto } from '../../src/modules/sectors/sectors.service.js';
import type { RosterError } from '../../src/modules/shifts/roster-csv.js';
import type {
  RosterImportDto,
  RosterSummaryItem,
} from '../../src/modules/shifts/rosters.service.js';
import type { ShiftDto } from '../../src/modules/shifts/shifts.service.js';
import type {
  getSurveyLinks,
  SurveyDetailDto,
  SurveyLinks,
  SurveyQuestionDto,
  SurveySummaryDto,
  SurveyVersionDto,
} from '../../src/modules/surveys/surveys.service.js';
import type { JourneyStageDto, TeamDto } from '../../src/modules/teams/teams.service.js';
import type { TvWallSummary } from '../../src/modules/tv-wall/tv-wall.schemas.js';
import type { SectorSummary } from '../../src/modules/users/users.repository.js';
import type {
  createUser,
  resetUserPassword,
  UserDto,
} from '../../src/modules/users/users.service.js';
import {
  API_VERSION,
  buildOpenApiDocument,
  DOCUMENTED_JSON_BODY_LIMIT,
  type HttpMethod,
  type JsonObject,
  type OpenApiOperation,
} from '../../src/openapi/document.js';
import type * as schemas from '../../src/openapi/schemas.js';
import type { ErrorDetail } from '../../src/utils/errors.js';
import type { LocalPeriod } from '../../src/utils/validation.js';

type Out<S extends z.ZodType> = z.output<S>;
type Result<F extends (...args: never[]) => unknown> = Awaited<ReturnType<F>>;

/**
 * Equivalência para DTOs declarados como interseção (`A & { … }`), que `toEqualTypeOf` não
 * compara com o objeto equivalente: cada lado precisa ser atribuível ao outro.
 */
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const document = buildOpenApiDocument();

const METHODS: HttpMethod[] = ['get', 'post', 'patch', 'delete'];

interface DocumentedOperation {
  method: HttpMethod;
  path: string;
  operation: OpenApiOperation;
}

function documentedOperations(): DocumentedOperation[] {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    METHODS.flatMap((method) => {
      const operation = item[method];
      return operation === undefined ? [] : [{ method, path, operation }];
    }),
  );
}

/** Resolve um ponteiro JSON local (`#/components/...`). */
function resolvePointer(pointer: string): unknown {
  return pointer
    .slice(2)
    .split('/')
    .map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce<unknown>(
      (node, key) =>
        node !== null && typeof node === 'object' ? (node as JsonObject)[key] : undefined,
      document,
    );
}

function collectRefs(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.push(value);
      else collectRefs(value, found);
    }
  }
  return found;
}

/** Caminho do catálogo (Tabela 19) no formato OpenAPI: `:id` → `{id}`, sem query string. */
function catalogPath(path: string): string {
  return path.replace(/\?.*$/, '').replace(/:(\w+)/g, '{$1}');
}

describe('esquemas de resposta da OpenAPI × DTOs dos serviços (tipos)', () => {
  it('erros, saúde, autenticação e usuários', () => {
    expectTypeOf<Out<typeof schemas.ErrorDetail>>().toEqualTypeOf<ErrorDetail>();
    expectTypeOf<Out<typeof schemas.HealthStatus>>().toEqualTypeOf<HealthStatus>();
    expectTypeOf<Out<typeof schemas.SectorSummary>>().toEqualTypeOf<SectorSummary>();
    expectTypeOf<
      MutuallyAssignable<Out<typeof schemas.Me>, Result<typeof getMe>>
    >().toEqualTypeOf<true>();
    expectTypeOf<Out<typeof schemas.SessionTokens>>().toEqualTypeOf<SessionTokens>();
    expectTypeOf<
      MutuallyAssignable<Out<typeof schemas.LoginResult>, Result<typeof login>>
    >().toEqualTypeOf<true>();
    expectTypeOf<Out<typeof schemas.User>>().toEqualTypeOf<UserDto>();
    expectTypeOf<Out<typeof schemas.CreatedUser>>().toEqualTypeOf<Result<typeof createUser>>();
    expectTypeOf<Out<typeof schemas.TemporaryPassword>>().toEqualTypeOf<
      Result<typeof resetUserPassword>
    >();
  });

  it('setores, equipes, etapas, turnos e escalas', () => {
    expectTypeOf<Out<typeof schemas.Sector>>().toEqualTypeOf<SectorDto>();
    expectTypeOf<Out<typeof schemas.Team>>().toEqualTypeOf<TeamDto>();
    expectTypeOf<Out<typeof schemas.JourneyStage>>().toEqualTypeOf<JourneyStageDto>();
    expectTypeOf<Out<typeof schemas.Shift>>().toEqualTypeOf<ShiftDto>();
    expectTypeOf<Out<typeof schemas.RosterError>>().toEqualTypeOf<RosterError>();
    expectTypeOf<Out<typeof schemas.RosterSummaryItem>>().toEqualTypeOf<RosterSummaryItem>();
    expectTypeOf<Out<typeof schemas.RosterImport>>().toEqualTypeOf<RosterImportDto>();
  });

  it('pesquisas, pesquisa pública e manifestações', () => {
    expectTypeOf<Out<typeof schemas.SurveyLinks>>().toEqualTypeOf<SurveyLinks>();
    expectTypeOf<Out<typeof schemas.SurveySummary>>().toEqualTypeOf<SurveySummaryDto>();
    expectTypeOf<Out<typeof schemas.SurveyQuestion>>().toEqualTypeOf<SurveyQuestionDto>();
    expectTypeOf<Out<typeof schemas.SurveyVersion>>().toEqualTypeOf<SurveyVersionDto>();
    expectTypeOf<Out<typeof schemas.SurveyDetail>>().toEqualTypeOf<SurveyDetailDto>();
    expectTypeOf<
      MutuallyAssignable<Out<typeof schemas.SurveyQr>, Result<typeof getSurveyLinks>>
    >().toEqualTypeOf<true>();
    expectTypeOf<Out<typeof schemas.PublicSurvey>>().toEqualTypeOf<PublicSurveyDto>();
    expectTypeOf<Out<typeof schemas.SubmittedResponse>>().toEqualTypeOf<SubmittedResponseDto>();
    expectTypeOf<
      Out<typeof schemas.CreatedManifestation>
    >().toEqualTypeOf<CreatedManifestationDto>();
    expectTypeOf<
      Out<typeof schemas.ManifestationListItem>
    >().toEqualTypeOf<ManifestationListItemDto>();
    expectTypeOf<Out<typeof schemas.TimelineEvent>>().toEqualTypeOf<TimelineEventDto>();
    expectTypeOf<Out<typeof schemas.ManifestationDetail>>().toEqualTypeOf<ManifestationDetailDto>();
    expectTypeOf<Out<typeof schemas.ManifestationContact>>().toEqualTypeOf<ContactDto>();
  });

  it('dashboard, auditoria e TV Wall', () => {
    expectTypeOf<Out<typeof schemas.LocalPeriod>>().toEqualTypeOf<LocalPeriod>();
    expectTypeOf<Out<typeof schemas.NpsIndicator>>().toEqualTypeOf<NpsIndicator>();
    expectTypeOf<Out<typeof schemas.Coverage>>().toEqualTypeOf<Coverage>();
    expectTypeOf<Out<typeof schemas.DistributionItem>>().toEqualTypeOf<DistributionItem>();
    expectTypeOf<Out<typeof schemas.DashboardSummary>>().toEqualTypeOf<SummaryDto>();
    expectTypeOf<Out<typeof schemas.SectorResult>>().toEqualTypeOf<SectorResultDto>();
    expectTypeOf<Out<typeof schemas.ShiftResult>>().toEqualTypeOf<ShiftResultDto>();
    expectTypeOf<Out<typeof schemas.TeamResult>>().toEqualTypeOf<TeamResultDto>();
    expectTypeOf<Out<typeof schemas.TrendPoint>>().toEqualTypeOf<TrendPointDto>();
    expectTypeOf<Out<typeof schemas.QuestionResult>>().toEqualTypeOf<QuestionResultDto>();
    expectTypeOf<Out<typeof schemas.AuditLog>>().toEqualTypeOf<AuditLogDto>();
    expectTypeOf<Out<typeof schemas.TvWallSummary>>().toEqualTypeOf<TvWallSummary>();
  });
});

describe('documento OpenAPI 3.1', () => {
  it('usa OpenAPI 3.1, a versão do package.json e o limite real do corpo JSON', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

    expect(document.openapi).toBe('3.1.0');
    expect(document.info.version).toBe(API_VERSION);
    expect(API_VERSION).toBe(pkg.version);
    expect(JSON_BODY_LIMIT).toBe('32kb');
    expect(DOCUMENTED_JSON_BODY_LIMIT).toBe('32 KB');
    expect(document.servers).toEqual([
      { url: '/api/v1', description: expect.any(String) as string },
    ]);
  });

  it('é serializável em JSON sem perdas', () => {
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });

  it('todas as referências $ref apontam para componentes existentes', () => {
    const refs = collectRefs(document);

    expect(refs.length).toBeGreaterThan(100);
    for (const ref of new Set(refs)) {
      expect(ref, ref).toMatch(/^#\/components\/(schemas|responses|parameters|headers)\/\w+$/);
      expect(resolvePointer(ref), ref).toBeDefined();
    }
  });

  it('todo componente de esquema é usado e nenhum mantém palavras-chave de documento raiz', () => {
    const used = new Set(collectRefs({ paths: document.paths, components: document.components }));
    for (const [id, schema] of Object.entries(document.components.schemas)) {
      expect(used.has(`#/components/schemas/${id}`), id).toBe(true);
      expect(schema).not.toHaveProperty('$schema');
      expect(schema).not.toHaveProperty('$id');
    }
  });

  it('documenta exatamente os 46 endpoints do catálogo (E01–E46), com método e caminho reais', () => {
    const operations = documentedOperations();
    const catalog = Object.entries(ENDPOINTS);
    const catalogIds = new Set(catalog.map(([id]) => (id.startsWith('E34-') ? 'E34' : id)));

    expect(operations).toHaveLength(46);
    expect(new Set(operations.map(({ operation }) => operation.operationId))).toEqual(catalogIds);

    for (const [id, endpoint] of catalog) {
      const operationId = id.startsWith('E34-') ? 'E34' : id;
      const documented = operations.find(({ operation }) => operation.operationId === operationId);
      expect(documented, id).toBeDefined();
      expect(documented?.method.toUpperCase(), id).toBe(endpoint.method);
      expect(documented?.path, id).toBe(catalogPath(endpoint.path));
      expect(documented?.operation.security, id).toEqual(
        endpoint.access === 'public' ? [] : [{ bearerAuth: [] }],
      );
    }
  });

  it('cada operação tem resposta de sucesso, erros no envelope padrão e parâmetros de caminho', () => {
    for (const { method, path, operation } of documentedOperations()) {
      const label = `${method.toUpperCase()} ${path}`;
      const statuses = Object.keys(operation.responses);
      expect(
        statuses.some((status) => /^2\d\d$/.test(status)),
        label,
      ).toBe(true);
      expect(statuses, label).toEqual(expect.arrayContaining(['500', '503']));

      for (const [status, response] of Object.entries(operation.responses)) {
        if (Number(status) < 400) continue;
        const resolved = (
          typeof response.$ref === 'string' ? resolvePointer(response.$ref) : response
        ) as JsonObject;
        expect(resolved.content, `${label} ${status}`).toEqual({
          'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } },
        });
      }

      if (operation.security.length > 0) {
        expect(statuses, label).toEqual(expect.arrayContaining(['401', '403', '429']));
      }

      const declared = ((operation.parameters ?? []) as JsonObject[])
        .map((parameter) =>
          typeof parameter.$ref === 'string'
            ? (resolvePointer(parameter.$ref) as JsonObject)
            : parameter,
        )
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name);
      const inPath = [...path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]);
      expect(declared, label).toEqual(inPath);
    }
  });

  it('corpos e query strings são gerados dos esquemas que as rotas validam', () => {
    const create = document.paths['/admin/users']?.post?.requestBody as JsonObject;
    const expected = z.toJSONSchema(createUserSchema, { io: 'input', unrepresentable: 'any' });
    delete expected.$schema;

    expect(create).toEqual({
      required: true,
      content: { 'application/json': { schema: expected } },
    });
    const listUsers = (document.paths['/admin/users']?.get?.parameters ?? []) as JsonObject[];
    expect(listUsers.map((parameter) => parameter.name)).toEqual([
      'role',
      'isActive',
      'sectorId',
      'search',
      'page',
      'pageSize',
    ]);
  });

  it('documenta a autenticação Bearer (JWT) usada pelas rotas protegidas', () => {
    expect(document.components.securitySchemes).toEqual({
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: expect.any(String) as string,
      },
    });
  });
});
