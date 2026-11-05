/**
 * Domínios do modelo de dados (Tabela 16), espelhando os ENUM das tabelas MySQL
 * (database/migrations/001_tabelas.sql). Antes da Etapa 3 eram gerados pelo Prisma Client.
 * Ao incluir um valor aqui, crie também a migration que altera o ENUM correspondente.
 */

/** Perfis da Seção 6 (SA, AS, GE, OU e VI). */
export const USER_ROLES = [
  'superadmin',
  'sector_admin',
  'management',
  'ombudsman',
  'viewer',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** nps = pergunta geral 0–10 (RN01); scale_1_5 = pergunta específica (RN02). */
export type QuestionType = 'nps' | 'scale_1_5';

/** Origem do acesso à pesquisa pública (RF30, E02). */
export type ResponseOrigin = 'qr_code' | 'link';

/** Resultado da atribuição a turno e equipe (RN07, RF24). */
export type AttributionStatus = 'attributed' | 'not_qr_origin' | 'no_shift' | 'ambiguous';

/** Período do turno: manhã, tarde e noite (RF19). */
export type ShiftPeriod = 'morning' | 'afternoon' | 'night';

/** Origem do turno: cadastro manual (RF19) ou importação de escala CSV (RF22–RF23). */
export type ShiftSource = 'manual' | 'import';

/** Situação da importação de escala (RF22, RF23). */
export type ImportStatus = 'validated' | 'rejected' | 'committed';

/** Elogio, reclamação ou sugestão (RF41). */
export type ManifestationType = 'compliment' | 'complaint' | 'suggestion';

/** Status da RN23. */
export type ManifestationStatus = 'received' | 'in_review' | 'forwarded' | 'resolved' | 'archived';

/** Prioridade definida pela Ouvidoria (RF46). */
export type ManifestationPriority = 'low' | 'medium' | 'high';

/** Eventos da linha do tempo da manifestação (RF45–RF49). */
export type ManifestationEventKind =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'actions_updated'
  | 'note'
  | 'contact_deleted';

/** Valor JSON genérico (colunas JSON de audit_logs e shift_imports). */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
