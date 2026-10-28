import type {
  AttributionStatus,
  ResponseOrigin,
  ShiftPeriod,
  TransactionClient,
} from '../lib/prisma.js';

export type Attribution =
  | { status: 'attributed'; shiftId: string; teamId: string; period: ShiftPeriod }
  | { status: Exclude<AttributionStatus, 'attributed'> };

/**
 * Atribuição da avaliação a turno e equipe (RF24, RN07, RN08). Somente com origem qr_code e
 * exatamente um turno NÃO cancelado do setor contendo o instante do envio (starts_at <= instante <
 * ends_at) cuja equipe esteja ativa. Caso contrário, turno e equipe ficam nulos com o motivo
 * (not_qr_origin, no_shift ou ambiguous). Nunca há associação a profissional individual.
 * LIMIT 2 distingue nenhum, um ou vários turnos (Seção 8).
 */
export async function attributeResponse(
  tx: Pick<TransactionClient, 'shift'>,
  sectorId: string,
  origin: ResponseOrigin,
  submittedAt: Date,
): Promise<Attribution> {
  if (origin !== 'qr_code') return { status: 'not_qr_origin' };
  const matches = await tx.shift.findMany({
    where: {
      sectorId,
      cancelledAt: null,
      startsAt: { lte: submittedAt },
      endsAt: { gt: submittedAt },
      team: { isActive: true },
    },
    select: { id: true, teamId: true, period: true },
    take: 2,
  });
  const [only, other] = matches;
  if (only === undefined) return { status: 'no_shift' };
  if (other !== undefined) return { status: 'ambiguous' };
  return { status: 'attributed', shiftId: only.id, teamId: only.teamId, period: only.period };
}
