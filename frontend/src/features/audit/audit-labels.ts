import { ROLE_LABELS, type UserRole } from '../auth/auth-types';

/** Catálogo de ações auditadas (backend: AUDIT_ACTIONS) com rótulos em português. */
export const ACTION_LABELS: Record<string, string> = {
  USER_CREATED: 'Usuário cadastrado',
  USER_UPDATED: 'Usuário alterado',
  USER_DEACTIVATED: 'Usuário desativado',
  USER_REACTIVATED: 'Usuário reativado',
  USER_PASSWORD_RESET: 'Senha redefinida pelo superadministrador',
  PASSWORD_CHANGED: 'Senha trocada pelo próprio usuário',
  AUTHORIZATION_DENIED: 'Acesso negado',
  SECTOR_CREATED: 'Setor cadastrado',
  SECTOR_UPDATED: 'Setor alterado',
  SECTOR_DEACTIVATED: 'Setor desativado',
  SECTOR_REACTIVATED: 'Setor reativado',
  TEAM_CREATED: 'Equipe cadastrada',
  TEAM_UPDATED: 'Equipe alterada',
  TEAM_DEACTIVATED: 'Equipe desativada',
  TEAM_REACTIVATED: 'Equipe reativada',
  SHIFT_CREATED: 'Turno cadastrado',
  SHIFT_CANCELLED: 'Turno cancelado',
  ROSTER_IMPORT_VALIDATED: 'Escala validada para importação',
  ROSTER_IMPORT_REJECTED: 'Escala recusada na validação',
  ROSTER_IMPORT_COMMITTED: 'Escala importada',
  SURVEY_CREATED: 'Pesquisa criada',
  SURVEY_UPDATED: 'Pesquisa alterada',
  SURVEY_DEACTIVATED: 'Pesquisa desativada',
  SURVEY_REACTIVATED: 'Pesquisa reativada',
  SURVEY_PUBLISHED: 'Versão da pesquisa publicada',
};

export const ENTITY_LABELS: Record<string, string> = {
  profile: 'Usuário',
  endpoint: 'Rota da API',
  sector: 'Setor',
  team: 'Equipe',
  shift: 'Turno',
  shift_import: 'Importação de escala',
  survey_config: 'Pesquisa',
};

const FIELD_LABELS: Record<string, string> = {
  fullName: 'nome',
  role: 'perfil',
  scope: 'escopo',
  isActive: 'situação',
  name: 'nome',
  description: 'descrição',
  title: 'título',
  introText: 'introdução',
  thankYouMessage: 'agradecimento',
  slug: 'endereço',
  sectorId: 'setor',
  npsQuestionText: 'pergunta geral',
  questions: 'perguntas',
};

function roleLabel(value: unknown): string {
  return typeof value === 'string' && value in ROLE_LABELS
    ? ROLE_LABELS[value as UserRole]
    : String(value);
}

function yesNo(value: unknown): string {
  return value === true ? 'sim' : 'não';
}

/**
 * Converte os detalhes técnicos do registro em frases curtas. Os detalhes nunca contêm dados
 * pessoais nem senhas (garantido pelo backend); identificadores de setor viram nomes, se conhecidos.
 */
export function describeDetails(details: unknown, sectorName: (id: string) => string): string[] {
  if (typeof details !== 'object' || details === null) return [];
  const entries = details as Record<string, unknown>;
  const lines: string[] = [];
  const list = (value: unknown) =>
    Array.isArray(value) && value.length > 0
      ? value.map((id) => sectorName(String(id))).join(', ')
      : 'nenhum';

  if (Array.isArray(entries.changedFields)) {
    lines.push(
      `Campos alterados: ${entries.changedFields.map((field) => FIELD_LABELS[String(field)] ?? String(field)).join(', ')}`,
    );
  }
  if ('roleFrom' in entries || 'roleTo' in entries) {
    lines.push(`Perfil: ${roleLabel(entries.roleFrom)} → ${roleLabel(entries.roleTo)}`);
  } else if ('role' in entries) {
    lines.push(`Perfil: ${roleLabel(entries.role)}`);
  }
  if ('allSectors' in entries) lines.push(`Todos os setores: ${yesNo(entries.allSectors)}`);
  if ('sectorIds' in entries) lines.push(`Setores: ${list(entries.sectorIds)}`);
  if ('sectorIdsAdded' in entries) lines.push(`Setores incluídos: ${list(entries.sectorIdsAdded)}`);
  if ('sectorIdsRemoved' in entries)
    lines.push(`Setores removidos: ${list(entries.sectorIdsRemoved)}`);
  if ('mandatory' in entries) lines.push(`Troca obrigatória: ${yesNo(entries.mandatory)}`);
  if ('changeRequired' in entries)
    lines.push(`Troca exigida no próximo acesso: ${yesNo(entries.changeRequired)}`);
  if (entries.code === 'SECTOR_OUT_OF_SCOPE' || entries.code === 'FORBIDDEN')
    lines.push(
      `Motivo: ${entries.code === 'SECTOR_OUT_OF_SCOPE' ? 'setor fora do escopo' : 'sem permissão'}`,
    );
  else if (typeof entries.code === 'string') lines.push(`Código: ${entries.code}`);
  if (typeof entries.slug === 'string') lines.push(`Endereço: /p/${entries.slug}`);
  if (typeof entries.versionNumber === 'number') lines.push(`Versão: ${entries.versionNumber}`);
  if (typeof entries.totalRows === 'number')
    lines.push(
      `Linhas: ${entries.totalRows} (aceitas: ${String(entries.acceptedRows)}, com erro: ${String(entries.rejectedRows)})`,
    );
  if (typeof entries.createdShifts === 'number')
    lines.push(`Turnos gravados: ${entries.createdShifts}`);
  if (typeof entries.method === 'string') lines.push(`Método: ${entries.method}`);
  if (typeof entries.permission === 'string')
    lines.push(`Permissão exigida: ${entries.permission}`);
  return lines;
}
