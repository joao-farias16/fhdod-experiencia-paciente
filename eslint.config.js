// Configuração do ESLint (flat config) da API.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/node_modules/', '**/dist/', '**/coverage/', '**/*.tsbuildinfo'],
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
    // Código de produção: SQL de query/execute somente pelo template `sql`.
    files: ['src/**/*.ts'],
    rules: {
      // RNF11: SQL sempre parametrizado. Texto montado com interpolação de template literal
      // passado direto a query/execute é proibido: use o template `sql` (src/lib/sql.ts).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.property.name=/^(query|execute)$/] > TemplateLiteral.arguments:first-child[expressions.length>0]',
          message: 'SQL interpolado em query/execute: use o template `sql` parametrizado (RNF11).',
        },
      ],
    },
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
    // RNF21: rotas e controladores não acessam o banco (somente tipos para as dependências).
    files: ['src/**/*.routes.ts', 'src/**/*.controller.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/lib/database.js',
                '**/lib/sql.js',
                '**/*.repository.js',
                'mysql2',
                'mysql2/*',
              ],
              allowTypeImports: true,
              message: 'Controladores sem acesso ao banco (RNF21): use os serviços.',
            },
          ],
        },
      ],
    },
  },
  {
    // Scripts de linha de comando (seed e utilitários de banco) informam o progresso no terminal.
    files: ['scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
