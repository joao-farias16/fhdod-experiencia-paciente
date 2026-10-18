// Conventional Commits 1.0.0 (Seção 13 da especificação): feat, fix, docs, test, refactor,
// style, chore, ci, build e perf, com escopo opcional por módulo. Mensagens em português.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'test', 'refactor', 'style', 'chore', 'ci', 'build', 'perf'],
    ],
    'subject-case': [0],
  },
};
