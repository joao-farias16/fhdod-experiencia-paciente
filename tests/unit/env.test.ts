import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from '../../src/lib/env.js';

// Valores fictícios de um MySQL local e do segredo dos tokens (Etapa 3).
const DATABASE = { DB_USER: 'fhdod', DB_PASSWORD: 'senha-ficticia-local' };
const JWT_SECRET = 'segredo-ficticio-dos-tokens-com-32-caracteres!';
const BASE = { ...DATABASE, JWT_SECRET };

const PRODUCTION = {
  NODE_ENV: 'production',
  CORS_ORIGIN: 'https://fhdod.example',
  ...BASE,
  AUDIT_IP_SECRET: 'z'.repeat(32),
  MANIFESTATION_TOKEN_SECRET: 'm'.repeat(32),
  PUBLIC_APP_URL: 'https://fhdod.example',
};

describe('loadEnv', () => {
  it('aplica os valores padrão e separa as origens do CORS', () => {
    const env = loadEnv({
      CORS_ORIGIN: 'http://localhost:5173, http://127.0.0.1:5173',
      ...BASE,
    });

    expect(env).toEqual({
      NODE_ENV: 'development',
      PORT: 3333,
      CORS_ORIGIN: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      LOG_LEVEL: 'info',
      TRUST_PROXY: 0,
      DB_HOST: 'localhost',
      DB_PORT: 3306,
      DB_USER: 'fhdod',
      DB_PASSWORD: 'senha-ficticia-local',
      DB_NAME: 'fhdod',
      DB_CONNECTION_LIMIT: 10,
      DB_SSL: false,
      JWT_SECRET,
      JWT_ACCESS_TOKEN_TTL_SECONDS: 3600,
      REFRESH_TOKEN_TTL_DAYS: 7,
      BCRYPT_ROUNDS: 12,
      PUBLIC_APP_URL: 'http://localhost:5173',
    });
  });

  it('converte PORT, TRUST_PROXY, DB_PORT e DB_SSL', () => {
    const env = loadEnv({
      CORS_ORIGIN: 'http://localhost:5173',
      ...BASE,
      PORT: '4000',
      TRUST_PROXY: '1',
      DB_PORT: '3307',
      DB_SSL: 'true',
      DB_SSL_CA: '',
    });

    expect(env.PORT).toBe(4000);
    expect(env.TRUST_PROXY).toBe(1);
    expect(env.DB_PORT).toBe(3307);
    expect(env.DB_SSL).toBe(true);
    expect(env.DB_SSL_CA).toBeUndefined();
  });

  it('rejeita a ausência de CORS_ORIGIN', () => {
    expect(() => loadEnv({ ...BASE })).toThrow(EnvValidationError);
  });

  it('exige DB_USER e nome de banco válido (Etapa 3)', () => {
    expect(() => loadEnv({ CORS_ORIGIN: 'http://localhost:5173', JWT_SECRET })).toThrow(/DB_USER/);
    expect(() =>
      loadEnv({ CORS_ORIGIN: 'http://localhost:5173', ...BASE, DB_NAME: 'fhdod; DROP DATABASE x' }),
    ).toThrow(/DB_NAME/);
    expect(() => loadEnv({ CORS_ORIGIN: 'http://localhost:5173', ...BASE, DB_PORT: '0' })).toThrow(
      /DB_PORT/,
    );
  });

  it('não expõe a senha do banco na mensagem de erro', () => {
    try {
      loadEnv({
        CORS_ORIGIN: 'http://localhost:5173',
        DB_USER: 'u',
        DB_PASSWORD: 'senha-secreta',
        DB_PORT: 'x',
        JWT_SECRET,
      });
      expect.unreachable('loadEnv deveria lançar EnvValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).message).not.toContain('senha-secreta');
    }
  });

  it('exige JWT_SECRET com 32+ caracteres, sem expor o valor', () => {
    const base = { CORS_ORIGIN: 'http://localhost:5173', ...DATABASE };
    expect(() => loadEnv(base)).toThrow(/JWT_SECRET/);
    try {
      loadEnv({ ...base, JWT_SECRET: 'curto-demais' });
      expect.unreachable('loadEnv deveria lançar EnvValidationError');
    } catch (error) {
      expect((error as EnvValidationError).message).toMatch(/JWT_SECRET/);
      expect((error as EnvValidationError).message).not.toContain('curto-demais');
    }
  });

  it.each([['nao-e-url'], ['ftp://exemplo.com'], ['http://localhost:5173,']])(
    'rejeita CORS_ORIGIN inválido (%s)',
    (value) => {
      expect(() => loadEnv({ CORS_ORIGIN: value, ...BASE })).toThrow(EnvValidationError);
    },
  );

  it('rejeita porta, nível de log e ambiente inválidos, listando cada variável', () => {
    try {
      loadEnv({
        CORS_ORIGIN: 'http://localhost:5173',
        ...BASE,
        PORT: '70000',
        LOG_LEVEL: 'verbose',
        NODE_ENV: 'staging',
      });
      expect.unreachable('loadEnv deveria lançar EnvValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const fields = (error as EnvValidationError).issues.map((issue) => issue.split(':')[0]);
      expect(fields).toEqual(expect.arrayContaining(['PORT', 'LOG_LEVEL', 'NODE_ENV']));
    }
  });

  it('não expõe o valor recebido na mensagem de erro', () => {
    const error: unknown = (() => {
      try {
        return loadEnv({ CORS_ORIGIN: 'valor-secreto-qualquer', ...BASE });
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(EnvValidationError);
    expect((error as EnvValidationError).message).not.toContain('valor-secreto-qualquer');
  });

  it('exige origens HTTPS em produção (RNF09)', () => {
    expect(() => loadEnv({ ...PRODUCTION, CORS_ORIGIN: 'http://fhdod.example' })).toThrow(/https/);
    expect(loadEnv(PRODUCTION).CORS_ORIGIN).toEqual(['https://fhdod.example']);
  });

  it('AUDIT_IP_SECRET é opcional fora de produção, com no mínimo 32 caracteres', () => {
    const base = { CORS_ORIGIN: 'http://localhost:5173', ...BASE };
    expect(loadEnv({ ...base, AUDIT_IP_SECRET: '' }).AUDIT_IP_SECRET).toBeUndefined();
    expect(() => loadEnv({ ...base, AUDIT_IP_SECRET: 'curto' })).toThrow(/AUDIT_IP_SECRET/);
    expect(loadEnv({ ...base, AUDIT_IP_SECRET: 'y'.repeat(32) }).AUDIT_IP_SECRET).toBe(
      'y'.repeat(32),
    );
  });

  it('em produção, exige senha do banco, AUDIT_IP_SECRET e bcrypt com custo 10+', () => {
    expect(() => loadEnv({ ...PRODUCTION, DB_PASSWORD: '' })).toThrow(/DB_PASSWORD/);
    expect(() => loadEnv({ ...PRODUCTION, AUDIT_IP_SECRET: '' })).toThrow(/AUDIT_IP_SECRET/);
    expect(() => loadEnv({ ...PRODUCTION, BCRYPT_ROUNDS: '4' })).toThrow(/BCRYPT_ROUNDS/);
    expect(loadEnv(PRODUCTION).BCRYPT_ROUNDS).toBe(12);
  });

  it('PUBLIC_APP_URL e MANIFESTATION_TOKEN_SECRET: padrão local e obrigatórios em produção', () => {
    const local = loadEnv({ CORS_ORIGIN: 'http://localhost:5173', ...BASE });
    expect(local.PUBLIC_APP_URL).toBe('http://localhost:5173');
    expect(local.MANIFESTATION_TOKEN_SECRET).toBeUndefined();
    expect(() =>
      loadEnv({ CORS_ORIGIN: 'http://localhost:5173', ...BASE, MANIFESTATION_TOKEN_SECRET: 'x' }),
    ).toThrow(/MANIFESTATION_TOKEN_SECRET/);

    expect(() => loadEnv({ ...PRODUCTION, MANIFESTATION_TOKEN_SECRET: '' })).toThrow(
      /MANIFESTATION_TOKEN_SECRET/,
    );
    expect(() => loadEnv({ ...PRODUCTION, PUBLIC_APP_URL: 'http://fhdod.example' })).toThrow(
      /PUBLIC_APP_URL/,
    );
    const ok = loadEnv({ ...PRODUCTION, PUBLIC_APP_URL: 'https://fhdod.example/' });
    expect(ok.PUBLIC_APP_URL).toBe('https://fhdod.example');
  });
});
