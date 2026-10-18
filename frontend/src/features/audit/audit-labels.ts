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
};

export const ENTITY_LABELS: Record<string, string> = {
  profile: 'Usuário',
  endpoint: 'Rota da API',
};

const FIELD_LABELS: Record<string, string> = {
  fullName: 'nome',
  role: 'perfil',
  scope: 'escopo',
  isActive: 'situação',
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
  if ('code' in entries)
    lines.push(
      `Motivo: ${entries.code === 'SECTOR_OUT_OF_SCOPE' ? 'setor fora do escopo' : 'sem permissão'}`,
    );
  if (typeof entries.method === 'string') lines.push(`Método: ${entries.method}`);
  if (typeof entries.permission === 'string')
    lines.push(`Permissão exigida: ${entries.permission}`);
  return lines;
}
