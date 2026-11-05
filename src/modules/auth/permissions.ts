import type { UserRole } from '../../lib/prisma.js';

/**
 * Permissões da matriz da Seção 6 (Tabela 13). Cada endpoint autenticado exige exatamente uma
 * permissão; o escopo de setores ("*" na matriz) é aplicado depois, nos serviços (RN10, RN18).
 * A lista é devolvida por E04 e usada pelo frontend para montar o menu — mas a decisão de acesso
 * é sempre do backend (requirePermission).
 */
export const PERMISSIONS = [
  // Próprio perfil e senha (todos os perfis)
  'profile:read',
  'profile:change_password',
  // Usuários e senha temporária (SA)
  'users:read',
  'users:create',
  'users:update',
  'users:reset_password',
  // Setores (consulta para todos, no escopo; cadastro e alteração pelo SA)
  'sectors:read',
  'sectors:create',
  'sectors:update',
  // Equipes
  'teams:read',
  'teams:create',
  'teams:update',
  // Etapas da jornada
  'journey_stages:read',
  // Turnos e importação de escala
  'shifts:read',
  'shifts:create',
  'shifts:cancel',
  'rosters:import',
  // Pesquisas, perguntas, publicação e QR Code
  'surveys:read',
  'surveys:create',
  'surveys:update',
  'surveys:publish',
  // Indicadores do dashboard (VI com supressão, RN21)
  'dashboard:read',
  // Relatórios Excel (E34, conforme o tipo)
  'reports:export_responses',
  'reports:export_indicators',
  'reports:export_manifestations',
  // Ouvidoria
  'manifestations:read',
  'manifestations:update',
  'manifestations:add_note',
  'manifestation_contact:read',
  'manifestation_contact:delete',
  // Auditoria
  'audit_logs:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const COMMON: readonly Permission[] = [
  'profile:read',
  'profile:change_password',
  'sectors:read',
  'teams:read',
  'dashboard:read',
];

/** Tabela 13: permissões por perfil. "–" na matriz = permissão ausente (403 FORBIDDEN). */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  superadmin: [
    ...COMMON,
    'users:read',
    'users:create',
    'users:update',
    'users:reset_password',
    'sectors:create',
    'sectors:update',
    'teams:create',
    'teams:update',
    'journey_stages:read',
    'shifts:read',
    'shifts:create',
    'shifts:cancel',
    'rosters:import',
    'surveys:read',
    'surveys:create',
    'surveys:update',
    'surveys:publish',
    'reports:export_responses',
    'reports:export_indicators',
    'audit_logs:read',
  ],
  sector_admin: [
    ...COMMON,
    'teams:create',
    'teams:update',
    'journey_stages:read',
    'shifts:read',
    'shifts:create',
    'shifts:cancel',
    'rosters:import',
    'surveys:read',
    'surveys:create',
    'surveys:update',
    'surveys:publish',
    'reports:export_responses',
    'reports:export_indicators',
  ],
  management: [...COMMON, 'reports:export_responses', 'reports:export_indicators'],
  ombudsman: [
    ...COMMON,
    'reports:export_manifestations',
    'manifestations:read',
    'manifestations:update',
    'manifestations:add_note',
    'manifestation_contact:read',
    'manifestation_contact:delete',
  ],
  viewer: [...COMMON],
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Permissões do perfil em ordem estável (resposta de E04). */
export function permissionsFor(role: UserRole): Permission[] {
  return PERMISSIONS.filter((permission) => ROLE_PERMISSIONS[role].includes(permission));
}

export type EndpointAccess = 'public' | Permission;

export interface EndpointDefinition {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  access: EndpointAccess;
  /** Implementado nesta etapa (rota existente no Express). */
  implemented: boolean;
}

/**
 * Contratos da Tabela 19 com a permissão exigida (Tabela 13). E34 tem uma linha por tipo de
 * relatório, pois a permissão depende do parâmetro `type`. Os endpoints de etapas futuras usam
 * este catálogo ao serem implementados; o teste T14 verifica a matriz inteira.
 */
export const ENDPOINTS = {
  E01: { method: 'GET', path: '/public/surveys/:slug', access: 'public', implemented: true },
  E02: { method: 'POST', path: '/public/responses', access: 'public', implemented: true },
  E03: { method: 'POST', path: '/public/manifestations', access: 'public', implemented: true },
  E04: { method: 'GET', path: '/me', access: 'profile:read', implemented: true },
  E05: {
    method: 'POST',
    path: '/me/password',
    access: 'profile:change_password',
    implemented: true,
  },
  E06: { method: 'GET', path: '/admin/users', access: 'users:read', implemented: true },
  E07: { method: 'POST', path: '/admin/users', access: 'users:create', implemented: true },
  E08: { method: 'PATCH', path: '/admin/users/:id', access: 'users:update', implemented: true },
  E09: {
    method: 'POST',
    path: '/admin/users/:id/reset-password',
    access: 'users:reset_password',
    implemented: true,
  },
  E10: { method: 'GET', path: '/admin/sectors', access: 'sectors:read', implemented: true },
  E11: { method: 'POST', path: '/admin/sectors', access: 'sectors:create', implemented: true },
  E12: {
    method: 'PATCH',
    path: '/admin/sectors/:id',
    access: 'sectors:update',
    implemented: true,
  },
  E13: { method: 'GET', path: '/admin/teams', access: 'teams:read', implemented: true },
  E14: { method: 'POST', path: '/admin/teams', access: 'teams:create', implemented: true },
  E15: { method: 'PATCH', path: '/admin/teams/:id', access: 'teams:update', implemented: true },
  E16: {
    method: 'GET',
    path: '/admin/journey-stages',
    access: 'journey_stages:read',
    implemented: true,
  },
  E17: { method: 'GET', path: '/admin/shifts', access: 'shifts:read', implemented: true },
  E18: { method: 'POST', path: '/admin/shifts', access: 'shifts:create', implemented: true },
  E19: { method: 'PATCH', path: '/admin/shifts/:id', access: 'shifts:cancel', implemented: true },
  E20: {
    method: 'POST',
    path: '/admin/rosters/import',
    access: 'rosters:import',
    implemented: true,
  },
  E21: {
    method: 'POST',
    path: '/admin/rosters/imports/:id/confirm',
    access: 'rosters:import',
    implemented: true,
  },
  E22: { method: 'GET', path: '/admin/surveys', access: 'surveys:read', implemented: true },
  E23: { method: 'GET', path: '/admin/surveys/:id', access: 'surveys:read', implemented: true },
  E24: { method: 'POST', path: '/admin/surveys', access: 'surveys:create', implemented: true },
  E25: {
    method: 'PATCH',
    path: '/admin/surveys/:id',
    access: 'surveys:update',
    implemented: true,
  },
  E26: {
    method: 'POST',
    path: '/admin/surveys/:id/publish',
    access: 'surveys:publish',
    implemented: true,
  },
  E27: { method: 'GET', path: '/admin/surveys/:id/qr', access: 'surveys:read', implemented: true },
  E28: { method: 'GET', path: '/dashboard/summary', access: 'dashboard:read', implemented: true },
  E29: { method: 'GET', path: '/dashboard/sectors', access: 'dashboard:read', implemented: true },
  E30: { method: 'GET', path: '/dashboard/shifts', access: 'dashboard:read', implemented: true },
  E31: { method: 'GET', path: '/dashboard/teams', access: 'dashboard:read', implemented: true },
  E32: { method: 'GET', path: '/dashboard/trends', access: 'dashboard:read', implemented: true },
  E33: {
    method: 'GET',
    path: '/dashboard/questions',
    access: 'dashboard:read',
    implemented: true,
  },
  'E34-respostas': {
    method: 'GET',
    path: '/reports/export?type=responses',
    access: 'reports:export_responses',
    implemented: true,
  },
  'E34-indicadores': {
    method: 'GET',
    path: '/reports/export?type=indicators',
    access: 'reports:export_indicators',
    implemented: true,
  },
  'E34-manifestacoes': {
    method: 'GET',
    path: '/reports/export?type=manifestations',
    access: 'reports:export_manifestations',
    implemented: true,
  },
  E35: {
    method: 'GET',
    path: '/ouvidoria/manifestations',
    access: 'manifestations:read',
    implemented: true,
  },
  E36: {
    method: 'GET',
    path: '/ouvidoria/manifestations/:id',
    access: 'manifestations:read',
    implemented: true,
  },
  E37: {
    method: 'PATCH',
    path: '/ouvidoria/manifestations/:id',
    access: 'manifestations:update',
    implemented: true,
  },
  E38: {
    method: 'POST',
    path: '/ouvidoria/manifestations/:id/notes',
    access: 'manifestations:add_note',
    implemented: true,
  },
  E39: {
    method: 'GET',
    path: '/ouvidoria/manifestations/:id/contact',
    access: 'manifestation_contact:read',
    implemented: true,
  },
  E40: {
    method: 'DELETE',
    path: '/ouvidoria/manifestations/:id/contact',
    access: 'manifestation_contact:delete',
    implemented: true,
  },
  E41: { method: 'GET', path: '/admin/audit-logs', access: 'audit_logs:read', implemented: true },
  E42: { method: 'GET', path: '/tv-wall/summary', access: 'public', implemented: false },
  E43: { method: 'GET', path: '/health', access: 'public', implemented: true },
} as const satisfies Record<string, EndpointDefinition>;

export type EndpointId = keyof typeof ENDPOINTS;
