import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  MessageSquareText,
  RotateCw,
  Send,
} from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Loading } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import {
  fetchPublicSurvey,
  isRetryable,
  type PublicSurvey,
  type ResponseBody,
  type ResponseOrigin,
  type SubmittedResponse,
  submitResponse,
} from './public-survey-api';
import { ManifestationForm } from './ManifestationForm';
import { ScoreScale } from './ScoreScale';
import {
  clearSurveyStorage,
  loadProgress,
  saveProgress,
  type SurveyProgress,
} from './survey-storage';
import { useInactivity } from './use-inactivity';

/** RF38: a confirmação volta ao início em 30 segundos. */
export const CONFIRMATION_RETURN_MS = 30_000;

function freshProgress(versionId: string, origin: ResponseOrigin): SurveyProgress {
  return {
    versionId,
    origin,
    step: 0,
    npsScore: null,
    answers: {},
    idempotencyKey: null,
    keyFingerprint: null,
    savedAt: Date.now(),
  };
}

function hasContent(progress: SurveyProgress): boolean {
  return (
    progress.step > 0 || progress.npsScore !== null || Object.keys(progress.answers).length > 0
  );
}

/** Corpo do E02 somente com as perguntas da versão exibida que foram respondidas (RN02, RN06). */
function bodyOf(survey: PublicSurvey, progress: SurveyProgress, npsScore: number): ResponseBody {
  const questionIds = survey.stages.flatMap((stage) => stage.questions.map((item) => item.id));
  return {
    surveyVersionId: survey.surveyVersionId,
    origin: progress.origin,
    npsScore,
    answers: questionIds.flatMap((questionId) => {
      const score = progress.answers[questionId];
      return score === undefined ? [] : [{ questionId, score }];
    }),
  };
}

/** Mensagem curta e acionável para cada falha do envio (RNF02, Tabela 22). */
function failureText(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Não foi possível enviar. Tente novamente.';
  if (isRetryable(error)) {
    return 'Sem conexão com o servidor. Suas respostas continuam aqui. Tente enviar de novo.';
  }
  return error.message;
}

interface SurveyFlowProps {
  survey: PublicSurvey;
  slug: string;
  origin: ResponseOrigin;
  onReload: () => void;
}

/** TL09 e TL11 — etapas, envio e confirmação de uma versão publicada. */
function SurveyFlow({ survey, slug, origin, onReload }: SurveyFlowProps) {
  const ids = useId();
  const totalSteps = 1 + survey.stages.length;
  const [progress, setProgress] = useState<SurveyProgress>(() => {
    const saved = loadProgress(slug, survey.surveyVersionId, Date.now());
    return saved === null ? freshProgress(survey.surveyVersionId, origin) : { ...saved, origin };
  });
  const [npsError, setNpsError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [done, setDone] = useState(false);
  // TL10: avaliação registrada (token da manifestação só em memória), etapa e protocolo.
  const [submitted, setSubmitted] = useState<SubmittedResponse | null>(null);
  const [writing, setWriting] = useState(false);
  const [offerDeclined, setOfferDeclined] = useState(false);
  const [protocol, setProtocol] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const npsGroupRef = useRef<HTMLDivElement>(null);

  // RF36: respostas mantidas no sessionStorage enquanto a pesquisa está em andamento.
  useEffect(() => {
    if (!done && hasContent(progress)) saveProgress(slug, { ...progress, savedAt: Date.now() });
  }, [progress, done, slug]);

  // Foco no título da etapa somente quando a etapa muda (leitores de tela e teclado).
  const shown = useRef({ step: progress.step, done });
  useEffect(() => {
    if (shown.current.step === progress.step && shown.current.done === done) return;
    shown.current = { step: progress.step, done };
    headingRef.current?.focus();
  }, [progress.step, done]);

  const restart = useCallback(
    (message: string | null) => {
      clearSurveyStorage();
      setProgress(freshProgress(survey.surveyVersionId, origin));
      setFailure(null);
      setNpsError(false);
      setDone(false);
      setSubmitted(null);
      setWriting(false);
      setOfferDeclined(false);
      setProtocol(null);
      setNotice(message);
    },
    [survey.surveyVersionId, origin],
  );

  // RF39: 3 min + 60 s sem interação apagam as respostas (e a manifestação em andamento).
  const inactivity = useInactivity(
    (!done && !submitting && hasContent(progress)) || (done && writing),
    () => {
      restart('Por segurança, as respostas foram apagadas depois de um tempo sem uso.');
    },
  );

  // RF38: depois da confirmação, volta ao início em 30 segundos (pausado enquanto a pessoa
  // escreve a manifestação).
  useEffect(() => {
    if (!done || writing) return undefined;
    const timer = setTimeout(() => {
      restart(null);
    }, CONFIRMATION_RETURN_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [done, writing, protocol, restart]);

  const update = (patch: Partial<SurveyProgress>) => {
    setNotice(null);
    setProgress((current) => ({ ...current, ...patch }));
  };

  const requireNps = (): number | null => {
    if (progress.npsScore !== null) return progress.npsScore;
    setNpsError(true);
    if (progress.step !== 0) update({ step: 0 });
    setTimeout(() => {
      npsGroupRef.current?.focus();
    }, 0);
    return null;
  };

  const goNext = () => {
    if (progress.step === 0 && requireNps() === null) return;
    update({ step: Math.min(progress.step + 1, totalSteps - 1) });
  };

  const send = async () => {
    const npsScore = requireNps();
    if (npsScore === null) return;
    const body = bodyOf(survey, progress, npsScore);
    const fingerprint = JSON.stringify(body);
    // RN13: a mesma chave em todas as tentativas desta submissão; nova chave se a resposta mudou.
    const idempotencyKey =
      progress.idempotencyKey !== null && progress.keyFingerprint === fingerprint
        ? progress.idempotencyKey
        : crypto.randomUUID();
    const withKey = { ...progress, idempotencyKey, keyFingerprint: fingerprint };
    setProgress(withKey);
    saveProgress(slug, { ...withKey, savedAt: Date.now() });
    setSubmitting(true);
    setFailure(null);
    try {
      const result = await submitResponse(body, idempotencyKey);
      // RF39: sucesso confirmado pelo backend → apaga as respostas da memória e do armazenamento.
      clearSurveyStorage();
      setProgress(freshProgress(survey.surveyVersionId, origin));
      setSubmitted(result);
      setDone(true);
    } catch (error) {
      setFailure(error);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    if (writing && submitted !== null) {
      return (
        <section aria-label="Manifestação" className="space-y-6">
          <ManifestationForm
            submitted={submitted}
            onCreated={(created) => {
              setProtocol(created.protocol);
              setWriting(false);
            }}
            onCancel={() => {
              setWriting(false);
              setOfferDeclined(true);
            }}
          />
          <Dialog
            open={inactivity.warning}
            title="Você ainda está aí?"
            description={`Por segurança, o texto será apagado em ${inactivity.secondsLeft} segundos.`}
            onClose={inactivity.stillHere}
          >
            <div className="flex justify-end">
              <Button className="min-h-12" onClick={inactivity.stillHere} data-autofocus>
                Continuar escrevendo
              </Button>
            </div>
          </Dialog>
        </section>
      );
    }
    // RN05: com nota baixa a oferta aparece em destaque; sem nota baixa, como ação secundária.
    const canManifest = submitted !== null && protocol === null && !offerDeclined;
    return (
      <section aria-labelledby={`${ids}-fim`} className="space-y-6 text-center">
        <CircleCheck aria-hidden="true" className="mx-auto size-14 text-green-700" />
        <h1
          id={`${ids}-fim`}
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-bold tracking-tight"
        >
          {protocol === null ? 'Resposta enviada' : 'Manifestação registrada'}
        </h1>
        <p className="text-lg text-slate-800">{survey.thankYouMessage}</p>
        {protocol === null ? null : (
          <div role="status" className="rounded-xl border border-green-700 bg-green-50 p-4">
            <p className="text-slate-800">Guarde o número do protocolo:</p>
            <p className="text-2xl font-bold tracking-wide">{protocol}</p>
          </div>
        )}
        {canManifest && submitted.lowScore ? (
          <div className="space-y-4 rounded-xl border-2 border-brand-700 bg-brand-50 p-5 text-left">
            <h2 className="text-[22px] font-semibold">Quer contar o que aconteceu?</h2>
            <p className="text-lg text-slate-800">
              Sua avaliação já foi registrada. Se quiser, envie uma manifestação para a Ouvidoria.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                className="min-h-12"
                onClick={() => {
                  setWriting(true);
                }}
              >
                <MessageSquareText aria-hidden="true" className="size-5" />
                Registrar manifestação
              </Button>
              <Button
                variant="secondary"
                className="min-h-12"
                onClick={() => {
                  setOfferDeclined(true);
                }}
              >
                Não, obrigado
              </Button>
            </div>
          </div>
        ) : null}
        <p className="text-sm text-slate-700">A tela volta ao início em 30 segundos.</p>
        <div className="flex flex-col items-center gap-3">
          <Button
            className="min-h-12 w-full sm:w-auto"
            onClick={() => {
              restart(null);
            }}
          >
            Concluir
          </Button>
          {canManifest && !submitted.lowScore ? (
            <Button
              variant="ghost"
              className="min-h-12"
              onClick={() => {
                setWriting(true);
              }}
            >
              Deixar um elogio, sugestão ou reclamação
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  const isLast = progress.step === totalSteps - 1;
  const stage = progress.step === 0 ? undefined : survey.stages[progress.step - 1];
  const outdated = failure instanceof ApiError && failure.code === 'SURVEY_VERSION_OUTDATED';

  return (
    <section aria-labelledby={`${ids}-titulo`} className="space-y-6">
      <header className="space-y-1">
        <p className="text-sm font-semibold tracking-wide text-brand-700 uppercase">
          {survey.sectorName}
        </p>
        <h1 id={`${ids}-titulo`} className="text-2xl font-bold tracking-tight">
          {survey.title}
        </h1>
      </header>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-800" aria-live="polite">
          Etapa {progress.step + 1} de {totalSteps}
        </p>
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-brand-700 transition-all"
            style={{ width: `${((progress.step + 1) / totalSteps) * 100}%` }}
          />
        </div>
      </div>

      {notice === null ? null : <Alert tone="info">{notice}</Alert>}

      {stage === undefined ? (
        <div className="space-y-4">
          {survey.introText === null ? null : (
            <p className="text-lg text-slate-800">{survey.introText}</p>
          )}
          <h2
            id={`${ids}-nps`}
            ref={headingRef}
            tabIndex={-1}
            className="text-[22px] leading-snug font-semibold"
          >
            {survey.npsQuestion.text}
          </h2>
          <p id={`${ids}-ancoras`} className="flex justify-between gap-4 text-lg text-slate-700">
            <span>{survey.npsQuestion.anchors.min}</span>
            <span className="text-right">{survey.npsQuestion.anchors.max}</span>
          </p>
          <ScoreScale
            labelledBy={`${ids}-nps`}
            describedBy={`${ids}-ancoras${npsError ? ` ${ids}-nps-erro` : ''}`}
            min={0}
            max={10}
            value={progress.npsScore}
            invalid={npsError}
            focusRef={npsGroupRef}
            gridClassName="grid-cols-6 sm:grid-cols-11"
            onChange={(npsScore) => {
              setNpsError(false);
              update({ npsScore });
            }}
          />
          {npsError ? (
            <p id={`${ids}-nps-erro`} role="alert" className="text-lg font-medium text-danger-700">
              Escolha uma nota de 0 a 10 para continuar.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 ref={headingRef} tabIndex={-1} className="text-[22px] font-semibold">
              {stage.name}
            </h2>
            <p className="text-lg text-slate-700">
              Perguntas opcionais. Responda só as que quiser.
            </p>
          </div>
          {stage.questions.map((question) => {
            const value = progress.answers[question.id] ?? null;
            return (
              <fieldset key={question.id} className="space-y-3">
                <legend id={`${ids}-${question.id}`} className="text-lg font-medium">
                  {question.text}
                </legend>
                <ScoreScale
                  labelledBy={`${ids}-${question.id}`}
                  min={1}
                  max={5}
                  value={value}
                  labelOf={(score) => survey.scaleLabels[score - 1]}
                  gridClassName="grid-cols-5"
                  onChange={(score) => {
                    update({ answers: { ...progress.answers, [question.id]: score } });
                  }}
                />
                {value === null ? null : (
                  <button
                    type="button"
                    className="inline-flex min-h-12 items-center rounded-lg px-2 font-medium text-brand-700 underline underline-offset-4"
                    onClick={() => {
                      const answers = Object.fromEntries(
                        Object.entries(progress.answers).filter(([id]) => id !== question.id),
                      );
                      update({ answers });
                    }}
                  >
                    Limpar resposta
                  </button>
                )}
              </fieldset>
            );
          })}
        </div>
      )}

      {failure === null ? null : (
        <Alert
          tone="error"
          title="Sua resposta ainda não foi enviada"
          requestId={failure instanceof ApiError ? failure.requestId : undefined}
        >
          {failureText(failure)}
        </Alert>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        {progress.step > 0 ? (
          <Button
            variant="secondary"
            className="min-h-12"
            disabled={submitting}
            onClick={() => {
              update({ step: progress.step - 1 });
            }}
          >
            <ArrowLeft aria-hidden="true" className="size-5" />
            Voltar
          </Button>
        ) : (
          <span className="hidden sm:block" />
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          {outdated ? (
            <Button className="min-h-12" onClick={onReload}>
              <RotateCw aria-hidden="true" className="size-5" />
              Recarregar a pesquisa
            </Button>
          ) : (
            <>
              {!isLast && progress.step > 0 ? (
                <Button
                  variant="secondary"
                  className="min-h-12"
                  disabled={submitting}
                  onClick={() => void send()}
                >
                  Enviar agora
                </Button>
              ) : null}
              <Button
                className="min-h-12"
                disabled={submitting}
                aria-busy={submitting}
                onClick={() => {
                  if (isLast) void send();
                  else goNext();
                }}
              >
                {submitting ? (
                  'Enviando…'
                ) : isLast ? (
                  <>
                    <Send aria-hidden="true" className="size-5" />
                    {failure === null ? 'Enviar' : 'Tentar enviar de novo'}
                  </>
                ) : (
                  <>
                    Continuar
                    <ArrowRight aria-hidden="true" className="size-5" />
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      <Dialog
        open={inactivity.warning}
        title="Você ainda está aí?"
        description={`Por segurança, as respostas serão apagadas em ${inactivity.secondsLeft} segundos.`}
        onClose={inactivity.stillHere}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button
            variant="secondary"
            className="min-h-12"
            onClick={() => {
              restart(null);
            }}
          >
            Apagar e recomeçar
          </Button>
          <Button className="min-h-12" onClick={inactivity.stillHere} data-autofocus>
            Continuar respondendo
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

function Unavailable({ title, children }: { title: string; children: string }) {
  return (
    <section className="space-y-3 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="text-lg text-slate-700">{children}</p>
    </section>
  );
}

/**
 * Pesquisa pública por link ou QR Code, sem login nem cookies (RF33–RF39). A origem vem de
 * ?origem=qr (QR Code) ou ?origem=link (padrão).
 */
export function PublicSurveyPage() {
  const { slug = '' } = useParams();
  const [params] = useSearchParams();
  const origin: ResponseOrigin = params.get('origem') === 'qr' ? 'qr_code' : 'link';
  const query = useQuery({
    queryKey: ['public-survey', slug],
    queryFn: ({ signal }) => fetchPublicSurvey(slug, signal),
    retry: (count, error) => isRetryable(error) && count < 3,
    staleTime: 60_000,
  });

  let content;
  if (query.isPending) {
    content = <Loading label="Conectando ao servidor…" />;
  } else if (query.isError) {
    const error = query.error;
    if (error instanceof ApiError && error.status === 404) {
      content = (
        <Unavailable title="Pesquisa não encontrada">
          Confira o endereço ou leia o QR Code do setor de novo.
        </Unavailable>
      );
    } else if (error instanceof ApiError && error.status === 410) {
      content = (
        <Unavailable title="Pesquisa indisponível">
          Esta pesquisa não está recebendo respostas no momento. Obrigado pelo interesse.
        </Unavailable>
      );
    } else {
      content = (
        <div className="space-y-4">
          <Alert
            tone="error"
            title="Não foi possível abrir a pesquisa"
            requestId={error instanceof ApiError ? error.requestId : undefined}
          >
            {error instanceof ApiError && error.status === 429
              ? 'Muitos acessos em pouco tempo. Aguarde um minuto e tente de novo.'
              : 'Verifique a conexão com a internet e tente de novo.'}
          </Alert>
          <Button className="min-h-12" onClick={() => void query.refetch()}>
            <RotateCw aria-hidden="true" className="size-5" />
            Tentar novamente
          </Button>
        </div>
      );
    }
  } else {
    content = (
      <SurveyFlow
        key={query.data.surveyVersionId}
        survey={query.data}
        slug={slug}
        origin={origin}
        onReload={() => {
          clearSurveyStorage();
          void query.refetch();
        }}
      />
    );
  }

  return <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">{content}</div>;
}
