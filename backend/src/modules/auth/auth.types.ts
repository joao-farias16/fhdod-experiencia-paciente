import type { UserRole } from '../../lib/prisma.js';

/**
 * Escopo de setores do usuário autenticado (RN18, RF08): global (SA sempre; GE, OU e VI com
 * all_sectors) ou restrito à lista de setores associados (AS sempre; GE, OU e VI sem all_sectors).
 */
export type SectorScope = { all: true } | { all: false; sectorIds: readonly string[] };

/** Identidade e autorização carregadas a cada requisição autenticada (req.auth, Seção 6). */
export interface AuthContext {
  profileId: string;
  authUserId: string;
  hospitalId: string;
  role: UserRole;
  scope: SectorScope;
  mustChangePassword: boolean;
  /** Emissão do token (claim iat, lido após a validação pelo Supabase); usado no E05. */
  tokenIssuedAt?: Date | undefined;
}

/**
 * Resultado da validação do token Bearer no Supabase Auth (auth.getUser):
 * - `valid`: token válido do usuário `authUserId`;
 * - `banned`: token íntegro de um usuário bloqueado no Supabase (desativação, RF09);
 * - `invalid`: ausente, malformado, expirado, revogado (signOut) ou de usuário inexistente.
 */
export type TokenVerification =
  | { status: 'valid'; authUserId: string; issuedAt?: Date | undefined }
  | { status: 'banned'; authUserId: string }
  | { status: 'invalid' };

/** Verificador de token injetado em createApp, permitindo testes sem Supabase (Seção 7). */
export interface TokenVerifier {
  verify(accessToken: string): Promise<TokenVerification>;
}

/** O e-mail já existe no Supabase Auth (E07 → 409). */
export class AuthEmailAlreadyRegisteredError extends Error {
  constructor() {
    super('E-mail já cadastrado no Supabase Auth.');
    this.name = 'AuthEmailAlreadyRegisteredError';
  }
}

/** O Supabase Auth recusou a senha pela própria política (equivalente à RN28 → 400). */
export class AuthWeakPasswordError extends Error {
  constructor() {
    super('Senha recusada pela política do Supabase Auth.');
    this.name = 'AuthWeakPasswordError';
  }
}

/** Falha de comunicação ou erro inesperado do Supabase Auth (→ 503). */
export class AuthServiceUnavailableError extends Error {
  constructor(readonly operation: string) {
    super(`Supabase Auth indisponível (${operation}).`);
    this.name = 'AuthServiceUnavailableError';
  }
}

/**
 * Operações administrativas do Supabase Auth usadas pelo backend (chave secreta, somente no
 * servidor). Senhas nunca são gravadas na aplicação: ficam apenas no Supabase Auth.
 */
export interface AuthAdmin {
  /** Cria a conta com e-mail confirmado e senha temporária; devolve o id do usuário no Auth. */
  createUser(input: { email: string; password: string }): Promise<{ authUserId: string }>;
  /** Exclui a conta (somente compensação de cadastro que falhou no banco). */
  deleteUser(authUserId: string): Promise<void>;
  updatePassword(authUserId: string, password: string): Promise<void>;
  /** Bloqueia (ban_duration) ou libera o login e a renovação de sessão. */
  setBanned(authUserId: string, banned: boolean): Promise<void>;
}
