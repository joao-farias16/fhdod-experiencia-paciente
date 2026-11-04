/**
 * Regras de NPS (RN03) e de nota baixa (RN05), iguais às do SQL da Seção 8.
 * Promotores 9–10, passivos 7–8, detratores 0–6; NPS = % promotores − % detratores, com uma casa
 * decimal (metade afastando-se de zero), de −100 a 100; total 0 → NPS nulo.
 */

export type NpsClass = 'promoter' | 'passive' | 'detractor';

export function classifyNps(score: number): NpsClass {
  if (score >= 9) return 'promoter';
  if (score >= 7) return 'passive';
  return 'detractor';
}

export interface NpsCounts {
  promoters: number;
  passives: number;
  detractors: number;
}

/**
 * computeNps (RF51): nps10 = sinal(P − D) × ⌊(2 × |P − D| × 1000 + N) ÷ (2N)⌋, em aritmética
 * inteira, o que reproduz o ROUND do PostgreSQL sem erro de ponto flutuante.
 */
export function computeNps({ promoters, passives, detractors }: NpsCounts): number | null {
  const total = promoters + passives + detractors;
  if (total === 0) return null;
  const difference = promoters - detractors;
  const nps10 = Math.floor((2 * Math.abs(difference) * 1000 + total) / (2 * total));
  return (Math.sign(difference) * nps10) / 10;
}

/** RN05: nota baixa é NPS de 0 a 6 ou alguma específica 1 ou 2. */
export function isLowScore(npsScore: number, specificScores: readonly number[]): boolean {
  return npsScore <= 6 || specificScores.some((score) => score <= 2);
}
