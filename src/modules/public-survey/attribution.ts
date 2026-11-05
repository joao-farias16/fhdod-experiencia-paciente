import type { Queryable } from '../../lib/database.js';
import type { AttributionStatus, ResponseOrigin, ShiftPeriod } from '../../lib/domain-types.js';
import { findShiftsAt } from './public-survey.repository.js';

export type Attribution =
  | { status: 'attributed'; shiftId: string; teamId: string; period: ShiftPeriod }
  | { status: Exclude<AttributionStatus, 'attributed'> };

/**
 * Atribuição da avaliação a turno e equipe (RF24, RN07, RN08). Somente com origem qr_code e
 * exatamente um turno NÃO cancelado do setor contendo o instante do envio (starts_at <= instante <
 * ends_at) cuja equipe esteja ativa. Caso contrário, turno e equipe ficam nulos com o motivo
 * (not_qr_origin, no_shift ou ambiguous). Nunca há associação a profissional individual.
 */
export async function attributeResponse(
  tx: Queryable,
  sectorId: string,
  origin: ResponseOrigin,
  submittedAt: Date,
): Promise<Attribution> {
  if (origin !== 'qr_code') return { status: 'not_qr_origin' };
  const [only, other] = await findShiftsAt(tx, sectorId, submittedAt);
  if (only === undefined) return { status: 'no_shift' };
  if (other !== undefined) return { status: 'ambiguous' };
  return { status: 'attributed', shiftId: only.id, teamId: only.teamId, period: only.period };
}
