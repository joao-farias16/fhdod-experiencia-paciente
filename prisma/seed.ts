/**
 * Seed determinístico do FHDOD (ET02 — Seção 8 da especificação).
 *
 * Gera SOMENTE dados fictícios com faker.seed(2026) e localização pt_BR:
 * 1 hospital, 6 setores, 18 equipes, 4 etapas, 6 pesquisas (a do Pronto Atendimento com v1 e v2),
 * turnos de 150 dias com reforço ambíguo no PA, 2.400 respostas, 180 manifestações (40% com
 * contato fictício) e 6 usuários de demonstração @example.com.
 *
 * Reprodutibilidade: com o mesmo SEED_REFERENCE_DATE (AAAA-MM-DD; padrão: hoje no fuso
 * America/Sao_Paulo) e um banco recém-migrado, todos os identificadores e valores são idênticos.
 * Idempotência: se o hospital de demonstração já existir, nada é gravado. Para recriar os dados,
 * use `npm run db:reset` (somente em banco local).
 *
 * Segurança: recusa banco ou Supabase remotos, salvo SEED_ALLOW_REMOTE=true. A senha dos usuários de
 * demonstração vem de SEED_DEMO_PASSWORD (nunca versionada) e só é usada quando SUPABASE_URL e
 * SUPABASE_SECRET_KEY estão definidos (criação das contas no Supabase Auth local).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

import { fakerPT_BR as faker } from '@faker-js/faker';
import { z } from 'zod';

import { assertLocalTargets, describeUrl } from '../scripts/db/guard.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { createPrismaClient } from '../src/lib/prisma.js';

// -------------------------------------------------------------------------------------------
// Configuração
// -------------------------------------------------------------------------------------------

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

/** Variável vazia no .env equivale a ausente. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const seedEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SEED_ALLOW_REMOTE: z.enum(['true', 'false']).default('false'),
  // Política da RN28: 10 ou mais caracteres, com letras e números.
  SEED_DEMO_PASSWORD: optional(
    z
      .string()
      .min(10)
      .regex(/[A-Za-z]/)
      .regex(/[0-9]/),
  ),
  SEED_REFERENCE_DATE: optional(z.iso.date()),
  SUPABASE_URL: optional(z.url()),
  SUPABASE_SECRET_KEY: optional(z.string()),
});

const FAKER_SEED = 2026;
const SEED_HOSPITAL_SHORT_NAME = 'FHDOD-DEMO';
const TIMEZONE_OFFSET = '-03:00'; // America/Sao_Paulo, sem horário de verão desde 2019.
const RESPONSE_DAYS = 120; // respostas nos 120 dias anteriores à data de referência
const SHIFT_DAYS = 150; // turnos de 150 dias: os mesmos 120 dias + 30 dias à frente
const RESPONSES_TOTAL = 2400;
const MANIFESTATIONS_TOTAL = 180;
const CONTACTS_TOTAL = 72; // 40% de 180
const PURPOSE_TEXT_VERSION = 'v1';

const NPS_QUESTION_TEXT =
  'Em uma escala de 0 a 10, o quanto você recomendaria o atendimento deste setor a um amigo ou familiar?';

// -------------------------------------------------------------------------------------------
// Datas no fuso do hospital
// -------------------------------------------------------------------------------------------

const pad = (value: number, size = 2) => String(value).padStart(size, '0');

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function localInstant(ymd: string, hour: number, minute = 0, second = 0, ms = 0): Date {
  return new Date(
    `${ymd}T${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(ms, 3)}${TIMEZONE_OFFSET}`,
  );
}

/** Dia da semana da data local (0 = domingo). */
function weekday(ymd: string): number {
  return new Date(`${ymd}T12:00:00Z`).getUTCDay();
}

const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

// -------------------------------------------------------------------------------------------
// Catálogos fictícios
// -------------------------------------------------------------------------------------------

type NpsProfile = 'otimo' | 'bom' | 'regular';

const NPS_WEIGHTS: Record<NpsProfile, number[]> = {
  otimo: [1, 0, 0, 1, 1, 1, 2, 5, 10, 25, 40],
  bom: [1, 1, 1, 2, 2, 3, 4, 8, 14, 24, 28],
  regular: [3, 2, 2, 3, 4, 5, 6, 10, 14, 18, 20],
};

interface SectorSpec {
  code: string;
  name: string;
  description: string;
  slug: string;
  responses: number;
  profile: NpsProfile;
}

const SECTORS: SectorSpec[] = [
  {
    code: 'PA',
    name: 'Pronto Atendimento',
    description: 'Atendimento de urgência e emergência 24 horas (setor fictício).',
    slug: 'pronto-atendimento',
    responses: 600,
    profile: 'regular',
  },
  {
    code: 'INTERNACAO',
    name: 'Internação Clínica',
    description: 'Leitos de internação clínica adulta (setor fictício).',
    slug: 'internacao-clinica',
    responses: 480,
    profile: 'bom',
  },
  {
    code: 'UTI',
    name: 'Unidade de Terapia Intensiva',
    description: 'Cuidados intensivos para adultos (setor fictício).',
    slug: 'uti-adulto',
    responses: 240,
    profile: 'otimo',
  },
  {
    code: 'MATERNIDADE',
    name: 'Maternidade',
    description: 'Centro obstétrico e alojamento conjunto (setor fictício).',
    slug: 'maternidade',
    responses: 360,
    profile: 'otimo',
  },
  {
    code: 'AMBULATORIO',
    name: 'Ambulatório de Especialidades',
    description: 'Consultas eletivas com especialistas (setor fictício).',
    slug: 'ambulatorio',
    responses: 480,
    profile: 'bom',
  },
  {
    code: 'IMAGEM',
    name: 'Diagnóstico por Imagem',
    description: 'Exames de raio X, tomografia e ultrassonografia (setor fictício).',
    slug: 'diagnostico-por-imagem',
    responses: 240,
    profile: 'bom',
  },
];

const JOURNEY_STAGES = [
  { code: 'RECEPCAO', name: 'Recepção', position: 1 },
  { code: 'ATENDIMENTO', name: 'Atendimento', position: 2 },
  { code: 'AMBIENTE', name: 'Ambiente', position: 3 },
  { code: 'ALTA', name: 'Alta', position: 4 },
] as const;

type StageCode = (typeof JOURNEY_STAGES)[number]['code'];

const SPECIFIC_QUESTIONS: { stage: StageCode; text: string }[] = [
  { stage: 'RECEPCAO', text: 'Como você avalia a cordialidade na recepção?' },
  { stage: 'RECEPCAO', text: 'Como você avalia o tempo de espera para ser atendido?' },
  { stage: 'ATENDIMENTO', text: 'Como você avalia a clareza das explicações da equipe?' },
  { stage: 'ATENDIMENTO', text: 'Como você avalia a atenção recebida da equipe?' },
  { stage: 'AMBIENTE', text: 'Como você avalia a limpeza do ambiente?' },
  { stage: 'ALTA', text: 'Como você avalia as orientações recebidas na saída?' },
];

/** Mudança da v2 do Pronto Atendimento: sai a pergunta de espera, entra a de conforto. */
const PA_V2_REMOVED_TEXT = 'Como você avalia o tempo de espera para ser atendido?';
const PA_V2_NEW_QUESTION = {
  stage: 'AMBIENTE' as StageCode,
  text: 'Como você avalia o conforto da sala de espera?',
};

const USERS = [
  { key: 'sa', email: 'superadmin@example.com', role: 'superadmin', allSectors: true, sectors: [] },
  {
    key: 'as',
    email: 'admin.setor@example.com',
    role: 'sector_admin',
    allSectors: false,
    sectors: ['PA', 'AMBULATORIO'],
  },
  { key: 'ge', email: 'gestao@example.com', role: 'management', allSectors: true, sectors: [] },
  {
    key: 'ge-setores',
    email: 'gestao.setores@example.com',
    role: 'management',
    allSectors: false,
    sectors: ['INTERNACAO', 'UTI'],
  },
  { key: 'ou', email: 'ouvidoria@example.com', role: 'ombudsman', allSectors: true, sectors: [] },
  { key: 'vi', email: 'visualizador@example.com', role: 'viewer', allSectors: true, sectors: [] },
] as const;

const ROLE_LABEL: Record<(typeof USERS)[number]['role'], string> = {
  superadmin: 'Superadministrador',
  sector_admin: 'Administrador de Setor',
  management: 'Gestão',
  ombudsman: 'Ouvidoria',
  viewer: 'Visualizador',
};

const DESCRIPTIONS = {
  complaint: [
    'A espera na recepção passou de duas horas sem nenhuma informação sobre o atendimento.',
    'O banheiro da sala de espera estava sem papel e sem sabonete durante a tarde.',
    'Não recebi orientação clara sobre os cuidados que deveria ter depois da alta.',
    'A sala de espera estava cheia e não havia cadeiras suficientes para os acompanhantes.',
    'Precisei repetir as mesmas informações para profissionais diferentes.',
    'O ar-condicionado do quarto não funcionou durante a noite.',
    'Demorou muito para alguém responder quando chamei pela campainha do leito.',
  ],
  compliment: [
    'A equipe foi muito atenciosa e explicou cada procedimento com calma.',
    'Fui recebido com cordialidade e o atendimento foi rápido.',
    'O ambiente estava limpo e organizado, o que me deixou mais tranquilo.',
    'Agradeço a paciência da equipe com meu familiar durante toda a permanência.',
  ],
  suggestion: [
    'Seria bom ter um painel mostrando a ordem de chamada na recepção.',
    'Sugiro disponibilizar água para os acompanhantes na sala de espera.',
    'Poderiam entregar as orientações de alta também por escrito.',
    'Sugiro instalar mais tomadas na sala de espera para carregar o celular.',
  ],
} as const;

const ACTIONS = [
  'Coordenação do setor orientou a equipe e a Ouvidoria registrou o retorno (dado fictício).',
  'Ajuste na rotina de reposição de materiais e acompanhamento por 30 dias (dado fictício).',
  'Caso discutido em reunião de equipe com plano de melhoria definido (dado fictício).',
];

const NOTES = [
  'Encaminhado contato com a coordenação do setor para análise do caso.',
  'Aguardando parecer da equipe responsável pelo turno.',
  'Situação semelhante já registrada; acompanhar recorrência.',
];

const ARCHIVE_REASON = 'Arquivada: manifestação sem elementos suficientes para apuração.';

// -------------------------------------------------------------------------------------------
// Utilidades determinísticas
// -------------------------------------------------------------------------------------------

function weighted<T>(entries: [T, number][]): T {
  return faker.helpers.weightedArrayElement(
    entries.filter(([, weight]) => weight > 0).map(([value, weight]) => ({ value, weight })),
  );
}

function npsScore(profile: NpsProfile): number {
  return weighted(NPS_WEIGHTS[profile].map((weight, score) => [score, weight] as [number, number]));
}

function specificScore(nps: number): number {
  if (nps >= 9)
    return weighted([
      [5, 6],
      [4, 3],
      [3, 1],
    ]);
  if (nps >= 7)
    return weighted([
      [5, 2],
      [4, 4],
      [3, 3],
      [2, 1],
    ]);
  return weighted([
    [4, 1],
    [3, 3],
    [2, 4],
    [1, 3],
  ]);
}

/** JSON canônico (chaves ordenadas) e SHA-256, como o request_hash da Seção 4.3. */
function canonicalHash(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, inner]) => [key, canonical(inner)]),
      );
    }
    return input;
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

/** Remove a lista de notas específicas, gravada à parte em response_answers. */
function withoutAnswers<T extends { answers: unknown }>(row: T): Omit<T, 'answers'> {
  const copy: Partial<T> = { ...row };
  delete copy.answers;
  return copy as Omit<T, 'answers'>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

// -------------------------------------------------------------------------------------------
// Supabase Auth (opcional): contas de demonstração no ambiente local
// -------------------------------------------------------------------------------------------

interface AuthAdminConfig {
  url: string;
  secretKey: string;
  password: string;
}

async function ensureAuthUser(config: AuthAdminConfig, email: string): Promise<string> {
  const headers = { apikey: config.secretKey, 'Content-Type': 'application/json' };
  const base = `${config.url.replace(/\/$/, '')}/auth/v1/admin/users`;

  const created = await fetch(base, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password: config.password, email_confirm: true }),
  });
  if (created.ok) {
    const user = (await created.json()) as { id: string };
    return user.id;
  }
  if (created.status !== 422) {
    throw new Error(`Supabase Auth recusou a criação de ${email} (HTTP ${created.status}).`);
  }

  // Já existe (seed repetido): localiza pelo e-mail.
  const listed = await fetch(`${base}?page=1&per_page=1000`, { headers });
  if (!listed.ok)
    throw new Error(`Falha ao listar usuários do Supabase Auth (HTTP ${listed.status}).`);
  const body = (await listed.json()) as { users: { id: string; email?: string }[] };
  const existing = body.users.find((user) => user.email?.toLowerCase() === email);
  if (existing === undefined) throw new Error(`Usuário ${email} não encontrado no Supabase Auth.`);
  return existing.id;
}

// -------------------------------------------------------------------------------------------
// Geração do conjunto de dados (somente memória; nenhuma escrita)
// -------------------------------------------------------------------------------------------

interface ShiftPlan {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  sectorId: string;
  teamId: string;
  period: 'morning' | 'afternoon' | 'night';
  startsAt: Date;
  endsAt: Date;
  createdById: string;
  cancelledAt: Date | null;
  cancelledById: string | null;
  cancelReason: string | null;
}

function buildDataset(referenceDate: string) {
  faker.seed(FAKER_SEED);
  const uuid = () => faker.string.uuid();

  const firstResponseDay = addDays(referenceDate, -RESPONSE_DAYS);
  const v1PublishedAt = localInstant(addDays(firstResponseDay, -1), 8);
  const paV2PublishedAt = localInstant(addDays(referenceDate, -45), 8);
  const eventCap = addMinutes(localInstant(referenceDate, 0), -1);
  /** Instante fixo dos cadastros (created_at/updated_at), um dia antes da publicação da v1. */
  const setupAt = addMinutes(v1PublishedAt, -24 * 60);
  const stamps = { createdAt: setupAt, updatedAt: setupAt };

  // Hospital e etapas ---------------------------------------------------------------------
  const hospital: Prisma.HospitalCreateManyInput = {
    id: uuid(),
    name: 'Hospital Fictício de Demonstração',
    shortName: SEED_HOSPITAL_SHORT_NAME,
    timezone: 'America/Sao_Paulo',
    ...stamps,
  };
  const stages = JOURNEY_STAGES.map((stage) => ({
    id: uuid(),
    hospitalId: hospital.id as string,
    code: stage.code,
    name: stage.name,
    position: stage.position,
    ...stamps,
  }));
  const stageByCode = new Map(stages.map((stage) => [stage.code, stage]));

  // Setores e equipes ---------------------------------------------------------------------
  const sectors = SECTORS.map((spec) => ({ spec, id: uuid() }));
  const sectorByCode = new Map(sectors.map((sector) => [sector.spec.code, sector]));
  const teams = sectors.flatMap((sector) =>
    ['A', 'B', 'C'].map((letter) => ({
      id: uuid(),
      sectorId: sector.id,
      code: `EQUIPE-${letter}`,
      name: `Equipe ${letter}`,
      ...stamps,
    })),
  );

  // Usuários de demonstração (auth_user_id substituído se o Supabase Auth estiver configurado)
  const profiles = USERS.map((user) => ({
    user,
    id: uuid(),
    fallbackAuthUserId: uuid(),
  }));
  const profileByKey = new Map(profiles.map((profile) => [profile.user.key, profile]));
  const sa = profileByKey.get('sa');
  const as = profileByKey.get('as');
  const ou = profileByKey.get('ou');
  if (sa === undefined || as === undefined || ou === undefined)
    throw new Error('Usuários ausentes');
  const managerOf = (sectorCode: string) =>
    (as.user.sectors as readonly string[]).includes(sectorCode) ? as.id : sa.id;

  // Pesquisas, perguntas e versões ---------------------------------------------------------
  const surveyConfigs: Prisma.SurveyConfigCreateManyInput[] = [];
  const questions: Prisma.QuestionCreateManyInput[] = [];
  const versions: Prisma.SurveyVersionCreateManyInput[] = [];
  const versionQuestions: Prisma.SurveyVersionQuestionCreateManyInput[] = [];
  const currentVersionBySurvey = new Map<string, string>();
  const deactivatedQuestionIds: string[] = [];
  /** Versões por setor, em ordem de publicação, com as perguntas específicas de cada uma. */
  const versionsBySector = new Map<
    string,
    { id: string; publishedAt: Date; specifics: { svqId: string; questionId: string }[] }[]
  >();

  for (const sector of sectors) {
    const surveyId = uuid();
    const authorId = managerOf(sector.spec.code);
    surveyConfigs.push({
      id: surveyId,
      sectorId: sector.id,
      title: `Avalie o setor ${sector.spec.name}`,
      slug: sector.spec.slug,
      introText: 'Sua opinião é anônima e leva menos de um minuto.',
      thankYouMessage:
        'Obrigado por avaliar o atendimento. Sua opinião ajuda a melhorar o hospital.',
      hasUnpublishedChanges: false,
      createdById: authorId,
      createdAt: v1PublishedAt,
      updatedAt: v1PublishedAt,
    });

    const npsQuestion = {
      id: uuid(),
      surveyConfigId: surveyId,
      journeyStageId: null,
      type: 'nps' as const,
      text: NPS_QUESTION_TEXT,
      isRequired: true,
      position: 1,
      firstPublishedAt: v1PublishedAt,
      createdAt: v1PublishedAt,
      updatedAt: v1PublishedAt,
    };
    const specifics = SPECIFIC_QUESTIONS.map((question, index) => ({
      id: uuid(),
      surveyConfigId: surveyId,
      journeyStageId: stageByCode.get(question.stage)?.id ?? null,
      type: 'scale_1_5' as const,
      text: question.text,
      isRequired: false,
      position: index + 2,
      firstPublishedAt: v1PublishedAt,
      createdAt: v1PublishedAt,
      updatedAt: v1PublishedAt,
    }));
    questions.push(npsQuestion, ...specifics);

    const publish = (
      versionNumber: number,
      publishedAt: Date,
      versionQuestionsList: typeof specifics,
    ) => {
      const versionId = uuid();
      versions.push({
        id: versionId,
        surveyConfigId: surveyId,
        sectorId: sector.id,
        versionNumber,
        title: `Avalie o setor ${sector.spec.name}`,
        introText: 'Sua opinião é anônima e leva menos de um minuto.',
        thankYouMessage:
          'Obrigado por avaliar o atendimento. Sua opinião ajuda a melhorar o hospital.',
        publishedAt,
        publishedById: authorId,
      });
      const rows = [npsQuestion, ...versionQuestionsList].map((question, index) => {
        const stage = stages.find((item) => item.id === question.journeyStageId);
        return {
          id: uuid(),
          surveyVersionId: versionId,
          questionId: question.id,
          type: question.type,
          text: question.text,
          journeyStageId: stage?.id ?? null,
          journeyStageName: stage?.name ?? null,
          journeyStagePosition: stage?.position ?? null,
          position: index + 1,
          isRequired: question.isRequired,
        };
      });
      versionQuestions.push(...rows);
      const list = versionsBySector.get(sector.id) ?? [];
      list.push({
        id: versionId,
        publishedAt,
        specifics: rows
          .filter((row) => row.type === 'scale_1_5')
          .map((row) => ({ svqId: row.id, questionId: row.questionId })),
      });
      versionsBySector.set(sector.id, list);
      currentVersionBySurvey.set(surveyId, versionId);
      return versionId;
    };

    const v1Id = publish(1, v1PublishedAt, specifics);

    if (sector.spec.code === 'PA') {
      const removed = specifics.find((question) => question.text === PA_V2_REMOVED_TEXT);
      if (removed === undefined) throw new Error('Pergunta da v2 não encontrada');
      deactivatedQuestionIds.push(removed.id);
      const added = {
        id: uuid(),
        surveyConfigId: surveyId,
        journeyStageId: stageByCode.get(PA_V2_NEW_QUESTION.stage)?.id ?? null,
        type: 'scale_1_5' as const,
        text: PA_V2_NEW_QUESTION.text,
        isRequired: false,
        position: specifics.length + 2,
        firstPublishedAt: paV2PublishedAt,
        createdAt: addMinutes(paV2PublishedAt, -60),
        updatedAt: paV2PublishedAt,
      };
      questions.push(added);
      publish(2, paV2PublishedAt, [
        ...specifics.filter((question) => question.id !== removed.id),
        added,
      ]);
      const v1 = versions.find((version) => version.id === v1Id);
      if (v1 !== undefined) v1.supersededAt = paV2PublishedAt;
    }
  }

  // Turnos: rodízio diário de 3 equipes (manhã 07–13, tarde 13–19, noite 19–07) -------------
  const shifts: ShiftPlan[] = [];
  const firstShiftDay = firstResponseDay;
  for (const sector of sectors) {
    const sectorTeams = teams.filter((team) => team.sectorId === sector.id);
    const createdById = managerOf(sector.spec.code);
    for (let day = 0; day < SHIFT_DAYS; day += 1) {
      const ymd = addDays(firstShiftDay, day);
      const teamAt = (offset: number) => sectorTeams[(day + offset) % 3]?.id ?? '';
      const base = {
        sectorId: sector.id,
        createdById,
        cancelledAt: null,
        cancelledById: null,
        ...stamps,
      };
      shifts.push(
        {
          ...base,
          id: uuid(),
          teamId: teamAt(0),
          period: 'morning',
          startsAt: localInstant(ymd, 7),
          endsAt: localInstant(ymd, 13),
          cancelReason: null,
        },
        {
          ...base,
          id: uuid(),
          teamId: teamAt(1),
          period: 'afternoon',
          startsAt: localInstant(ymd, 13),
          endsAt: localInstant(ymd, 19),
          cancelReason: null,
        },
        {
          ...base,
          id: uuid(),
          teamId: teamAt(2),
          period: 'night',
          startsAt: localInstant(ymd, 19),
          endsAt: localInstant(addDays(ymd, 1), 7),
          cancelReason: null,
        },
      );
      // Reforço no PA às segundas, quartas e sextas (10–16), pela equipe de folga: dois turnos
      // simultâneos no setor tornam a atribuição ambígua (RN07).
      if (sector.spec.code === 'PA' && [1, 3, 5].includes(weekday(ymd))) {
        shifts.push({
          ...base,
          id: uuid(),
          teamId: teamAt(2),
          period: 'morning',
          startsAt: localInstant(ymd, 10),
          endsAt: localInstant(ymd, 16),
          cancelReason: null,
        });
      }
    }
  }

  // Alguns turnos passados cancelados (RF21): respostas nesses horários ficam sem turno.
  const pastShifts = shifts.filter((shift) => shift.endsAt < localInstant(referenceDate, 0));
  for (const shift of faker.helpers.arrayElements(pastShifts, 12)) {
    shift.cancelledAt = addMinutes(shift.startsAt, -24 * 60);
    shift.cancelledById = sa.id;
    shift.cancelReason = 'Escala alterada pela coordenação do setor (dado fictício).';
    shift.updatedAt = shift.cancelledAt;
  }

  // Respostas -------------------------------------------------------------------------------
  const hourWeights: [number, number][] = [
    [0, 1],
    [1, 1],
    [2, 1],
    [3, 1],
    [4, 1],
    [5, 1],
    [6, 2],
    [7, 4],
    [8, 7],
    [9, 9],
    [10, 10],
    [11, 10],
    [12, 8],
    [13, 7],
    [14, 9],
    [15, 10],
    [16, 9],
    [17, 8],
    [18, 7],
    [19, 6],
    [20, 5],
    [21, 4],
    [22, 3],
    [23, 2],
  ];

  interface ResponsePlan {
    id: string;
    surveyVersionId: string;
    sectorId: string;
    origin: 'qr_code' | 'link';
    npsScore: number;
    lowScore: boolean;
    submittedAt: Date;
    attributionStatus: 'attributed' | 'not_qr_origin' | 'no_shift' | 'ambiguous';
    shiftId: string | null;
    teamId: string | null;
    shiftPeriod: 'morning' | 'afternoon' | 'night' | null;
    idempotencyKey: string;
    requestHash: string;
    manifestationTokenExpiresAt: Date;
    manifestationTokenUsedAt: Date | null;
    answers: { id: string; svqId: string; score: number }[];
  }

  const responses: ResponsePlan[] = [];
  for (const sector of sectors) {
    const sectorVersions = versionsBySector.get(sector.id) ?? [];
    const sectorShifts = shifts.filter((shift) => shift.sectorId === sector.id);
    for (let i = 0; i < sector.spec.responses; i += 1) {
      const ymd = addDays(firstResponseDay, faker.number.int({ min: 0, max: RESPONSE_DAYS - 1 }));
      const submittedAt = localInstant(
        ymd,
        weighted(hourWeights),
        faker.number.int({ min: 0, max: 59 }),
        faker.number.int({ min: 0, max: 59 }),
        faker.number.int({ min: 0, max: 999 }),
      );
      const version =
        [...sectorVersions].reverse().find((item) => item.publishedAt <= submittedAt) ??
        sectorVersions[0];
      if (version === undefined) throw new Error('Versão ausente');

      const origin = faker.datatype.boolean({ probability: 0.7 }) ? 'qr_code' : 'link';
      const nps = npsScore(sector.spec.profile);
      const answers = version.specifics
        .filter(() => faker.datatype.boolean({ probability: 0.65 }))
        .map((question) => ({
          id: uuid(),
          svqId: question.svqId,
          questionId: question.questionId,
          score: specificScore(nps),
        }));

      let attributionStatus: ResponsePlan['attributionStatus'] = 'not_qr_origin';
      let shift: ShiftPlan | undefined;
      if (origin === 'qr_code') {
        const matches = sectorShifts.filter(
          (item) =>
            item.cancelledAt === null && item.startsAt <= submittedAt && submittedAt < item.endsAt,
        );
        attributionStatus =
          matches.length === 0 ? 'no_shift' : matches.length === 1 ? 'attributed' : 'ambiguous';
        shift = matches.length === 1 ? matches[0] : undefined;
      }

      const requestBody = {
        surveyVersionId: version.id,
        origin,
        npsScore: nps,
        answers: answers
          .map(({ questionId, score }) => ({ questionId, score }))
          .sort((a, b) => a.questionId.localeCompare(b.questionId)),
      };

      responses.push({
        id: uuid(),
        surveyVersionId: version.id,
        sectorId: sector.id,
        origin,
        npsScore: nps,
        lowScore: nps <= 6 || answers.some((answer) => answer.score <= 2),
        submittedAt,
        attributionStatus,
        shiftId: shift?.id ?? null,
        teamId: shift?.teamId ?? null,
        shiftPeriod: shift?.period ?? null,
        idempotencyKey: uuid(),
        requestHash: canonicalHash(requestBody),
        manifestationTokenExpiresAt: addMinutes(submittedAt, 60),
        manifestationTokenUsedAt: null,
        answers: answers.map(({ id, svqId, score }) => ({ id, svqId, score })),
      });
    }
  }
  responses.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  if (responses.length !== RESPONSES_TOTAL) throw new Error('Total de respostas divergente');

  // Manifestações ---------------------------------------------------------------------------
  const lowScoreResponses = responses.filter((response) => response.lowScore);
  const otherResponses = responses.filter((response) => !response.lowScore);
  const chosen = [
    ...faker.helpers.arrayElements(lowScoreResponses, 130),
    ...faker.helpers.arrayElements(otherResponses, MANIFESTATIONS_TOTAL - 130),
  ].sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const withContact = new Set(
    faker.helpers.shuffle(chosen.map((response) => response.id)).slice(0, CONTACTS_TOTAL),
  );

  const manifestations: (Omit<Prisma.ManifestationCreateManyInput, 'protocol'> & {
    id: string;
    receivedAt: Date;
  })[] = [];
  const contacts: Prisma.ManifestationContactCreateManyInput[] = [];
  const notes: Prisma.ManifestationNoteCreateManyInput[] = [];

  chosen.forEach((response, index) => {
    const type: 'complaint' | 'compliment' | 'suggestion' = response.lowScore
      ? weighted([
          ['complaint', 8],
          ['suggestion', 2],
        ])
      : weighted([
          ['compliment', 7],
          ['suggestion', 3],
        ]);
    const latest = addMinutes(eventCap, -1);
    const received = addMinutes(response.submittedAt, faker.number.int({ min: 2, max: 50 }));
    const receivedAt = received > latest ? addMinutes(response.submittedAt, 0.5) : received;
    response.manifestationTokenUsedAt = receivedAt;

    const id = uuid();
    const isAnonymous = !withContact.has(response.id);
    let priority: 'low' | 'medium' | 'high' =
      type === 'complaint'
        ? weighted([
            ['medium', 5],
            ['high', 3],
            ['low', 2],
          ])
        : weighted([
            ['low', 5],
            ['medium', 4],
            ['high', 1],
          ]);
    const status = weighted<'received' | 'in_review' | 'forwarded' | 'resolved' | 'archived'>([
      ['received', 20],
      ['in_review', 20],
      ['forwarded', 15],
      ['resolved', 35],
      ['archived', 10],
    ]);

    // Linha do tempo coerente com a RN23.
    type Step =
      | { kind: 'status_changed'; from: string; to: string }
      | { kind: 'priority_changed'; from: string; to: string }
      | { kind: 'actions_updated'; content: string }
      | { kind: 'note'; content: string };
    const steps: Step[] = [];
    let actionsTaken: string | null = null;
    if (status === 'archived') {
      steps.push({ kind: 'note', content: ARCHIVE_REASON });
      steps.push({ kind: 'status_changed', from: 'received', to: 'archived' });
    } else if (status !== 'received') {
      steps.push({ kind: 'status_changed', from: 'received', to: 'in_review' });
      if (faker.datatype.boolean({ probability: 0.3 })) {
        steps.push({ kind: 'note', content: faker.helpers.arrayElement(NOTES) });
      }
      if (priority === 'medium' && faker.datatype.boolean({ probability: 0.2 })) {
        steps.push({ kind: 'priority_changed', from: 'medium', to: 'high' });
        priority = 'high';
      }
      const forwarded =
        status === 'forwarded' || (status === 'resolved' && faker.datatype.boolean());
      if (forwarded) steps.push({ kind: 'status_changed', from: 'in_review', to: 'forwarded' });
      if (status === 'resolved') {
        actionsTaken = faker.helpers.arrayElement(ACTIONS);
        steps.push({ kind: 'actions_updated', content: actionsTaken });
        steps.push({
          kind: 'status_changed',
          from: forwarded ? 'forwarded' : 'in_review',
          to: 'resolved',
        });
      }
    }

    const span = eventCap.getTime() - receivedAt.getTime();
    const step = Math.min(26 * 3_600_000, Math.floor(span / (steps.length + 1)));
    let lastAt = receivedAt;
    let resolvedAt: Date | null = null;
    notes.push({
      id: uuid(),
      manifestationId: id,
      authorId: null,
      kind: 'created',
      toValue: 'received',
      createdAt: receivedAt,
    });
    steps.forEach((item, stepIndex) => {
      const at = new Date(receivedAt.getTime() + step * (stepIndex + 1));
      lastAt = at;
      const base = { id: uuid(), manifestationId: id, authorId: ou.id, createdAt: at };
      if (item.kind === 'status_changed' || item.kind === 'priority_changed') {
        notes.push({ ...base, kind: item.kind, fromValue: item.from, toValue: item.to });
        if (item.kind === 'status_changed' && item.to === 'resolved') resolvedAt = at;
      } else {
        notes.push({ ...base, kind: item.kind, content: item.content });
      }
    });

    manifestations.push({
      id,
      responseId: response.id,
      sectorId: response.sectorId,
      type,
      description: faker.helpers.arrayElement(DESCRIPTIONS[type]),
      isAnonymous,
      triggeredByLowScore: response.lowScore,
      status,
      priority,
      actionsTaken,
      receivedAt,
      resolvedAt,
      updatedById: steps.length > 0 ? ou.id : null,
      idempotencyKey: uuid(),
      requestHash: canonicalHash({ responseId: response.id, type, anonymous: isAnonymous, index }),
      createdAt: receivedAt,
      updatedAt: lastAt,
    });

    if (!isAnonymous) {
      const number = String(contacts.length + 1).padStart(3, '0');
      const channel = contacts.length % 3; // 0: e-mail; 1: telefone; 2: ambos
      contacts.push({
        manifestationId: id,
        fullName: `Contato Fictício ${number}`,
        phone: channel === 0 ? null : `5190000${String(contacts.length + 1).padStart(4, '0')}`,
        email: channel === 1 ? null : `contato.ficticio.${number}@example.com`,
        consentGivenAt: receivedAt,
        purposeTextVersion: PURPOSE_TEXT_VERSION,
        createdAt: receivedAt,
      });
    }
  });

  return {
    referenceDate,
    setupAt,
    hospital,
    stages,
    sectors,
    sectorByCode,
    teams,
    profiles,
    surveyConfigs,
    questions,
    versions,
    versionQuestions,
    currentVersionBySurvey,
    deactivatedQuestionIds,
    paV2PublishedAt,
    shifts,
    responses,
    manifestations,
    contacts,
    notes,
    sa,
  };
}

// -------------------------------------------------------------------------------------------
// Gravação
// -------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const parsed = seedEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Variáveis inválidas para o seed: ${names.join(', ')}.`);
  }
  const env = parsed.data;
  const allowRemote = env.SEED_ALLOW_REMOTE === 'true';
  if (!allowRemote) {
    assertLocalTargets({ DATABASE_URL: env.DATABASE_URL, SUPABASE_URL: env.SUPABASE_URL }, 'Seed');
  }

  const referenceDate = env.SEED_REFERENCE_DATE ?? todayInSaoPaulo();
  if (referenceDate > todayInSaoPaulo()) {
    throw new Error('SEED_REFERENCE_DATE não pode estar no futuro.');
  }

  const prisma = createPrismaClient(env.DATABASE_URL);
  try {
    const existing = await prisma.hospital.findMany({ select: { shortName: true } });
    if (existing.length > 0) {
      if (existing.some((hospital) => hospital.shortName === SEED_HOSPITAL_SHORT_NAME)) {
        console.info(
          'Seed já aplicado neste banco: nada foi gravado. Para recriar, use `npm run db:reset` (somente local).',
        );
        return;
      }
      throw new Error('O banco já possui dados que não são do seed; nada foi gravado.');
    }

    const data = buildDataset(referenceDate);

    // Contas no Supabase Auth local (opcional). Sem elas, auth_user_id recebe UUIDs fictícios.
    const authUserIds = new Map<string, string>();
    if (env.SUPABASE_URL !== undefined && env.SUPABASE_SECRET_KEY !== undefined) {
      if (env.SEED_DEMO_PASSWORD === undefined) {
        throw new Error(
          'Defina SEED_DEMO_PASSWORD (10+ caracteres, letras e números) para criar as contas de demonstração.',
        );
      }
      const config = {
        url: env.SUPABASE_URL,
        secretKey: env.SUPABASE_SECRET_KEY,
        password: env.SEED_DEMO_PASSWORD,
      };
      for (const profile of data.profiles) {
        authUserIds.set(profile.user.key, await ensureAuthUser(config, profile.user.email));
      }
    } else {
      console.warn(
        'SUPABASE_URL/SUPABASE_SECRET_KEY ausentes: perfis criados sem contas no Supabase Auth.',
      );
    }

    console.info(
      `Gravando seed (referência ${referenceDate}) em ${describeUrl(env.DATABASE_URL)}...`,
    );

    await prisma.$transaction(
      async (tx) => {
        await tx.hospital.create({ data: data.hospital });
        await tx.journeyStage.createMany({ data: data.stages });
        await tx.sector.createMany({
          data: data.sectors.map(({ spec, id }) => ({
            id,
            hospitalId: data.hospital.id as string,
            code: spec.code,
            name: spec.name,
            description: spec.description,
            createdAt: data.setupAt,
            updatedAt: data.setupAt,
          })),
        });

        const profileRows = data.profiles.map(({ user, id, fallbackAuthUserId }) => ({
          id,
          hospitalId: data.hospital.id as string,
          authUserId: authUserIds.get(user.key) ?? fallbackAuthUserId,
          fullName: `Demonstração — ${ROLE_LABEL[user.role]}${user.allSectors ? '' : ' (setores)'}`,
          email: user.email,
          role: user.role,
          allSectors: user.allSectors,
          mustChangePassword: false,
          createdById: user.key === 'sa' ? null : data.sa.id,
          createdAt: data.setupAt,
          updatedAt: data.setupAt,
        }));
        await tx.profile.createMany({
          data: profileRows.filter((row) => row.createdById === null),
        });
        await tx.profile.createMany({
          data: profileRows.filter((row) => row.createdById !== null),
        });
        await tx.profileSector.createMany({
          data: data.profiles.flatMap(({ user, id }) =>
            user.sectors.map((code) => ({
              profileId: id,
              sectorId: data.sectorByCode.get(code)?.id ?? '',
              createdById: data.sa.id,
              createdAt: data.setupAt,
            })),
          ),
        });
        await tx.team.createMany({ data: data.teams });

        await tx.surveyConfig.createMany({ data: data.surveyConfigs });
        await tx.question.createMany({ data: data.questions });
        await tx.surveyVersion.createMany({ data: data.versions });
        await tx.surveyVersionQuestion.createMany({ data: data.versionQuestions });
        for (const [surveyId, versionId] of data.currentVersionBySurvey) {
          const publishedAt = data.versions.find(
            (version) => version.id === versionId,
          )?.publishedAt;
          await tx.surveyConfig.update({
            where: { id: surveyId },
            data: {
              currentVersionId: versionId,
              ...(publishedAt ? { updatedAt: publishedAt } : {}),
            },
          });
        }
        await tx.question.updateMany({
          where: { id: { in: data.deactivatedQuestionIds } },
          data: { isActive: false, updatedAt: data.paV2PublishedAt },
        });

        for (const part of chunk(data.shifts, 1000)) {
          await tx.shift.createMany({
            data: part.map((shift) => ({ ...shift, source: 'manual' as const })),
          });
        }
        for (const part of chunk(data.responses, 500)) {
          await tx.response.createMany({ data: part.map(withoutAnswers) });
        }
        const answers = data.responses.flatMap((response) =>
          response.answers.map((answer) => ({
            id: answer.id,
            responseId: response.id,
            surveyVersionId: response.surveyVersionId,
            surveyVersionQuestionId: answer.svqId,
            questionType: 'scale_1_5' as const,
            score: answer.score,
          })),
        );
        for (const part of chunk(answers, 1000)) {
          await tx.responseAnswer.createMany({ data: part });
        }

        // Protocolos gerados pela sequência do banco, em ordem cronológica (ano local do registro).
        const manifestationRows: Prisma.ManifestationCreateManyInput[] = [];
        for (const manifestation of data.manifestations) {
          const [row] = await tx.$queryRaw<{ protocol: string }[]>`
            SELECT public.next_manifestation_protocol(${manifestation.receivedAt}::timestamptz) AS protocol`;
          if (row === undefined) throw new Error('Protocolo não gerado');
          manifestationRows.push({ ...manifestation, protocol: row.protocol });
        }
        await tx.manifestation.createMany({ data: manifestationRows });
        await tx.manifestationContact.createMany({ data: data.contacts });
        await tx.manifestationNote.createMany({ data: data.notes });
      },
      { maxWait: 10_000, timeout: 300_000 },
    );

    console.info(
      `Seed concluído: ${data.responses.length} respostas, ${data.manifestations.length} manifestações, ` +
        `${data.contacts.length} contatos e ${data.shifts.length} turnos. Confira com \`npm run db:seed:verify\`.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
