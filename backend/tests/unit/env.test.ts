import { describe, expect, it } from 'vitest';

import { EnvValidationError, loadEnv } from '../../src/config/env.js';

const DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// Valores fictícios do Supabase Auth local (ET03).
const SUPABASE = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SECRET_KEY: 'chave-ficticia-de-teste',
};
const BASE = { DATABASE_URL, ...SUPABASE };

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
      DATABASE_URL,
      ...SUPABASE,
    });
  });

  it('converte PORT e TRUST_PROXY para número', () => {
    const env = loadEnv({
      CORS_ORIGIN: 'http://localhost:5173',
      ...BASE,
      PORT: '4000',
      TRUST_PROXY: '1',
    });

    expect(env.PORT).toBe(4000);
    expect(env.TRUST_PROXY).toBe(1);
  });

  it('rejeita a ausência de CORS_ORIGIN', () => {
    expect(() => loadEnv({ DATABASE_URL })).toThrow(EnvValidationError);
  });

  it('exige DATABASE_URL com protocolo postgresql (ET02)', () => {
    expect(() => loadEnv({ CORS_ORIGIN: 'http://localhost:5173' })).toThrow(/DATABASE_URL/);
    expect(() =>
      loadEnv({ CORS_ORIGIN: 'http://localhost:5173', DATABASE_URL: 'mysql://u:p@localhost/db' }),
    ).toThrow(/DATABASE_URL/);
    expect(
      loadEnv({
        CORS_ORIGIN: 'http://localhost:5173',
        ...SUPABASE,
        DATABASE_URL: 'postgres://u:p@db:5432/x',
      }).DATABASE_URL,
    ).toBe('postgres://u:p@db:5432/x');
  });

  it('não expõe a senha da DATABASE_URL na mensagem de erro', () => {
    try {
      loadEnv({
        CORS_ORIGIN: 'http://localhost:5173',
        DATABASE_URL: 'mysql://u:senha-secreta@h/db',
      });
      expect.unreachable('loadEnv deveria lançar EnvValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).message).not.toContain('senha-secreta');
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
    const production = {
      NODE_ENV: 'production',
      DATABASE_URL,
      SUPABASE_URL: 'https://exemplo.supabase.co',
      SUPABASE_SECRET_KEY: 'chave-ficticia-de-teste',
      AUDIT_IP_SECRET: 'x'.repeat(32),
    };
    expect(() => loadEnv({ ...production, CORS_ORIGIN: 'http://fhdod.example' })).toThrow(/https/);
    expect(loadEnv({ ...production, CORS_ORIGIN: 'https://fhdod.example' }).CORS_ORIGIN).toEqual([
      'https://fhdod.example',
    ]);
  });

  it('exige SUPABASE_URL e SUPABASE_SECRET_KEY (ET03) sem expor a chave', () => {
    const base = { CORS_ORIGIN: 'http://localhost:5173', DATABASE_URL };
    expect(() => loadEnv(base)).toThrow(/SUPABASE_URL/);
    expect(() => loadEnv({ ...base, SUPABASE_URL: 'http://127.0.0.1:54321' })).toThrow(
      /SUPABASE_SECRET_KEY/,
    );
    try {
      loadEnv({ ...base, SUPABASE_URL: 'nao-e-url', SUPABASE_SECRET_KEY: 'sb_secret_ficticia' });
      expect.unreachable('loadEnv deveria lançar EnvValidationError');
    } catch (error) {
      expect((error as EnvValidationError).message).toMatch(/SUPABASE_URL/);
      expect((error as EnvValidationError).message).not.toContain('sb_secret_ficticia');
    }
  });

  it('AUDIT_IP_SECRET é opcional fora de produção, com no mínimo 32 caracteres', () => {
    const base = { CORS_ORIGIN: 'http://localhost:5173', ...BASE };
    expect(loadEnv({ ...base, AUDIT_IP_SECRET: '' }).AUDIT_IP_SECRET).toBeUndefined();
    expect(() => loadEnv({ ...base, AUDIT_IP_SECRET: 'curto' })).toThrow(/AUDIT_IP_SECRET/);
    expect(loadEnv({ ...base, AUDIT_IP_SECRET: 'y'.repeat(32) }).AUDIT_IP_SECRET).toBe(
      'y'.repeat(32),
    );
  });

  it('em produção, exige Supabase em HTTPS e AUDIT_IP_SECRET', () => {
    const production = {
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://fhdod.example',
      DATABASE_URL,
      SUPABASE_SECRET_KEY: 'chave-ficticia-de-teste',
    };
    expect(() =>
      loadEnv({
        ...production,
        SUPABASE_URL: 'http://exemplo.supabase.co',
        AUDIT_IP_SECRET: 'z'.repeat(32),
      }),
    ).toThrow(/SUPABASE_URL/);
    expect(() => loadEnv({ ...production, SUPABASE_URL: 'https://exemplo.supabase.co' })).toThrow(
      /AUDIT_IP_SECRET/,
    );
  });
});
