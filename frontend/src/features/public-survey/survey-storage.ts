import type { ResponseOrigin } from './public-survey-api';

/**
 * Respostas em andamento guardadas na memória e no sessionStorage (RF36), apagadas ao concluir ou
 * após inatividade (RF39). Todas as chaves usam o prefixo "fhdod:" para a limpeza completa em
 * dispositivos compartilhados. Nenhum cookie é usado (Seção 2).
 */
export const STORAGE_PREFIX = 'fhdod:';

/** RF39: aviso após 3 minutos sem interação; limpeza 60 segundos depois. */
export const INACTIVITY_WARNING_MS = 3 * 60_000;
export const INACTIVITY_GRACE_MS = 60_000;

export interface SurveyProgress {
  versionId: string;
  origin: ResponseOrigin;
  step: number;
  npsScore: number | null;
  /** Notas específicas por pergunta (questions.id). */
  answers: Record<string, number>;
  /** Chave da submissão em andamento e o conteúdo a que ela se refere (RN13). */
  idempotencyKey: string | null;
  keyFingerprint: string | null;
  savedAt: number;
}

export function storageKey(slug: string): string {
  return `${STORAGE_PREFIX}pesquisa:${slug}`;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isProgress(value: unknown): value is SurveyProgress {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.versionId === 'string' &&
    (item.origin === 'qr_code' || item.origin === 'link') &&
    typeof item.step === 'number' &&
    (item.npsScore === null || typeof item.npsScore === 'number') &&
    typeof item.answers === 'object' &&
    item.answers !== null &&
    typeof item.savedAt === 'number'
  );
}

/**
 * Progresso salvo da mesma versão, se ainda dentro do prazo de inatividade; caso contrário,
 * descarta tudo (outra pessoa pode estar usando o aparelho).
 */
export function loadProgress(slug: string, versionId: string, now: number): SurveyProgress | null {
  const store = storage();
  const raw = store?.getItem(storageKey(slug));
  if (raw === null || raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      isProgress(parsed) &&
      parsed.versionId === versionId &&
      now - parsed.savedAt < INACTIVITY_WARNING_MS + INACTIVITY_GRACE_MS
    ) {
      return parsed;
    }
  } catch {
    // Conteúdo corrompido: descartado abaixo.
  }
  clearSurveyStorage();
  return null;
}

export function saveProgress(slug: string, progress: SurveyProgress): void {
  try {
    storage()?.setItem(storageKey(slug), JSON.stringify(progress));
  } catch {
    // Armazenamento indisponível (modo privado, cota): as respostas ficam só na memória.
  }
}

/** Remove todas as chaves "fhdod:*" do sessionStorage (RF39). */
export function clearSurveyStorage(): void {
  const store = storage();
  if (store === null) return;
  try {
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter(
      (key): key is string => key?.startsWith(STORAGE_PREFIX) === true,
    );
    for (const key of keys) store.removeItem(key);
  } catch {
    // Sem acesso ao armazenamento: nada a limpar.
  }
}
