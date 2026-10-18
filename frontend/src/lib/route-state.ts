/** Lê o aviso (`state.notice`) passado na navegação, como "Senha alterada com sucesso." */
export function noticeOf(state: unknown): string | undefined {
  return typeof state === 'object' &&
    state !== null &&
    'notice' in state &&
    typeof state.notice === 'string'
    ? state.notice
    : undefined;
}
