import { Download, FileCheck2, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ApiError } from '../../lib/api-client';
import { formatDateTime } from '../../lib/format';
import { ROSTER_HEADER, rosterTemplate } from './roster-template';
import { type RosterImport, useConfirmRoster, useValidateRoster } from './structure-api';

const COLUMN_LABELS: Record<string, string> = {
  cabecalho: 'Cabeçalho',
  setor_codigo: 'Setor',
  equipe_codigo: 'Equipe',
  data: 'Data',
  turno: 'Turno',
  hora_inicio: 'Início',
  hora_fim: 'Fim',
};

function downloadTemplate() {
  const blob = new Blob([rosterTemplate()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'modelo-escala-fhdod.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * TL07 — Importação de escalas (/admin/escalas/importar; RF22, RF23): envio do CSV, modelo para
 * baixar, resumo, erros por linha e confirmação. A pré-validação não grava turnos; a confirmação
 * grava todos em uma única transação, em até 30 minutos (RN19).
 */
export function RosterImportPage() {
  const fileId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<RosterImport | null>(null);
  const [failure, setFailure] = useState<ApiError | null>(null);
  const validate = useValidateRoster();
  const confirm = useConfirmRoster();

  const send = async () => {
    if (file === null) {
      setFailure(new ApiError(400, 'VALIDATION_ERROR', 'Escolha o arquivo CSV da escala.'));
      inputRef.current?.focus();
      return;
    }
    setFailure(null);
    setResult(null);
    try {
      setResult(await validate.mutateAsync(file));
    } catch (error) {
      setFailure(
        error instanceof ApiError
          ? error
          : new ApiError(0, 'UNEXPECTED', 'Não foi possível enviar o arquivo.'),
      );
    }
  };

  const commit = async () => {
    if (result === null) return;
    setFailure(null);
    try {
      setResult(await confirm.mutateAsync(result.id));
    } catch (error) {
      setFailure(
        error instanceof ApiError
          ? error
          : new ApiError(0, 'UNEXPECTED', 'Não foi possível confirmar.'),
      );
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Importação de escalas</h1>
          <p className="text-slate-700">
            CSV em UTF-8, separado por ponto e vírgula, com até 2.000 linhas e 1 MB.
          </p>
        </div>
        <Link
          to="/admin/turnos"
          className="inline-flex min-h-11 items-center rounded-lg px-3 font-medium text-brand-700 hover:bg-brand-50"
        >
          Ver escala
        </Link>
      </div>

      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="space-y-1 text-sm text-slate-800">
          <p>
            Cabeçalho: <code className="break-all">{ROSTER_HEADER}</code>
          </p>
          <p>
            Data DD/MM/AAAA (de 30 dias antes a 180 dias depois de hoje); turno MANHA, TARDE ou
            NOITE; horas HH:MM. Fim menor ou igual ao início termina no dia seguinte.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor={fileId} className="block font-medium">
              Arquivo CSV
            </label>
            <input
              ref={inputRef}
              id={fileId}
              type="file"
              accept=".csv,text/csv"
              className="block min-h-11 max-w-full text-sm file:mr-3 file:min-h-11 file:rounded-lg file:border file:border-neutral-border file:bg-white file:px-4 file:font-medium"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setResult(null);
                setFailure(null);
              }}
            />
          </div>
          <Button onClick={() => void send()} disabled={validate.isPending}>
            <Upload aria-hidden="true" className="size-5" />
            {validate.isPending ? 'Validando…' : 'Validar arquivo'}
          </Button>
          <Button variant="secondary" onClick={downloadTemplate}>
            <Download aria-hidden="true" className="size-5" />
            Baixar modelo
          </Button>
        </div>
      </section>

      {failure === null ? null : (
        <Alert tone="error" title="Não foi possível continuar" requestId={failure.requestId}>
          {failure.message}
        </Alert>
      )}

      {result === null ? null : (
        <section aria-labelledby="resultado-importacao" className="space-y-4">
          <h2 id="resultado-importacao" className="text-lg font-semibold">
            Resultado de {result.fileName}
          </h2>
          <dl className="grid grid-cols-3 gap-3 text-center">
            {[
              ['Linhas', result.totalRows],
              ['Aceitas', result.acceptedRows],
              ['Com erro', result.rejectedRows],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
                <dt className="text-sm text-slate-700">{label}</dt>
                <dd className="text-2xl font-bold">{value}</dd>
              </div>
            ))}
          </dl>

          {result.status === 'rejected' ? (
            <>
              <Alert tone="error" title="Arquivo recusado">
                Nenhum turno foi gravado. Corrija as linhas abaixo e envie o arquivo de novo.
              </Alert>
              <div
                className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm"
                tabIndex={0}
                role="region"
                aria-label="Erros por linha"
              >
                <table className="w-full min-w-[560px] text-left text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th scope="col" className="px-4 py-2">
                        Linha
                      </th>
                      <th scope="col" className="px-4 py-2">
                        Coluna
                      </th>
                      <th scope="col" className="px-4 py-2">
                        Problema
                      </th>
                      <th scope="col" className="px-4 py-2">
                        Código
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {result.errors.map((error) => (
                      <tr key={`${error.line}-${error.column}-${error.code}-${error.message}`}>
                        <td className="px-4 py-2">{error.line}</td>
                        <td className="px-4 py-2">{COLUMN_LABELS[error.column] ?? error.column}</td>
                        <td className="px-4 py-2">{error.message}</td>
                        <td className="px-4 py-2 font-mono text-xs">{error.code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              {result.status === 'committed' ? (
                <Alert tone="success" title="Escala importada">
                  {result.acceptedRows} turnos gravados.{' '}
                  <Link to="/admin/turnos" className="font-medium underline">
                    Ver a escala
                  </Link>
                </Alert>
              ) : (
                <Alert tone="info" title="Arquivo válido">
                  Nada foi gravado ainda. Confira o resumo e confirme até{' '}
                  {formatDateTime(result.expiresAt)}.
                </Alert>
              )}
              <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                {result.summary.map((item) => (
                  <li key={`${item.sectorCode}-${item.teamCode}`} className="flex gap-3 px-4 py-2">
                    <span className="font-medium">{item.sectorName}</span>
                    <span>{item.teamName}</span>
                    <span className="ml-auto">{item.shifts} turnos</span>
                  </li>
                ))}
              </ul>
              {result.status === 'validated' ? (
                <Button onClick={() => void commit()} disabled={confirm.isPending}>
                  <FileCheck2 aria-hidden="true" className="size-5" />
                  {confirm.isPending ? 'Gravando…' : 'Confirmar importação'}
                </Button>
              ) : null}
            </>
          )}
        </section>
      )}
    </div>
  );
}
