// Configuração do ESLint (flat config) da API.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/coverage/',
      '**/*.tsbuildinfo',
      // Prisma Client gerado por `prisma generate` (não versionado).
      'src/generated/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.config.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // RNF20: TypeScript strict, sem any explícito.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: ['error', 'always'],
      'no-console': 'error',
      // RNF11: $queryRawUnsafe é proibido; consultas devem ser parametrizadas.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name=/^\\$(queryRawUnsafe|executeRawUnsafe)$/]',
          message: 'Use $queryRaw/$executeRaw parametrizados (RNF11).',
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // RNF21: serviços e regras de domínio não dependem do Express.
    files: ['src/**/*.service.ts', 'src/**/*.filters.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'express', message: 'Serviços não dependem do Express (RNF21).' }],
        },
      ],
    },
  },
  {
    // RNF21: rotas e controladores não acessam o Prisma (somente tipos para as dependências).
    files: ['src/**/*.routes.ts', 'src/**/*.controller.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/prisma.js', '**/generated/**', '@prisma/*'],
              allowTypeImports: true,
              message: 'Controladores sem Prisma (RNF21): use os serviços.',
            },
          ],
        },
      ],
    },
  },
  {
    // Scripts de linha de comando (seed e utilitários de banco) informam o progresso no terminal.
    files: ['prisma/**/*.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
