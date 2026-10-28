/**
 * Dublê do Supabase Auth para os testes de integração (Seção 12: "Supertest com PostgreSQL real
 * e verificador de token falso"). Reproduz a semântica observada no Supabase local:
 * - token malformado, expirado, revogado ou de usuário inexistente → inválido;
 * - usuário bloqueado (ban) → `banned`;
 * - troca de senha pelo admin → a senha anterior deixa de autenticar;
 * - e-mail repetido na criação → AuthEmailAlreadyRegisteredError.
 * Permite injetar falhas por operação para testar compensações e atomicidade.
 */
import { randomUUID } from 'node:crypto';

import { isWellFormedJwt } from '../src/lib/supabase.js';
import {
  type AuthAdmin,
  AuthEmailAlreadyRegisteredError,
  AuthServiceUnavailableError,
  type TokenVerification,
  type TokenVerifier,
} from '../src/modules/auth/auth.types.js';

interface FakeUser {
  email: string;
  password: string;
  banned: boolean;
}

type AdminOperation = keyof AuthAdmin;

export interface FakeTokenOptions {
  /** Emissão em segundos desde a época (padrão: agora). */
  iat?: number;
  /** Expiração em segundos desde a época (padrão: iat + 3600). */
  exp?: number;
}

/** Senha fictícia das contas registradas diretamente no dublê. */
export const DEFAULT_PASSWORD = 'SenhaInicial123'; // gitleaks:allow — senha fictícia de teste

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export class FakeSupabase {
  readonly users = new Map<string, FakeUser>();
  readonly calls: { operation: AdminOperation; authUserId?: string }[] = [];
  private readonly revoked = new Set<string>();
  private readonly failures = new Map<AdminOperation, number>();

  /** Registra uma conta já existente (perfis criados diretamente no banco pelos testes). */
  register(authUserId: string, email: string, password = DEFAULT_PASSWORD): void {
    this.users.set(authUserId, { email, password, banned: false });
  }

  /** Emite um access token com o formato JWT (assinatura fictícia). */
  token(authUserId: string, options: FakeTokenOptions = {}): string {
    const iat = options.iat ?? Math.floor(Date.now() / 1000);
    const exp = options.exp ?? iat + 3600;
    return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: authUserId, iat, exp, jti: randomUUID() })}.assinatura-ficticia`;
  }

  /** Liga ou desliga o bloqueio da conta diretamente (simula estados do Supabase Auth). */
  setBannedState(authUserId: string, banned: boolean): void {
    const user = this.users.get(authUserId);
    if (user === undefined) throw new Error(`Usuário ${authUserId} não registrado no dublê.`);
    user.banned = banned;
  }

  /** Simula signInWithPassword: devolve um token ou null (credenciais inválidas ou bloqueio). */
  signIn(email: string, password: string): string | null {
    for (const [authUserId, user] of this.users) {
      if (user.email === email && user.password === password && !user.banned) {
        return this.token(authUserId);
      }
    }
    return null;
  }

  /** Simula signOut: o token deixa de ser aceito. */
  revoke(token: string): void {
    this.revoked.add(token);
  }

  /** A próxima chamada (ou as próximas `times`) da operação falha como indisponibilidade. */
  failNext(operation: AdminOperation, times = 1): void {
    this.failures.set(operation, times);
  }

  private maybeFail(operation: AdminOperation, authUserId?: string): void {
    this.calls.push({ operation, ...(authUserId === undefined ? {} : { authUserId }) });
    const remaining = this.failures.get(operation) ?? 0;
    if (remaining > 0) {
      this.failures.set(operation, remaining - 1);
      throw new AuthServiceUnavailableError(operation);
    }
  }

  readonly verifier: TokenVerifier = {
    verify: (token): Promise<TokenVerification> => {
      if (!isWellFormedJwt(token) || this.revoked.has(token)) {
        return Promise.resolve({ status: 'invalid' });
      }
      try {
        const payload = JSON.parse(
          Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
        ) as { sub?: unknown; iat?: unknown; exp?: unknown };
        if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
          return Promise.resolve({ status: 'invalid' });
        }
        if (payload.exp * 1000 <= Date.now()) return Promise.resolve({ status: 'invalid' });
        const user = this.users.get(payload.sub);
        if (user === undefined) return Promise.resolve({ status: 'invalid' });
        if (user.banned) return Promise.resolve({ status: 'banned', authUserId: payload.sub });
        return Promise.resolve({
          status: 'valid',
          authUserId: payload.sub,
          issuedAt: typeof payload.iat === 'number' ? new Date(payload.iat * 1000) : undefined,
        });
      } catch {
        return Promise.resolve({ status: 'invalid' });
      }
    },
  };

  readonly admin: AuthAdmin = {
    createUser: ({ email, password }) => {
      this.maybeFail('createUser');
      if ([...this.users.values()].some((user) => user.email === email)) {
        return Promise.reject(new AuthEmailAlreadyRegisteredError());
      }
      const authUserId = randomUUID();
      this.users.set(authUserId, { email, password, banned: false });
      return Promise.resolve({ authUserId });
    },
    deleteUser: (authUserId) => {
      this.maybeFail('deleteUser', authUserId);
      this.users.delete(authUserId);
      return Promise.resolve();
    },
    updatePassword: (authUserId, password) => {
      this.maybeFail('updatePassword', authUserId);
      const user = this.users.get(authUserId);
      if (user !== undefined) user.password = password;
      return Promise.resolve();
    },
    setBanned: (authUserId, banned) => {
      this.maybeFail('setBanned', authUserId);
      const user = this.users.get(authUserId);
      if (user !== undefined) user.banned = banned;
      return Promise.resolve();
    },
  };
}
