import type { UserRole } from '../../lib/domain-types.js';

/**
 * Escopo de setores do usuário autenticado (RN18, RF08): global (SA sempre; GE, OU e VI com
 * all_sectors) ou restrito à lista de setores associados (AS sempre; GE, OU e VI sem all_sectors).
 */
export type SectorScope = { all: true } | { all: false; sectorIds: readonly string[] };

/** Identidade e autorização carregadas a cada requisição autenticada (req.auth, Seção 6). */
export interface AuthContext {
  profileId: string;
  /** Sessão de login (auth_sessions) à qual o token de acesso pertence. */
  sessionId: string;
  hospitalId: string;
  role: UserRole;
  scope: SectorScope;
  mustChangePassword: boolean;
}

/**
 * Configuração da autenticação própria (Etapa 3): assinatura HS256 dos tokens de acesso, validade
 * dos tokens e custo do bcrypt. Vem das variáveis JWT_*, REFRESH_TOKEN_TTL_DAYS e BCRYPT_ROUNDS.
 */
export interface AuthConfig {
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  bcryptRounds: number;
}

/** Tokens devolvidos por E44 (login) e E45 (renovação). */
export interface SessionTokens {
  accessToken: string;
  tokenType: 'Bearer';
  /** Validade do token de acesso, em segundos. */
  expiresIn: number;
  /** Instante (ISO 8601) em que o token de acesso expira. */
  expiresAt: string;
  /** Token de renovação de uso único (rotativo). */
  refreshToken: string;
  /** Instante (ISO 8601) em que a sessão expira, se não for renovada. */
  refreshTokenExpiresAt: string;
}
