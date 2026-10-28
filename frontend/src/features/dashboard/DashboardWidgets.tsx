import { type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router';

import { formatLocalDate } from '../../lib/format';
import { formatNumber, type NpsIndicator, type Summary, type TrendPoint } from './dashboard-api';
import { nText, npsText, SUPPRESSED_TEXT } from './dashboard-format';

interface StatCardProps {
  label: string;
  value: string;
  detail: string;
  /** Texto adicional (por exemplo, comparação). */
  extra?: string | undefined;
}

/** Cartão de indicador: valor grande e o número de respostas consideradas (RF53). */
export function StatCard({ label, value, detail, extra }: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="text-sm text-slate-700">{detail}</p>
      {extra === undefined ? null : <p className="mt-1 text-sm text-slate-800">{extra}</p>}
    </div>
  );
}

function deltaText(summary: Summary): string | undefined {
  const comparison = summary.comparison;
  if (comparison === null) return undefined;
  const period = `${formatLocalDate(comparison.period.from)} a ${formatLocalDate(comparison.period.to)}`;
  if (comparison.noPreviousData) return `Sem respostas no período anterior (${period}).`;
  if (comparison.delta === null) return `Comparação indisponível (${period}).`;
  const sign = comparison.delta > 0 ? '+' : '';
  return `${sign}${formatNumber(comparison.delta)} pontos em relação a ${period} (NPS ${npsText(comparison.indicators)}, ${nText(comparison.indicators)}).`;
}

/** Cartões do resumo geral (RF50, RF53, RF58). */
export function SummaryCards({ summary }: { summary: Summary }) {
  const { indicators, manifestations, coverage } = summary;
  const percent = (value: number | null) => (value === null ? '—' : `${formatNumber(value)}%`);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="NPS"
        value={npsText(indicators)}
        detail={nText(indicators)}
        extra={deltaText(summary)}
      />
      <StatCard
        label="Promotores (9 e 10)"
        value={percent(indicators.promotersPercent)}
        detail={
          indicators.suppressed
            ? SUPPRESSED_TEXT
            : `${formatNumber(indicators.promoters, 0)} de ${formatNumber(indicators.n, 0)}`
        }
      />
      <StatCard
        label="Passivos (7 e 8)"
        value={percent(indicators.passivesPercent)}
        detail={
          indicators.suppressed
            ? SUPPRESSED_TEXT
            : `${formatNumber(indicators.passives, 0)} de ${formatNumber(indicators.n, 0)}`
        }
      />
      <StatCard
        label="Detratores (0 a 6)"
        value={percent(indicators.detractorsPercent)}
        detail={
          indicators.suppressed
            ? SUPPRESSED_TEXT
            : `${formatNumber(indicators.detractors, 0)} de ${formatNumber(indicators.n, 0)}`
        }
      />
      <StatCard
        label="Manifestações"
        value={manifestations.suppressed ? 'Oculto' : formatNumber(manifestations.total, 0)}
        detail={
          manifestations.suppressed
            ? SUPPRESSED_TEXT
            : `Reclamações: ${formatNumber(manifestations.complaint, 0)} · Sugestões: ${formatNumber(manifestations.suggestion, 0)} · Elogios: ${formatNumber(manifestations.compliment, 0)}`
        }
      />
      <StatCard
        label="Cobertura de atribuição"
        value={coverage.suppressed ? 'Oculto' : percent(coverage.percent)}
        detail={
          coverage.suppressed
            ? SUPPRESSED_TEXT
            : `${formatNumber(coverage.attributed, 0)} de ${formatNumber(coverage.total, 0)} respostas com turno e equipe`
        }
      />
    </div>
  );
}

/** Barra horizontal de magnitude (uma cor; o valor está sempre escrito ao lado). */
function Bar({ ratio }: { ratio: number }) {
  return (
    <div aria-hidden="true" className="h-5 w-full overflow-hidden rounded-sm bg-slate-100">
      <div
        className="h-full rounded-r bg-brand-700"
        style={{ width: `${Math.max(0, Math.min(1, ratio)) * 100}%` }}
      />
    </div>
  );
}

/**
 * RF52 — distribuição das notas 0 a 10 com valores visíveis e tabela alternativa. Série única: uma
 * cor, sem legenda; quantidade e percentual escritos em cada linha.
 */
export function DistributionChart({ summary }: { summary: Summary }) {
  const ids = useId();
  if (summary.distribution === null) {
    return <p className="text-slate-700">Distribuição oculta: {SUPPRESSED_TEXT}.</p>;
  }
  const max = Math.max(1, ...summary.distribution.map((item) => item.count));
  return (
    <figure aria-labelledby={`${ids}-legenda`} className="space-y-2">
      <figcaption id={`${ids}-legenda`} className="text-sm text-slate-700">
        Quantidade e percentual de cada nota ({nText(summary.indicators)}).
      </figcaption>
      <table className="w-full text-sm">
        <thead className="sr-only">
          <tr>
            <th scope="col">Nota</th>
            <th scope="col">Distribuição</th>
            <th scope="col">Quantidade</th>
            <th scope="col">Percentual</th>
          </tr>
        </thead>
        <tbody>
          {summary.distribution.map((item) => (
            <tr
              key={item.score}
              title={`Nota ${item.score}: ${item.count} (${item.percent === null ? '—' : `${formatNumber(item.percent)}%`})`}
            >
              <th scope="row" className="w-10 py-0.5 pr-2 text-right font-medium">
                {item.score}
              </th>
              <td className="py-0.5">
                <Bar ratio={item.count / max} />
              </td>
              <td className="w-14 py-0.5 pl-2 text-right tabular-nums">{item.count}</td>
              <td className="w-16 py-0.5 pl-2 text-right text-slate-700 tabular-nums">
                {item.percent === null ? '—' : `${formatNumber(item.percent)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

const GRANULARITY_LABELS = { day: 'por dia', week: 'por semana', month: 'por mês' } as const;

/**
 * RF59 — tendência do NPS (−100 a 100) com um ponto por intervalo. Linha de 2 px, marcadores de
 * 8 px, dica ao passar o mouse ou focar e tabela alternativa com n de cada ponto.
 */
export function TrendChart({
  points,
  granularity,
}: {
  points: TrendPoint[];
  granularity: 'day' | 'week' | 'month';
}) {
  const ids = useId();
  const [active, setActive] = useState<number | null>(null);
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 28, left: 40 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (index: number) =>
    pad.left + (points.length <= 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const y = (nps: number) => pad.top + ((100 - nps) / 200) * innerH;
  const label = (point: TrendPoint) =>
    point.start === point.end
      ? formatLocalDate(point.start)
      : `${formatLocalDate(point.start)} a ${formatLocalDate(point.end)}`;
  const value = (point: TrendPoint) =>
    point.suppressed
      ? SUPPRESSED_TEXT
      : point.nps === null
        ? 'sem respostas'
        : `NPS ${formatNumber(point.nps)}, n = ${formatNumber(point.n, 0)}`;

  // Segmentos contínuos apenas entre pontos com NPS (sem inventar valores nos vazios).
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (point.nps === null) {
      if (current.length > 0) segments.push(current.join(' '));
      current = [];
      return;
    }
    current.push(
      `${current.length === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.nps).toFixed(1)}`,
    );
  });
  if (current.length > 0) segments.push(current.join(' '));

  const shown = active === null ? undefined : points[active];
  return (
    <figure aria-labelledby={`${ids}-legenda`} className="space-y-2">
      <figcaption id={`${ids}-legenda`} className="text-sm text-slate-700">
        NPS {GRANULARITY_LABELS[granularity]} (escala de −100 a 100).
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-auto w-full"
          role="img"
          aria-label={`Tendência do NPS ${GRANULARITY_LABELS[granularity]}; os valores estão na tabela abaixo.`}
        >
          {[100, 50, 0, -50, -100].map((tick) => (
            <g key={tick}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? '#94a3b8' : '#e2e8f0'}
                strokeWidth={1}
              />
              <text x={pad.left - 6} y={y(tick) + 4} textAnchor="end" fontSize={11} fill="#475569">
                {tick}
              </text>
            </g>
          ))}
          {segments.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="#1d4ed8"
              strokeWidth={2}
              strokeLinejoin="round"
            />
          ))}
          {points.map((point, index) =>
            point.nps === null ? null : (
              <circle
                key={point.start}
                cx={x(index)}
                cy={y(point.nps)}
                r={active === index ? 6 : 4}
                fill="#1d4ed8"
                stroke="#ffffff"
                strokeWidth={2}
              />
            ),
          )}
          {/* Alvos de foco e hover maiores que o marcador. */}
          {points.map((point, index) => (
            <rect
              key={`alvo-${point.start}`}
              x={x(index) - Math.max(6, innerW / Math.max(1, points.length) / 2)}
              y={pad.top}
              width={Math.max(12, innerW / Math.max(1, points.length))}
              height={innerH}
              fill="transparent"
              tabIndex={0}
              aria-label={`${label(point)}: ${value(point)}`}
              onMouseEnter={() => {
                setActive(index);
              }}
              onMouseLeave={() => {
                setActive(null);
              }}
              onFocus={() => {
                setActive(index);
              }}
              onBlur={() => {
                setActive(null);
              }}
            />
          ))}
          {points.length > 0 ? (
            <>
              <text x={pad.left} y={height - 8} fontSize={11} fill="#475569">
                {formatLocalDate(points[0]?.start ?? '')}
              </text>
              <text
                x={width - pad.right}
                y={height - 8}
                fontSize={11}
                fill="#475569"
                textAnchor="end"
              >
                {formatLocalDate(points.at(-1)?.end ?? '')}
              </text>
            </>
          ) : null}
        </svg>
        {shown === undefined ? null : (
          <p
            role="status"
            className="pointer-events-none absolute top-2 right-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow"
          >
            <strong>{label(shown)}</strong>
            <br />
            {value(shown)}
          </p>
        )}
      </div>
      <details>
        <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-brand-700">
          Ver tabela da tendência
        </summary>
        <table className="mt-2 w-full text-left text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th scope="col" className="px-3 py-2">
                Intervalo
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                NPS
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Respostas (n)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {points.map((point) => (
              <tr key={point.start}>
                <td className="px-3 py-1.5">{label(point)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {point.suppressed ? 'Oculto' : formatNumber(point.nps)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {point.suppressed ? SUPPRESSED_TEXT : formatNumber(point.n, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** Tabela de grupos (setores, turnos, equipes) com NPS, n e barra de NPS. */
export function GroupTable({
  caption,
  rows,
}: {
  caption: string;
  rows: { key: string; label: string; href?: string | undefined; indicators: NpsIndicator }[];
}) {
  return (
    <div className="overflow-x-auto" role="region" aria-label={caption} tabIndex={0}>
      <table className="w-full min-w-[480px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-100 text-slate-800">
          <tr>
            <th scope="col" className="px-3 py-2">
              Grupo
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              NPS
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Respostas (n)
            </th>
            <th scope="col" className="w-1/3 px-3 py-2">
              <span className="sr-only">Barra do NPS</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="px-3 py-2 font-medium">
                {row.href === undefined ? (
                  row.label
                ) : (
                  <Link
                    to={row.href}
                    className="inline-flex min-h-11 items-center text-brand-700 underline underline-offset-4"
                  >
                    {row.label}
                  </Link>
                )}
              </th>
              <td className="px-3 py-2 text-right tabular-nums">{npsText(row.indicators)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{nText(row.indicators)}</td>
              <td className="px-3 py-2">
                {row.indicators.nps === null || row.indicators.suppressed ? null : (
                  <Bar ratio={(row.indicators.nps + 100) / 200} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Seção com título e conteúdo do painel. */
export function Panel({
  title,
  children,
  actions,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const ids = useId();
  return (
    <section
      aria-labelledby={ids}
      className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={ids} className="text-lg font-semibold">
          {title}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}
