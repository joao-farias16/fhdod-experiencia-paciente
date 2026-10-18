/** Perfis administrativos (Seção 6). O paciente/acompanhante não tem conta. */
export type UserRole = 'superadmin' | 'sector_admin' | 'management' | 'ombudsman' | 'viewer';

export const ROLE_LABELS: Record<UserRole, string> = {
  superadmin: 'Superadministrador',
  sector_admin: 'Administrador de setor',
  management: 'Gestão',
  ombudsman: 'Ouvidoria',
  viewer: 'Visualizador',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  superadmin: 'Usuários, estrutura e auditoria. Escopo global, sem textos e contatos.',
  sector_admin: 'Pesquisas, equipes, turnos e importações dos setores associados.',
  management: 'Indicadores, comparações e relatórios.',
  ombudsman: 'Manifestações, notas, providências e contatos.',
  viewer: 'Indicadores agregados, com supressão de grupos pequenos.',
};

export interface SectorSummary {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

/** Resposta do E04 (GET /me): perfil, escopo e permissões calculadas pelo backend. */
export interface Me {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  allSectors: boolean;
  sectors: SectorSummary[];
  mustChangePassword: boolean;
  permissions: string[];
}

/**
 * Tela inicial do perfil (RF01). Nesta etapa existem a administração de usuários (SA) e a página
 * inicial administrativa; o painel (TL03) e a Ouvidoria (TL12) chegam nas ET07 e ET08.
 */
export function homePathFor(me: Me): string {
  return me.permissions.includes('users:read') ? '/admin/usuarios' : '/painel';
}

export function can(me: Me, permission: string): boolean {
  return me.permissions.includes(permission);
}
