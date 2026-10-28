import { ApiError, apiRequest } from '../../lib/api-client';

/** E01 — versão vigente da pesquisa, por etapas. */
export interface PublicSurvey {
  surveyVersionId: string;
  versionNumber: number;
  slug: string;
  title: string;
  introText: string | null;
  thankYouMessage: string;
  sectorName: string;
  npsQuestion: { id: string; text: string; anchors: { min: string; max: string } };
  stages: { name: string; position: number; questions: { id: string; text: string }[] }[];
  scaleLabels: string[];
}

export type ResponseOrigin = 'qr_code' | 'link';

export interface ResponseBody {
  surveyVersionId: string;
  origin: ResponseOrigin;
  npsScore: number;
  answers: { questionId: string; score: number }[];
}

/** E02 — 201 (novo registro) ou 200 (repetição com a mesma chave). */
export interface SubmittedResponse {
  responseId: string;
  submittedAt: string;
  lowScore: boolean;
  manifestation: { token: string; expiresAt: string };
}

export async function fetchPublicSurvey(slug: string, signal?: AbortSignal): Promise<PublicSurvey> {
  const { data } = await apiRequest<PublicSurvey>(`/public/surveys/${encodeURIComponent(slug)}`, {
    signal,
  });
  return data;
}

/** Seção 4.3: até 3 reenvios automáticos, após 1, 2 e 4 segundos. */
export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

/** Falha de rede, 502, 503 ou 504 permitem reenvio automático com a MESMA chave. */
export function isRetryable(error: unknown): boolean {
  return error instanceof ApiError && [0, 502, 503, 504].includes(error.status);
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Envia a avaliação (RF37). A Idempotency-Key acompanha todas as tentativas da mesma submissão;
 * o sucesso só é devolvido depois da resposta 201 ou 200 do backend (gravação confirmada).
 */
export async function submitResponse(
  body: ResponseBody,
  idempotencyKey: string,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<SubmittedResponse> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { data } = await apiRequest<SubmittedResponse>('/public/responses', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      });
      return data;
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (!isRetryable(error) || delay === undefined) throw error;
      await sleep(delay);
    }
  }
}
