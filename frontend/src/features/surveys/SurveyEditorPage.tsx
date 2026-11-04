import { Rocket } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ErrorState, Loading } from '../../components/ui/States';
import { Tag } from '../../components/ui/Tag';
import { failureOf } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { noticeOf } from '../../lib/route-state';
import { SurveyDataForm } from './SurveyDataForm';
import { SurveyQrPanel } from './SurveyQrPanel';
import { QuestionsSection } from './SurveyQuestions';
import {
  STATUS_LABELS,
  STATUS_TONES,
  usePublishSurvey,
  useSurvey,
  useUpdateSurvey,
} from './surveys-api';

/**
 * TL08 — Configuração de pesquisas (/admin/pesquisas/:id; RF25–RF32): dados, perguntas,
 * publicação de versões imutáveis, histórico, link, QR Code e cartaz.
 */
export function SurveyEditorPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const survey = useSurvey(id);
  const publish = usePublishSurvey(id);
  const toggle = useUpdateSurvey(id);
  const [notice, setNotice] = useState<string | null>(noticeOf(location.state) ?? null);
  const [confirm, setConfirm] = useState<'publish' | 'toggle' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  if (survey.isPending) return <Loading label="Carregando a pesquisa…" />;
  if (survey.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <ErrorState error={survey.error} onRetry={() => void survey.refetch()} />
      </div>
    );
  }
  const data = survey.data;
  const nextVersion = (data.versions[0]?.versionNumber ?? 0) + 1;
  const canPublish = data.isActive && (data.currentVersion === null || data.hasUnpublishedChanges);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setActionError(null);
    try {
      await action();
      setConfirm(null);
      setNotice(message);
    } catch (error) {
      setActionError(failureOf(error).text);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <div className="space-y-3">
        <Link
          to="/admin/pesquisas"
          className="font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          ← Pesquisas
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone={STATUS_TONES[data.status]}>{STATUS_LABELS[data.status]}</Tag>
              {data.hasUnpublishedChanges && data.currentVersion !== null ? (
                <span className="text-sm text-slate-700">Há alterações não publicadas</span>
              ) : null}
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{data.title}</h1>
            <p className="text-slate-700">
              {data.sectorName}
              {data.currentVersion === null
                ? ' · ainda não publicada'
                : ` · versão ${data.currentVersion.versionNumber} vigente`}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setConfirm('toggle');
              }}
            >
              {data.isActive ? 'Desativar pesquisa' : 'Reativar pesquisa'}
            </Button>
            <Button
              disabled={!canPublish}
              title={
                canPublish
                  ? undefined
                  : data.isActive
                    ? 'Não há alterações desde a última publicação.'
                    : 'Reative a pesquisa para publicar.'
              }
              onClick={() => {
                setConfirm('publish');
              }}
            >
              <Rocket aria-hidden="true" className="size-5" />
              Publicar versão {nextVersion}
            </Button>
          </div>
        </div>
      </div>

      {notice === null ? null : <Alert tone="success">{notice}</Alert>}

      <section
        aria-labelledby="dados"
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 id="dados" className="text-lg font-semibold">
          Dados da pesquisa
        </h2>
        <SurveyDataForm survey={data} onSaved={setNotice} />
      </section>

      <section aria-labelledby="perguntas" className="space-y-4">
        <h2 id="perguntas" className="text-lg font-semibold">
          Perguntas específicas
        </h2>
        <QuestionsSection survey={data} onSaved={setNotice} />
      </section>

      <section
        aria-labelledby="link-qr"
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <h2 id="link-qr" className="text-lg font-semibold">
          Link e QR Code
        </h2>
        {data.links === null ? (
          <p className="text-slate-700">Publique a pesquisa para gerar o link e o QR Code.</p>
        ) : (
          <SurveyQrPanel
            surveyId={data.id}
            slug={data.slug}
            qrUrl={data.links.qrUrl}
            linkUrl={data.links.linkUrl}
          />
        )}
      </section>

      <section aria-labelledby="versoes" className="space-y-4">
        <h2 id="versoes" className="text-lg font-semibold">
          Histórico de versões
        </h2>
        {data.versions.length === 0 ? (
          <p className="text-slate-700">Nenhuma versão publicada.</p>
        ) : (
          <ul className="space-y-3">
            {data.versions.map((version) => (
              <li key={version.id} className="rounded-xl border border-slate-200 bg-white p-4">
                <details>
                  <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2">
                    <span className="font-semibold">Versão {version.versionNumber}</span>
                    {version.isCurrent ? (
                      <span className="rounded-full border border-green-700 px-2 text-sm text-green-800">
                        Vigente
                      </span>
                    ) : null}
                    <span className="text-sm text-slate-700">
                      Publicada em {formatDateTime(version.publishedAt)} por{' '}
                      {version.publishedBy.fullName}
                      {version.supersededAt === null
                        ? ''
                        : ` · substituída em ${formatDateTime(version.supersededAt)}`}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-2 text-sm">
                    <p>
                      <strong>Título:</strong> {version.title}
                    </p>
                    <p>
                      <strong>Agradecimento:</strong> {version.thankYouMessage}
                    </p>
                    <ol className="list-inside list-decimal space-y-1">
                      {version.questions.map((question) => (
                        <li key={question.id}>
                          {question.text}{' '}
                          <span className="text-slate-700">
                            (
                            {question.type === 'nps'
                              ? 'geral, 0 a 10'
                              : `${question.journeyStageName ?? ''}, 1 a 5`}
                            )
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirm === 'publish'}
        title={`Publicar versão ${nextVersion}`}
        confirmLabel="Publicar"
        busy={publish.isPending}
        error={actionError}
        onClose={() => {
          setConfirm(null);
          setActionError(null);
        }}
        onConfirm={() => void run(() => publish.mutateAsync(), `Versão ${nextVersion} publicada.`)}
      >
        A versão fica imutável. Respostas já registradas continuam ligadas à versão em que foram
        dadas; a versão anterior aceita respostas por mais 24 horas.
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === 'toggle'}
        title={data.isActive ? 'Desativar pesquisa' : 'Reativar pesquisa'}
        confirmLabel={data.isActive ? 'Desativar' : 'Reativar'}
        danger={data.isActive}
        busy={toggle.isPending}
        error={actionError}
        onClose={() => {
          setConfirm(null);
          setActionError(null);
        }}
        onConfirm={() =>
          void run(
            () => toggle.mutateAsync({ isActive: !data.isActive }),
            data.isActive ? 'Pesquisa desativada.' : 'Pesquisa reativada.',
          )
        }
      >
        {data.isActive
          ? 'O link e o QR Code deixam de receber respostas. Respostas e indicadores são mantidos.'
          : 'O link e o QR Code voltam a receber respostas na versão vigente.'}
      </ConfirmDialog>
    </div>
  );
}
